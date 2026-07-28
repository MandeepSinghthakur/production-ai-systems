// Cost projections for conversational assistant.
// See Chapter 28, "Building Production AI Systems".
//
// Projects costs across different user scales and validates
// that cost estimates are consistent with capacity estimates.

import type {
  CapacityRequirements,
  CapacityEstimates,
  CostProjection,
  ModelTier,
} from './types.ts';
import { TIER_COST_MULTIPLIER, TIER_TOKEN_PROFILE } from './types.ts';
import { calculateCapacity } from './capacity.ts';

/**
 * Project infrastructure costs based on capacity.
 * Infrastructure = compute + storage, separate from token costs.
 */
export function projectInfrastructureCost(
  estimates: CapacityEstimates,
  cpuCostPerCoreHour: number,
  memoryCostPerGbHour: number,
  storageCostPerGbMonth: number
): {
  dailyComputeCost: number;
  dailyMemoryCost: number;
  dailyStorageCost: number;
  totalDailyCost: number;
} {
  // Compute: based on CPU cores needed for gateway
  // Rough estimate: 1 core per 50 requests/second
  const coresNeeded = Math.ceil(estimates.messagesPerSecondPeak / 50);
  const dailyComputeCost = coresNeeded * cpuCostPerCoreHour * 24;

  // Memory: conversation state
  const memoryGb = estimates.totalMemoryBytes / (1024 * 1024 * 1024);
  const dailyMemoryCost = memoryGb * memoryCostPerGbHour * 24;

  // Storage: ledger and conversation history
  // Assume 10x memory for persistent storage
  const storageGb = memoryGb * 10;
  const dailyStorageCost = (storageGb * storageCostPerGbMonth) / 30;

  return {
    dailyComputeCost,
    dailyMemoryCost,
    dailyStorageCost,
    totalDailyCost: dailyComputeCost + dailyMemoryCost + dailyStorageCost,
  };
}

/**
 * Project token costs based on usage.
 * Token costs dominate at scale; infrastructure is secondary.
 */
export function projectTokenCost(
  estimates: CapacityEstimates,
  tierDistribution: Record<ModelTier, number>,
  costPerMillionTokens: Record<ModelTier, number>
): {
  dailyTokenCost: number;
  costByTier: Record<ModelTier, number>;
  avgCostPerMessage: number;
} {
  const costByTier: Record<ModelTier, number> = {
    frontier: 0,
    mid: 0,
    small: 0,
  };

  let dailyTokenCost = 0;

  for (const tier of Object.keys(tierDistribution) as ModelTier[]) {
    const tierFraction = tierDistribution[tier];
    const tierTokens = estimates.tokensPerDay * tierFraction;
    const tierCost = (tierTokens / 1_000_000) * costPerMillionTokens[tier];
    costByTier[tier] = tierCost;
    dailyTokenCost += tierCost;
  }

  const avgCostPerMessage = dailyTokenCost / estimates.messagesPerDay;

  return {
    dailyTokenCost,
    costByTier,
    avgCostPerMessage,
  };
}

/**
 * Validate cost projections against capacity estimates.
 * Ensures internal consistency: tokens * cost_per_token = total_cost.
 *
 * The calculation matches capacity.ts: for each tier, we calculate
 * messages * weight * (input + output tokens) * cost multiplier.
 */
export function validateCostProjection(
  estimates: CapacityEstimates,
  tierDistribution: Record<ModelTier, number>,
  projectedCost: number
): { valid: boolean; errors: string[]; expectedCost: number } {
  const errors: string[] = [];

  // Calculate expected cost from tokens and tier distribution
  // Must match the calculation in capacity.ts exactly
  let expectedCost = 0;

  for (const tier of Object.keys(tierDistribution) as ModelTier[]) {
    const profile = TIER_TOKEN_PROFILE[tier];
    const tierFraction = tierDistribution[tier];
    // tierMessages * tokensPerMessage * costMultiplier
    const tierMessages = estimates.messagesPerDay * tierFraction;
    const tokensPerMessage = profile.avgInputTokens + profile.avgOutputTokens;
    const tierCost = tierMessages * tokensPerMessage * TIER_COST_MULTIPLIER[tier];
    expectedCost += tierCost;
  }

  // Allow 1% tolerance for rounding
  const diff = Math.abs(projectedCost - expectedCost);
  const tolerance = expectedCost * 0.01;

  if (diff > tolerance && expectedCost > 0) {
    errors.push(
      `Cost projection mismatch: projected ${projectedCost.toFixed(2)}, ` +
        `expected ${expectedCost.toFixed(2)} based on token estimates`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    expectedCost,
  };
}

/**
 * Calculate cost scaling factor at different user levels.
 * Shows how cost-per-user changes with scale.
 */
export function calculateCostScaling(
  baseRequirements: CapacityRequirements,
  userMultipliers: number[]
): Array<{
  users: number;
  totalCostUnits: number;
  costPerUser: number;
  scalingEfficiency: number;
}> {
  const baseCap = calculateCapacity(baseRequirements);
  const baseCostPerUser = baseCap.costUnitsPerDay / baseRequirements.dailyActiveUsers;

  return userMultipliers.map((multiplier) => {
    const scaledUsers = baseRequirements.dailyActiveUsers * multiplier;
    const scaledReq = { ...baseRequirements, dailyActiveUsers: scaledUsers };
    const scaledCap = calculateCapacity(scaledReq);

    const costPerUser = scaledCap.costUnitsPerDay / scaledUsers;

    // Efficiency: how much cheaper per user compared to baseline
    // Values > 1 mean economies of scale, < 1 means diseconomies
    const scalingEfficiency = baseCostPerUser / costPerUser;

    return {
      users: scaledUsers,
      totalCostUnits: scaledCap.costUnitsPerDay,
      costPerUser,
      scalingEfficiency,
    };
  });
}

/**
 * Calculate break-even point for self-hosting vs API.
 * At what scale does running your own infrastructure make sense?
 */
export function calculateBreakEven(
  apiCostPerMessage: number,
  selfHostFixedCost: number,
  selfHostVariableCostPerMessage: number
): {
  breakEvenMessages: number;
  breakEvenUsers: number;
  messagesPerUserPerDay: number;
} {
  // Break-even: API cost = self-host cost
  // messages * api_cost = fixed + messages * variable
  // messages * (api_cost - variable) = fixed
  // messages = fixed / (api_cost - variable)

  const costDiff = apiCostPerMessage - selfHostVariableCostPerMessage;

  if (costDiff <= 0) {
    // Self-hosting is never cheaper
    return {
      breakEvenMessages: Infinity,
      breakEvenUsers: Infinity,
      messagesPerUserPerDay: 10, // Assume typical
    };
  }

  const breakEvenMessages = Math.ceil(selfHostFixedCost / costDiff);

  // Assume 10 messages per user per day
  const messagesPerUserPerDay = 10;
  const breakEvenUsers = Math.ceil(breakEvenMessages / messagesPerUserPerDay);

  return {
    breakEvenMessages,
    breakEvenUsers,
    messagesPerUserPerDay,
  };
}

/**
 * Generate cost envelope constraints.
 * These are the bounds that must hold for the design to be viable.
 */
export function generateCostEnvelope(
  requirements: CapacityRequirements,
  maxCostPerUserPerMonth: number
): {
  dailyBudget: number;
  maxTokensPerUser: number;
  maxMessagesPerUser: number;
  tierConstraints: Record<ModelTier, number>;
} {
  const dailyBudget =
    (maxCostPerUserPerMonth / 30) * requirements.dailyActiveUsers;

  // Work backwards from budget to token limits
  // Assume mid-tier as the average
  const avgCostPerToken = TIER_COST_MULTIPLIER.mid;
  const profile = TIER_TOKEN_PROFILE.mid;
  const tokensPerMessage = profile.avgInputTokens + profile.avgOutputTokens;

  const maxTokensTotal = dailyBudget / avgCostPerToken;
  const maxTokensPerUser = maxTokensTotal / requirements.dailyActiveUsers;
  const maxMessagesPerUser = maxTokensPerUser / tokensPerMessage;

  // Tier constraints: what fraction can be frontier while staying in budget
  // frontier is 10x mid, so can only use 10% of tokens on frontier
  const tierConstraints: Record<ModelTier, number> = {
    frontier:
      (dailyBudget * 0.1) /
      (requirements.dailyActiveUsers *
        requirements.messagesPerUserPerDay *
        tokensPerMessage *
        TIER_COST_MULTIPLIER.frontier),
    mid: 1.0, // Can use all mid
    small: 1.0, // Can use all small
  };

  return {
    dailyBudget,
    maxTokensPerUser,
    maxMessagesPerUser,
    tierConstraints,
  };
}
