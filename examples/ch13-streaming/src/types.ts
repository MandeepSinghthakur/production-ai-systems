// Chapter 13 — Streaming and Token Economics
// Type definitions. No enums, no parameter properties (erasable TS).

/** Model capability tiers — avoids hardcoding vendor-specific names. */
export type ModelTier = 'frontier' | 'mid' | 'small';

/** Cost multipliers per tier, relative to the small tier baseline.
 *  Actual prices change quarterly; these ratios are more stable. */
export const TIER_COST_MULTIPLIER: Record<ModelTier, number> = {
  frontier: 30, // ~30x more expensive than small
  mid: 6,       // ~6x more expensive than small
  small: 1,     // baseline
};

/** Output/input price ratio. Most providers charge more for output. */
export const OUTPUT_MULTIPLIER = 4;

/** A single token in a stream. */
export interface StreamToken {
  index: number;
  text: string;
  timestamp: number;
}

/** Terminal event marking stream completion. */
export interface StreamEnd {
  stopReason: 'complete' | 'maxTokens' | 'aborted' | 'error';
  inputTokens: number;
  outputTokens: number;
  totalDurationMs: number;
  timeToFirstTokenMs: number;
}

/** A chunk in the SSE stream. */
export type StreamChunk =
  | { kind: 'token'; token: StreamToken }
  | { kind: 'end'; end: StreamEnd };

/** Request parameters for token generation. */
export interface GenerationRequest {
  prompt: string;
  maxTokens: number;
  tier: ModelTier;
  tenant: string;
}

/** Usage record for billing and analytics. */
export interface UsageRecord {
  timestamp: number;
  tenant: string;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  costUnits: number;
  durationMs: number;
  ttftMs: number;
  aborted: boolean;
}

/** Budget configuration for a tenant. */
export interface TenantBudget {
  id: string;
  dailyTokenLimit: number;
  hardCap: boolean; // true = reject when exceeded, false = allow + alert
}

/** Budget check result. */
export interface BudgetCheckResult {
  allowed: boolean;
  remainingTokens: number;
  usedToday: number;
  overBudget: boolean;
}

/** Latency model parameters for TTFT simulation. */
export interface LatencyModel {
  baseLatencyMs: number;      // Fixed overhead (queue time, etc.)
  perInputTokenMs: number;    // Time per input token (prefill)
  perOutputTokenMs: number;   // Time per output token (decode)
  jitterFactor: number;       // Random variation (0-1)
}

/** Default latency model based on typical inference servers. */
export const DEFAULT_LATENCY_MODEL: LatencyModel = {
  baseLatencyMs: 50,          // ~50ms baseline
  perInputTokenMs: 0.5,       // ~500 tokens/sec prefill
  perOutputTokenMs: 20,       // ~50 tokens/sec decode
  jitterFactor: 0.2,          // 20% variation
};
