// Chapter 13 — Streaming and Token Economics
// Token cost modeling and unit economics.
//
// Key insight: cost scales with tokens, not requests. A single request
// can cost 100x more than another to the same endpoint.

import type { ModelTier, UsageRecord } from './types.ts';
import { TIER_COST_MULTIPLIER, OUTPUT_MULTIPLIER } from './types.ts';

/** Cost calculation result. */
export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
}

/** Calculate cost in normalized units (1 unit = cost of 1 small-tier token). */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  tier: ModelTier,
): CostBreakdown {
  const tierMultiplier = TIER_COST_MULTIPLIER[tier];
  const inputCost = inputTokens * tierMultiplier;
  const outputCost = outputTokens * tierMultiplier * OUTPUT_MULTIPLIER;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    tier,
    inputTokens,
    outputTokens,
  };
}

/** Cost variance between best and worst case for same task. */
export interface CostVariance {
  minCost: number;
  maxCost: number;
  variance: number; // maxCost / minCost
  factors: string[];
}

export function analyzeCostVariance(
  inputTokens: number,
  outputTokens: number,
): CostVariance {
  const smallCost = calculateCost(inputTokens, outputTokens, 'small');
  const frontierCost = calculateCost(inputTokens, outputTokens, 'frontier');

  return {
    minCost: smallCost.totalCost,
    maxCost: frontierCost.totalCost,
    variance: frontierCost.totalCost / smallCost.totalCost,
    factors: [
      `Tier selection: ${TIER_COST_MULTIPLIER.frontier}x between small and frontier`,
      `Output ratio: ${OUTPUT_MULTIPLIER}x for output vs input tokens`,
      `Output length: variable based on response complexity`,
    ],
  };
}

/** Usage aggregator for cost attribution. */
export class CostAggregator {
  private records: UsageRecord[];

  constructor() {
    this.records = [];
  }

  record(usage: UsageRecord): void {
    this.records.push(usage);
  }

  /** Get total cost by tenant. */
  byTenant(): Map<string, number> {
    const result = new Map<string, number>();
    for (const r of this.records) {
      const current = result.get(r.tenant) ?? 0;
      result.set(r.tenant, current + r.costUnits);
    }
    return result;
  }

  /** Get total cost by tier. */
  byTier(): Map<ModelTier, number> {
    const result = new Map<ModelTier, number>();
    for (const r of this.records) {
      const current = result.get(r.tier) ?? 0;
      result.set(r.tier, current + r.costUnits);
    }
    return result;
  }

  /** Get records for a specific tenant. */
  forTenant(tenant: string): UsageRecord[] {
    return this.records.filter((r) => r.tenant === tenant);
  }

  /** Total tokens across all records. */
  totalTokens(): { input: number; output: number } {
    let input = 0;
    let output = 0;
    for (const r of this.records) {
      input += r.inputTokens;
      output += r.outputTokens;
    }
    return { input, output };
  }

  /** Total cost units. */
  totalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUnits, 0);
  }

  /** Number of records. */
  count(): number {
    return this.records.length;
  }

  /** Clear all records. */
  reset(): void {
    this.records = [];
  }
}

/** Model the cost impact of streaming vs non-streaming. */
export interface StreamingCostAnalysis {
  fullResponseCost: number;
  earlyTerminationSavings: number;
  terminationPoint: number; // Fraction of response when terminated
  tokensSaved: number;
}

export function analyzeEarlyTermination(
  inputTokens: number,
  expectedOutputTokens: number,
  terminationFraction: number, // 0.0 to 1.0
  tier: ModelTier,
): StreamingCostAnalysis {
  const fullCost = calculateCost(inputTokens, expectedOutputTokens, tier);
  const actualOutputTokens = Math.floor(
    expectedOutputTokens * terminationFraction,
  );
  const partialCost = calculateCost(inputTokens, actualOutputTokens, tier);

  return {
    fullResponseCost: fullCost.totalCost,
    earlyTerminationSavings: fullCost.totalCost - partialCost.totalCost,
    terminationPoint: terminationFraction,
    tokensSaved: expectedOutputTokens - actualOutputTokens,
  };
}

/** Cost per quality unit — helps compare tier efficiency. */
export interface CostEfficiency {
  tier: ModelTier;
  costPerToken: number;
  qualityScore: number; // Relative quality (1.0 = small baseline)
  costPerQualityUnit: number;
}

// Relative quality scores (hypothetical, for demonstration)
const TIER_QUALITY: Record<ModelTier, number> = {
  frontier: 1.5,  // 50% better quality
  mid: 1.2,       // 20% better quality
  small: 1.0,     // baseline
};

export function calculateEfficiency(tier: ModelTier): CostEfficiency {
  const costPerToken = TIER_COST_MULTIPLIER[tier];
  const qualityScore = TIER_QUALITY[tier];

  return {
    tier,
    costPerToken,
    qualityScore,
    costPerQualityUnit: costPerToken / qualityScore,
  };
}

/** Find the most cost-efficient tier for a given quality requirement. */
export function recommendTier(minQuality: number): ModelTier {
  const tiers: ModelTier[] = ['small', 'mid', 'frontier'];

  // Filter tiers that meet quality requirement
  const eligible = tiers.filter((t) => TIER_QUALITY[t] >= minQuality);

  if (eligible.length === 0) {
    return 'frontier'; // Best we have
  }

  // Return cheapest that meets requirement
  return eligible.reduce((best, current) => {
    const bestCost = TIER_COST_MULTIPLIER[best];
    const currentCost = TIER_COST_MULTIPLIER[current];
    return currentCost < bestCost ? current : best;
  });
}

/** Estimate monthly cost for a workload. */
export interface MonthlyEstimate {
  requestsPerDay: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  tier: ModelTier;
  dailyCost: number;
  monthlyCost: number;
  tokensPerMonth: number;
}

export function estimateMonthlyCost(
  requestsPerDay: number,
  avgInputTokens: number,
  avgOutputTokens: number,
  tier: ModelTier,
): MonthlyEstimate {
  const perRequestCost = calculateCost(
    avgInputTokens,
    avgOutputTokens,
    tier,
  ).totalCost;
  const dailyCost = perRequestCost * requestsPerDay;
  const monthlyCost = dailyCost * 30;
  const tokensPerMonth = (avgInputTokens + avgOutputTokens) *
    requestsPerDay * 30;

  return {
    requestsPerDay,
    avgInputTokens,
    avgOutputTokens,
    tier,
    dailyCost,
    monthlyCost,
    tokensPerMonth,
  };
}
