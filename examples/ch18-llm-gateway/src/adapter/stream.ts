// The three subtle rules of a streaming gateway live in this file:
//   1. transform incrementally, never buffer
//   2. record usage in `finally`, not on the success path
//   3. retries are free before first byte and forbidden after it

import type {
  CanonicalChunk,
  CanonicalRequest,
  ProviderAdapter,
  Usage,
} from '../types.ts';
import { metrics } from '../metrics.ts';

/** Rough estimate used only when the provider's trailing frame never
 *  arrives. Deliberately crude — it is flagged `estimated` downstream. */
function estimateFromChunks(chunks: number): number {
  return chunks;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function* streamCompletion(
  req: CanonicalRequest,
  provider: ProviderAdapter,
  signal: AbortSignal,
  onUsage: (u: Usage) => void, // (1)
): AsyncGenerator<CanonicalChunk> {
  const started = performance.now();
  let firstByteAt: number | null = null;
  let outputChunks = 0;
  let authoritative: Usage | null = null;

  try {
    for await (const raw of provider.stream(req, signal)) {
      const chunk = provider.toCanonical(raw); // (2)
      if (chunk === null) continue;

      if (chunk.kind === 'usage') {
        authoritative = chunk.usage; // (3)
        continue;
      }

      if (firstByteAt === null) firstByteAt = performance.now();
      outputChunks += 1;
      yield chunk;
    }
    yield { kind: 'terminal', stop: 'complete' }; // (4)
  } catch (err) {
    if (firstByteAt === null) throw err; // (5)
    yield signal.aborted
      ? { kind: 'terminal', stop: 'aborted' }
      : { kind: 'terminal', stop: 'error', detail: describe(err) };
  } finally {
    onUsage( // (6)
      authoritative ?? {
        inputTokens: req.countedInputTokens,
        outputTokens: estimateFromChunks(outputChunks),
        estimated: true,
      },
    );
    metrics.observe(
      'time_to_first_token',
      (firstByteAt ?? performance.now()) - started,
    );
    metrics.observe('total_duration', performance.now() - started);
  }
}
