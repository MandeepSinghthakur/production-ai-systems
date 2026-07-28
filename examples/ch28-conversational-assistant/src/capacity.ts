// Capacity planning calculations for conversational assistant.
// See Chapter 28, "Building Production AI Systems".
//
// These calculations form the foundation of system design interviews:
// work from requirements to concrete numbers before drawing architecture.

import type {
  CapacityRequirements,
  CapacityEstimates,
  ModelTier,
  MemoryBudget,
  CostProjection,
  AvailabilityEstimate,
} from './types.ts';
import { TIER_COST_MULTIPLIER, TIER_TOKEN_PROFILE } from './types.ts';

const SECONDS_PER_DAY = 86400;
const BYTES_PER_TOKEN = 4; // Approximate, varies by tokenizer

/**
 * Calculate capacity estimates from requirements.
 * This is the first step in any system design: turn user counts into
 * concrete throughput and storage numbers.
 */
export function calculateCapacity(
  requirements: CapacityRequirements
): CapacityEstimates {
  const {
    dailyActiveUsers,
    messagesPerUserPerDay,
    averageConversationTurns,
    peakToAverageRatio,
    modelTierDistribution,
  } = requirements;

  // Messages per day = users * messages per user
  const messagesPerDay = dailyActiveUsers * messagesPerUserPerDay;

  // Average messages per second = total / seconds in day
  const messagesPerSecondAverage = messagesPerDay / SECONDS_PER_DAY;

  // Peak = average * ratio (typically 3-5x for consumer apps)
  const messagesPerSecondPeak = messagesPerSecondAverage * peakToAverageRatio;

  // Tokens per message, weighted by tier distribution
  let avgTokensPerMessage = 0;
  for (const tier of Object.keys(modelTierDistribution) as ModelTier[]) {
    const profile = TIER_TOKEN_PROFILE[tier];
    const weight = modelTierDistribution[tier];
    avgTokensPerMessage +=
      (profile.avgInputTokens + profile.avgOutputTokens) * weight;
  }

  const tokensPerDay = messagesPerDay * avgTokensPerMessage;
  const tokensPerSecondAverage = tokensPerDay / SECONDS_PER_DAY;
  const tokensPerSecondPeak = tokensPerSecondAverage * peakToAverageRatio;

  // Conversations = messages / turns per conversation
  const conversationsPerDay = messagesPerDay / averageConversationTurns;

  // Memory per conversation: store history for context
  // Each turn = input + output tokens, stored as text
  const memoryBytesPerConversation =
    averageConversationTurns * avgTokensPerMessage * BYTES_PER_TOKEN;

  // Total memory: concurrent conversations * memory per conversation
  // Assume 10% of daily conversations are active concurrently
  const concurrentConversations = Math.ceil(conversationsPerDay * 0.1);
  const totalMemoryBytes = concurrentConversations * memoryBytesPerConversation;

  // Cost units per day, weighted by tier
  let costUnitsPerDay = 0;
  for (const tier of Object.keys(modelTierDistribution) as ModelTier[]) {
    const profile = TIER_TOKEN_PROFILE[tier];
    const weight = modelTierDistribution[tier];
    const tierTokens = messagesPerDay * weight;
    const tierCost =
      tierTokens *
      (profile.avgInputTokens + profile.avgOutputTokens) *
      TIER_COST_MULTIPLIER[tier];
    costUnitsPerDay += tierCost;
  }

  return {
    messagesPerDay,
    messagesPerSecondAverage,
    messagesPerSecondPeak,
    tokensPerDay,
    tokensPerSecondAverage,
    tokensPerSecondPeak,
    conversationsPerDay,
    memoryBytesPerConversation,
    totalMemoryBytes,
    costUnitsPerDay,
  };
}

/**
 * Calculate memory budget per conversation.
 * Memory management is critical: unbounded history leads to OOM or
 * context window overflow. This function defines the constraints.
 */
export function calculateMemoryBudget(
  maxContextTokens: number,
  reservedForSystemPrompt: number,
  reservedForOutput: number
): MemoryBudget {
  // Available for conversation history
  const availableTokens =
    maxContextTokens - reservedForSystemPrompt - reservedForOutput;

  // Typical turn size (input + output)
  const avgTokensPerTurn = 2500;

  // How many turns fit in the budget
  const maxTurns = Math.floor(availableTokens / avgTokensPerTurn);

  // Summarize when we hit 80% of capacity to leave room
  const summaryThreshold = Math.floor(maxTurns * 0.8);

  return {
    maxTurns,
    maxTokensPerTurn: avgTokensPerTurn,
    summaryThreshold,
    bytesPerToken: BYTES_PER_TOKEN,
    totalBudgetBytes: availableTokens * BYTES_PER_TOKEN,
  };
}

/**
 * Project costs for different user scales.
 * This answers the interview question: "How does cost scale with users?"
 */
export function projectCosts(
  requirements: CapacityRequirements,
  userCounts: number[]
): CostProjection[] {
  return userCounts.map((users) => {
    const scaled = { ...requirements, dailyActiveUsers: users };
    const capacity = calculateCapacity(scaled);

    // Compute cost: assume 1 CPU-hour per 10,000 messages
    const computeCostUnits = capacity.messagesPerDay / 10000;

    // Token cost: from capacity calculation
    const tokenCostUnits = capacity.costUnitsPerDay / 1000; // Normalize

    // Storage cost: 1 unit per GB-day
    const storageCostUnits = capacity.totalMemoryBytes / (1024 * 1024 * 1024);

    const totalCostUnits = computeCostUnits + tokenCostUnits + storageCostUnits;

    return {
      dailyActiveUsers: users,
      computeCostUnits,
      tokenCostUnits,
      storageCostUnits,
      totalCostUnits,
      costPerUser: totalCostUnits / users,
      costPerMessage: totalCostUnits / capacity.messagesPerDay,
    };
  });
}

/**
 * Calculate availability with single vs multi-provider.
 * This demonstrates why Chapter 19's failover matters.
 */
export function calculateAvailability(
  singleProviderUptime: number,
  providerCount: number,
  failoverLatencyMs: number
): AvailabilityEstimate {
  // Single provider: just their uptime
  const singleProviderAvailability = singleProviderUptime;

  // Multi-provider: availability = 1 - (all providers down simultaneously)
  // Assumes independent failures, which is optimistic but useful
  const allDownProbability = Math.pow(1 - singleProviderUptime, providerCount);
  const multiProviderAvailability = 1 - allDownProbability;

  // MTTR: failover latency for automated failover
  const mttrSeconds = failoverLatencyMs / 1000;

  return {
    singleProviderAvailability,
    multiProviderAvailability,
    failoverLatencyMs,
    mttrSeconds,
  };
}

/**
 * Validate that capacity estimates are internally consistent.
 * This catches errors in calculations before they become production bugs.
 */
export function validateCapacity(
  requirements: CapacityRequirements,
  estimates: CapacityEstimates
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check: tokens per user * users = total tokens
  let expectedTokensPerMessage = 0;
  for (const tier of Object.keys(
    requirements.modelTierDistribution
  ) as ModelTier[]) {
    const profile = TIER_TOKEN_PROFILE[tier];
    const weight = requirements.modelTierDistribution[tier];
    expectedTokensPerMessage +=
      (profile.avgInputTokens + profile.avgOutputTokens) * weight;
  }

  const expectedTokensPerDay =
    requirements.dailyActiveUsers *
    requirements.messagesPerUserPerDay *
    expectedTokensPerMessage;

  const tokenDiff = Math.abs(estimates.tokensPerDay - expectedTokensPerDay);
  if (tokenDiff > expectedTokensPerDay * 0.01) {
    errors.push(
      `Token calculation inconsistent: expected ${expectedTokensPerDay}, ` +
        `got ${estimates.tokensPerDay}`
    );
  }

  // Check: peak >= average
  if (estimates.messagesPerSecondPeak < estimates.messagesPerSecondAverage) {
    errors.push('Peak throughput cannot be less than average');
  }

  // Check: messages per day = users * messages per user
  const expectedMessages =
    requirements.dailyActiveUsers * requirements.messagesPerUserPerDay;
  if (estimates.messagesPerDay !== expectedMessages) {
    errors.push(
      `Messages per day inconsistent: expected ${expectedMessages}, ` +
        `got ${estimates.messagesPerDay}`
    );
  }

  // Check: conversations = messages / turns
  const expectedConversations = Math.floor(
    estimates.messagesPerDay / requirements.averageConversationTurns
  );
  const convDiff = Math.abs(
    estimates.conversationsPerDay - expectedConversations
  );
  if (convDiff > 1) {
    errors.push(
      `Conversations per day inconsistent: expected ${expectedConversations}, ` +
        `got ${estimates.conversationsPerDay}`
    );
  }

  // Check: tier distribution sums to 1
  const tierSum = Object.values(requirements.modelTierDistribution).reduce(
    (a, b) => a + b,
    0
  );
  if (Math.abs(tierSum - 1.0) > 0.001) {
    errors.push(`Model tier distribution must sum to 1.0, got ${tierSum}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate gateway throughput requirements.
 * The gateway is the bottleneck in most AI systems.
 */
export function calculateGatewayRequirements(
  estimates: CapacityEstimates,
  avgRequestDurationMs: number
): {
  minConcurrentConnections: number;
  recommendedConcurrentConnections: number;
  headroomFactor: number;
} {
  // Little's Law: L = lambda * W
  // Concurrent connections = arrival rate * service time
  const arrivalRate = estimates.messagesPerSecondPeak;
  const serviceTime = avgRequestDurationMs / 1000;

  const minConcurrentConnections = Math.ceil(arrivalRate * serviceTime);

  // Add 50% headroom for bursts
  const headroomFactor = 1.5;
  const recommendedConcurrentConnections = Math.ceil(
    minConcurrentConnections * headroomFactor
  );

  return {
    minConcurrentConnections,
    recommendedConcurrentConnections,
    headroomFactor,
  };
}
