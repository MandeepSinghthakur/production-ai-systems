// Per-provider translation lives here and nowhere else. Adding a
// provider means adding a file like this one and changing no consumer
// code. If you have to touch a consumer, the canonical schema leaked.

import type {
  CanonicalChunk,
  CanonicalRequest,
  ProviderAdapter,
} from '../types.ts';

const ENDPOINT = process.env.PROVIDER_URL ?? 'http://localhost:8081';

interface RawFrame {
  type: 'delta' | 'usage';
  text?: string;
  input_tokens?: number;
  output_tokens?: number;
}

/** Incremental SSE parser. Never buffers the whole response. */
async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RawFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });

    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (frame.startsWith('data:')) {
        const payload = frame.slice(5).trim();
        if (payload !== '[DONE]') yield JSON.parse(payload) as RawFrame;
      }
      idx = buf.indexOf('\n\n');
    }
  }
}

export const mockAdapter: ProviderAdapter = {
  name: 'mock',

  async *stream(req: CanonicalRequest, signal: AbortSignal) {
    const res = await fetch(`${ENDPOINT}/v1/stream`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        input_tokens: req.countedInputTokens,
        messages: req.messages,
      }),
    });

    if (!res.ok || !res.body) {
      throw Object.assign(new Error(`provider ${res.status}`), {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }

    yield* parseSSE(res.body);
  },

  toCanonical(raw: unknown): CanonicalChunk | null {
    const f = raw as RawFrame;
    if (f.type === 'delta') return { kind: 'text', text: f.text ?? '' };
    if (f.type === 'usage') {
      return {
        kind: 'usage',
        usage: {
          inputTokens: f.input_tokens ?? 0,
          outputTokens: f.output_tokens ?? 0,
          estimated: false,
        },
      };
    }
    return null;
  },
};
