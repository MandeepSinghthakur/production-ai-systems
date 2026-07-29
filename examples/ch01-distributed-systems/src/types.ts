// Core types for distributed systems concepts in AI workloads.
// See Chapter 1, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Consistency level for a distributed operation.
 */
export type ConsistencyLevel = 'eventual' | 'strong' | 'causal';

/**
 * A node in a distributed system.
 */
export interface Node {
  id: string;
  state: Record<string, unknown>;
  clock: number;
  healthy: boolean;
  latencyMs: number;
}

/**
 * Result of a read operation with consistency metadata.
 */
export interface ReadResult {
  value: unknown;
  consistencyLevel: ConsistencyLevel;
  fromNode: string;
  staleness: number;
  latencyMs: number;
}

/**
 * Result of a write operation with replication status.
 */
export interface WriteResult {
  success: boolean;
  nodesAcked: number;
  requiredAcks: number;
  latencyMs: number;
}

/**
 * Configuration for timeout strategy.
 */
export interface TimeoutConfig {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  jitterRatio: number;
}

/**
 * Result of a request with timeout handling.
 */
export interface TimeoutResult {
  success: boolean;
  attempts: number;
  totalLatencyMs: number;
  timedOut: boolean;
}

/**
 * Failure detection configuration.
 */
export interface FailureDetectorConfig {
  heartbeatIntervalMs: number;
  suspectThresholdMs: number;
  failureThresholdMs: number;
  phiThreshold: number;
}

/**
 * Health status of a node as seen by the failure detector.
 */
export type NodeHealth = 'healthy' | 'suspect' | 'failed';

/**
 * Failure detection result for a node.
 */
export interface FailureDetectionResult {
  nodeId: string;
  status: NodeHealth;
  lastHeartbeat: number;
  phi: number;
  latencyMs: number;
}

/**
 * Token-based capacity model for LLM workloads.
 */
export interface TokenCapacity {
  tokensPerSecond: number;
  maxConcurrentRequests: number;
  averageTokensPerRequest: number;
}

/**
 * Request-based capacity model for traditional APIs.
 */
export interface RequestCapacity {
  requestsPerSecond: number;
  maxConcurrentRequests: number;
  averageLatencyMs: number;
}

/**
 * Result of capacity planning calculation.
 */
export interface CapacityResult {
  effectiveRps: number;
  utilizationPercent: number;
  queueDepth: number;
  waitTimeMs: number;
}

/**
 * Latency distribution parameters (log-normal).
 */
export interface LatencyDistribution {
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  mean: number;
  stdDev: number;
}

/**
 * Simulated LLM request.
 */
export interface LLMRequest {
  id: string;
  tier: ModelTier;
  inputTokens: number;
  maxOutputTokens: number;
  priority: 'high' | 'normal' | 'low';
}

/**
 * Simulated LLM response.
 */
export interface LLMResponse {
  requestId: string;
  outputTokens: number;
  latencyMs: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
}

/**
 * CAP theorem partition state.
 */
export interface PartitionState {
  partitioned: boolean;
  partitionStartMs: number;
  affectedNodes: string[];
}

/**
 * Convergence tracking for eventual consistency.
 */
export interface ConvergenceState {
  converged: boolean;
  divergentNodes: string[];
  maxStalenessMs: number;
  replicationLag: number;
}
