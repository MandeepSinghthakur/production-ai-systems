// Chapter 13 — Streaming and Token Economics
// SSE stream simulation demonstrating TTFT vs total latency.

import type {
  StreamChunk,
  StreamToken,
  StreamEnd,
  GenerationRequest,
  LatencyModel,
} from './types.ts';
import { DEFAULT_LATENCY_MODEL } from './types.ts';

/** Simple tokenizer: splits on whitespace and punctuation. */
export function tokenize(text: string): string[] {
  return text.split(/(\s+|[.,!?;:])/).filter((t) => t.length > 0);
}

/** Estimate token count (production systems use provider-specific tokenizers). */
export function estimateTokens(text: string): number {
  // Rule of thumb: ~4 characters per token for English
  return Math.ceil(text.length / 4);
}

/** Add jitter to a value. */
function withJitter(value: number, jitterFactor: number): number {
  const jitter = 1 + (Math.random() - 0.5) * 2 * jitterFactor;
  return Math.max(0, value * jitter);
}

/** Calculate time-to-first-token based on input size. */
export function calculateTTFT(
  inputTokens: number,
  model: LatencyModel = DEFAULT_LATENCY_MODEL,
): number {
  const prefillTime = inputTokens * model.perInputTokenMs;
  const base = model.baseLatencyMs + prefillTime;
  return withJitter(base, model.jitterFactor);
}

/** Calculate inter-token interval for streaming. */
export function calculateTokenInterval(
  model: LatencyModel = DEFAULT_LATENCY_MODEL,
): number {
  return withJitter(model.perOutputTokenMs, model.jitterFactor);
}

/** A streaming generator that simulates LLM response streaming.
 *  Key insight: TTFT is dominated by input processing (prefill),
 *  while total time is dominated by output generation (decode). */
export async function* streamTokens(
  request: GenerationRequest,
  signal: AbortSignal,
  model: LatencyModel = DEFAULT_LATENCY_MODEL,
): AsyncGenerator<StreamChunk> {
  const startTime = performance.now();
  const inputTokens = estimateTokens(request.prompt);

  // Simulate prefill phase (processing input)
  const ttft = calculateTTFT(inputTokens, model);
  await sleep(ttft, signal);

  if (signal.aborted) {
    yield makeEndChunk('aborted', inputTokens, 0, startTime, ttft);
    return;
  }

  const firstTokenTime = performance.now();
  const actualTtft = firstTokenTime - startTime;

  // Generate response tokens
  const responseTokens = generateResponseTokens(request.maxTokens);
  let outputTokens = 0;

  for (let i = 0; i < responseTokens.length; i++) {
    if (signal.aborted) {
      yield makeEndChunk('aborted', inputTokens, outputTokens, startTime,
        actualTtft);
      return;
    }

    const interval = calculateTokenInterval(model);
    await sleep(interval, signal);

    if (signal.aborted) {
      yield makeEndChunk('aborted', inputTokens, outputTokens, startTime,
        actualTtft);
      return;
    }

    outputTokens++;
    yield {
      kind: 'token',
      token: {
        index: i,
        text: responseTokens[i],
        timestamp: performance.now(),
      },
    };
  }

  // Stream complete
  const stopReason = outputTokens >= request.maxTokens ? 'maxTokens'
    : 'complete';
  yield makeEndChunk(stopReason, inputTokens, outputTokens, startTime,
    actualTtft);
}

/** Generate simulated response tokens. */
function generateResponseTokens(maxTokens: number): string[] {
  // Deterministic "response" for reproducible testing
  const words = [
    'The', ' ', 'answer', ' ', 'depends', ' ', 'on', ' ', 'context', '.',
    ' ', 'Consider', ' ', 'the', ' ', 'trade', '-', 'offs', ' ', 'between',
    ' ', 'latency', ' ', 'and', ' ', 'throughput', '.', ' ', 'Streaming',
    ' ', 'reduces', ' ', 'perceived', ' ', 'wait', ' ', 'time', ' ', 'by',
    ' ', 'showing', ' ', 'partial', ' ', 'results', '.', ' ', 'However', ',',
    ' ', 'it', ' ', 'requires', ' ', 'more', ' ', 'complex', ' ', 'error',
    ' ', 'handling', '.', ' ', 'The', ' ', 'first', ' ', 'token', ' ',
    'arrives', ' ', 'quickly', ',', ' ', 'but', ' ', 'total', ' ', 'time',
    ' ', 'remains', ' ', 'the', ' ', 'same', '.',
  ];
  return words.slice(0, Math.min(maxTokens, words.length));
}

function makeEndChunk(
  stopReason: StreamEnd['stopReason'],
  inputTokens: number,
  outputTokens: number,
  startTime: number,
  ttftMs: number,
): StreamChunk {
  return {
    kind: 'end',
    end: {
      stopReason,
      inputTokens,
      outputTokens,
      totalDurationMs: performance.now() - startTime,
      timeToFirstTokenMs: ttftMs,
    },
  };
}

/** Sleep that respects abort signal. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

/** Collect a stream into a single response (non-streaming mode).
 *  Used to demonstrate the latency difference. */
export async function collectStream(
  request: GenerationRequest,
  signal: AbortSignal,
  model?: LatencyModel,
): Promise<{ text: string; end: StreamEnd }> {
  const tokens: string[] = [];
  let endChunk: StreamEnd | null = null;

  for await (const chunk of streamTokens(request, signal, model)) {
    if (chunk.kind === 'token') {
      tokens.push(chunk.token.text);
    } else {
      endChunk = chunk.end;
    }
  }

  if (!endChunk) {
    throw new Error('Stream ended without terminal chunk');
  }

  return {
    text: tokens.join(''),
    end: endChunk,
  };
}

/** Demonstrate streaming vs non-streaming perceived latency. */
export interface StreamingComparison {
  streaming: {
    ttftMs: number;
    totalMs: number;
    tokensBeforeWait: number;
  };
  nonStreaming: {
    waitMs: number; // Time until any content visible
    totalMs: number;
  };
}

export async function compareStreamingModes(
  request: GenerationRequest,
  model?: LatencyModel,
): Promise<StreamingComparison> {
  const controller1 = new AbortController();
  const controller2 = new AbortController();

  // Streaming mode: measure time to first visible token
  const streamStart = performance.now();
  let streamTtft = 0;
  let streamTotal = 0;
  let tokensBeforeWait = 0;

  for await (const chunk of streamTokens(request, controller1.signal, model)) {
    if (chunk.kind === 'token' && tokensBeforeWait === 0) {
      streamTtft = performance.now() - streamStart;
      // Count how many tokens arrive in the first second
      const deadline = performance.now() + 100; // 100ms window
      tokensBeforeWait = 1;
      for await (const c of streamTokens(request, controller1.signal, model)) {
        if (performance.now() > deadline) break;
        if (c.kind === 'token') tokensBeforeWait++;
        if (c.kind === 'end') break;
      }
      break;
    }
    if (chunk.kind === 'end') {
      streamTotal = chunk.end.totalDurationMs;
      streamTtft = chunk.end.timeToFirstTokenMs;
    }
  }

  // Non-streaming mode: wait for complete response
  const nonStreamStart = performance.now();
  const result = await collectStream(request, controller2.signal, model);
  const nonStreamTotal = performance.now() - nonStreamStart;

  return {
    streaming: {
      ttftMs: streamTtft,
      totalMs: result.end.totalDurationMs,
      tokensBeforeWait,
    },
    nonStreaming: {
      waitMs: nonStreamTotal, // Must wait for everything
      totalMs: nonStreamTotal,
    },
  };
}
