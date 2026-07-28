// Canonical schema. Consumers code against this, never against a
// provider's wire format. See Chapter 18, "Core Concepts".

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CanonicalRequest {
  schemaVersion: 1;
  tenant: string;
  workload: string;
  model: string;
  messages: Message[];
  maxTokens: number;
  countedInputTokens: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export type StopReason = 'complete' | 'error' | 'aborted';

export type CanonicalChunk =
  | { kind: 'text'; text: string }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'terminal'; stop: StopReason; detail?: string };

export interface ProviderAdapter {
  readonly name: string;
  stream(req: CanonicalRequest, signal: AbortSignal): AsyncGenerator<unknown>;
  toCanonical(raw: unknown): CanonicalChunk | null;
}

export interface LedgerRecord {
  at: number;
  tenant: string;
  workload: string;
  provider: string;
  model: string;
  stop: StopReason;
  usage: Usage;
}
