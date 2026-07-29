// Chapter 13 — Streaming and Token Economics
// Time-to-first-token modeling and measurement.
//
// TTFT matters because users perceive latency as the time until they
// see something happening, not the time until completion.

import type { LatencyModel, ModelTier } from './types.ts';
import { DEFAULT_LATENCY_MODEL } from './types.ts';

/** TTFT breakdown by phase. */
export interface TTFTBreakdown {
  queueTimeMs: number;      // Time waiting in inference queue
  prefillTimeMs: number;    // Time processing input tokens
  networkTimeMs: number;    // Network round-trip overhead
  totalTtftMs: number;      // Sum of all phases
}

/** Model the TTFT for a given request size. */
export function modelTTFT(
  inputTokens: number,
  queueDepth: number = 0,
  model: LatencyModel = DEFAULT_LATENCY_MODEL,
): TTFTBreakdown {
  // Queue time: each request ahead adds latency
  // Simplified model: assume 100ms average service time per queued request
  const queueTimeMs = queueDepth * 100;

  // Prefill time: processing input tokens
  // This is the dominant factor for long prompts
  const prefillTimeMs = inputTokens * model.perInputTokenMs;

  // Network overhead (constant)
  const networkTimeMs = model.baseLatencyMs * 0.3; // ~30% of base is network

  return {
    queueTimeMs,
    prefillTimeMs,
    networkTimeMs,
    totalTtftMs: queueTimeMs + prefillTimeMs + networkTimeMs,
  };
}

/** TTFT percentile tracker for monitoring. */
export class TTFTTracker {
  private samples: number[];
  private maxSamples: number;

  constructor(maxSamples: number = 1000) {
    this.samples = [];
    this.maxSamples = maxSamples;
  }

  record(ttftMs: number): void {
    this.samples.push(ttftMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  p50(): number {
    return this.percentile(50);
  }

  p95(): number {
    return this.percentile(95);
  }

  p99(): number {
    return this.percentile(99);
  }

  mean(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  count(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
  }
}

/** TTFT optimization strategies and their effects. */
export interface TTFTOptimization {
  name: string;
  description: string;
  ttftReduction: number; // Percentage reduction
  costImpact: number;    // Relative cost multiplier (1.0 = no change)
  tradeoff: string;
}

export const TTFT_OPTIMIZATIONS: TTFTOptimization[] = [
  {
    name: 'Prompt caching',
    description: 'Cache processed system prompts to skip re-prefill',
    ttftReduction: 0.4, // 40% reduction for repeated prompts
    costImpact: 0.9,    // Slight cost reduction (cached tokens cheaper)
    tradeoff: 'Only helps repeated prompts; cache misses see no benefit',
  },
  {
    name: 'Smaller model',
    description: 'Route to mid-tier instead of frontier',
    ttftReduction: 0.5, // 50% faster prefill
    costImpact: 0.2,    // 80% cost reduction
    tradeoff: 'Lower quality output; not suitable for complex tasks',
  },
  {
    name: 'Speculative decoding',
    description: 'Use small model to draft, large model to verify',
    ttftReduction: 0.1, // Slight TTFT improvement
    costImpact: 1.1,    // Slight cost increase
    tradeoff: 'Reduces decode time more than TTFT; complex to implement',
  },
  {
    name: 'Regional routing',
    description: 'Route to geographically closer inference server',
    ttftReduction: 0.15, // 15% reduction in network overhead
    costImpact: 1.0,     // No cost change
    tradeoff: 'Limited by provider availability; may affect failover',
  },
  {
    name: 'Prompt compression',
    description: 'Compress or summarize context before sending',
    ttftReduction: 0.3, // 30% reduction from shorter input
    costImpact: 1.1,    // Extra LLM call for compression
    tradeoff: 'Information loss; adds complexity; may hurt output quality',
  },
];

/** Apply an optimization and return the new TTFT. */
export function applyOptimization(
  baseTtftMs: number,
  optimization: TTFTOptimization,
): number {
  return baseTtftMs * (1 - optimization.ttftReduction);
}

/** Model TTFT by tier. Frontier models are slower due to size. */
export const TIER_TTFT_MULTIPLIER: Record<ModelTier, number> = {
  frontier: 2.0, // 2x slower TTFT
  mid: 1.0,      // baseline
  small: 0.5,    // 2x faster TTFT
};

/** Calculate expected TTFT for a tier. */
export function tierTTFT(
  inputTokens: number,
  tier: ModelTier,
  model: LatencyModel = DEFAULT_LATENCY_MODEL,
): number {
  const base = modelTTFT(inputTokens, 0, model);
  return base.totalTtftMs * TIER_TTFT_MULTIPLIER[tier];
}

/** TTFT budget checker: is this request likely to meet SLA? */
export interface TTFTBudgetCheck {
  expectedTtftMs: number;
  slaMs: number;
  withinBudget: boolean;
  headroomMs: number;
}

export function checkTTFTBudget(
  inputTokens: number,
  tier: ModelTier,
  slaMs: number,
  model?: LatencyModel,
): TTFTBudgetCheck {
  const expectedTtftMs = tierTTFT(inputTokens, tier, model);
  return {
    expectedTtftMs,
    slaMs,
    withinBudget: expectedTtftMs <= slaMs,
    headroomMs: slaMs - expectedTtftMs,
  };
}
