// Core types for conversational assistant system design.
// See Chapter 28, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Cost multiplier per token by tier. These are relative values,
 * not actual prices. Frontier is the baseline at 1.0.
 */
export const TIER_COST_MULTIPLIER: Record<ModelTier, number> = {
  frontier: 1.0,
  mid: 0.1,
  small: 0.01,
};

/**
 * Average tokens per model tier for estimation.
 * Input and output are tracked separately.
 */
export interface TokenProfile {
  avgInputTokens: number;
  avgOutputTokens: number;
}

export const TIER_TOKEN_PROFILE: Record<ModelTier, TokenProfile> = {
  frontier: { avgInputTokens: 4000, avgOutputTokens: 1500 },
  mid: { avgInputTokens: 2000, avgOutputTokens: 800 },
  small: { avgInputTokens: 500, avgOutputTokens: 200 },
};

/**
 * User tier for capacity planning.
 */
export type UserTier = 'free' | 'pro' | 'enterprise';

/**
 * Capacity requirements for the system.
 */
export interface CapacityRequirements {
  dailyActiveUsers: number;
  messagesPerUserPerDay: number;
  averageConversationTurns: number;
  peakToAverageRatio: number;
  modelTierDistribution: Record<ModelTier, number>;
  userTierDistribution: Record<UserTier, number>;
}

/**
 * Calculated capacity estimates.
 */
export interface CapacityEstimates {
  messagesPerDay: number;
  messagesPerSecondAverage: number;
  messagesPerSecondPeak: number;
  tokensPerDay: number;
  tokensPerSecondAverage: number;
  tokensPerSecondPeak: number;
  conversationsPerDay: number;
  memoryBytesPerConversation: number;
  totalMemoryBytes: number;
  costUnitsPerDay: number;
}

/**
 * Component in the architecture.
 */
export interface Component {
  name: string;
  type: 'service' | 'datastore' | 'queue' | 'external';
  replicaCount: number;
  requestsPerSecondCapacity: number;
  memoryMb: number;
  cpuCores: number;
  dependencies: string[];
}

/**
 * Architecture definition.
 */
export interface Architecture {
  components: Map<string, Component>;
  totalCpuCores: number;
  totalMemoryMb: number;
  throughputCapacity: number;
}

/**
 * Load simulation result.
 */
export interface SimulationResult {
  durationSeconds: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rejectedRequests: number;
  averageLatencyMs: number;
  p99LatencyMs: number;
  tokensProcessed: number;
  bottleneckComponent: string | null;
  capacityUtilization: Record<string, number>;
  failoverEvents: number;
  memoryPressureEvents: number;
}

/**
 * Scaling decision point.
 */
export interface ScalingPoint {
  usersThreshold: number;
  component: string;
  action: string;
  reason: string;
  costMultiplier: number;
}

/**
 * Cost projection.
 */
export interface CostProjection {
  dailyActiveUsers: number;
  computeCostUnits: number;
  tokenCostUnits: number;
  storageCostUnits: number;
  totalCostUnits: number;
  costPerUser: number;
  costPerMessage: number;
}

/**
 * Availability calculation.
 */
export interface AvailabilityEstimate {
  singleProviderAvailability: number;
  multiProviderAvailability: number;
  failoverLatencyMs: number;
  mttrSeconds: number;
}

/**
 * Memory budget for a conversation.
 */
export interface MemoryBudget {
  maxTurns: number;
  maxTokensPerTurn: number;
  summaryThreshold: number;
  bytesPerToken: number;
  totalBudgetBytes: number;
}

/**
 * Gateway throughput configuration.
 */
export interface GatewayConfig {
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
  retryBudgetRatio: number;
  circuitBreakerThreshold: number;
  rateLimitPerTenant: number;
}
