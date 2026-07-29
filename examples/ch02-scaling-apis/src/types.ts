// Core types for scaling stateless and streaming APIs.
// See Chapter 2, "Building Production AI Systems".

/**
 * A simulated API request with timing metadata.
 */
export interface APIRequest {
  id: string;
  tenantId: string;
  payload: string;
  estimatedTokens: number;
  streaming: boolean;
  arrivedAt: number;
}

/**
 * Result of processing a request.
 */
export interface APIResponse {
  requestId: string;
  status: 'success' | 'rejected' | 'degraded';
  latencyMs: number;
  tokensProcessed: number;
  instanceId: string;
}

/**
 * Configuration for a simulated API instance.
 */
export interface InstanceConfig {
  id: string;
  maxConcurrency: number;
  processingTimeMs: number;
  streamChunkIntervalMs: number;
}

/**
 * Metrics for a single instance.
 */
export interface InstanceMetrics {
  instanceId: string;
  requestsProcessed: number;
  requestsRejected: number;
  tokensProcessed: number;
  currentConcurrency: number;
  peakConcurrency: number;
  avgLatencyMs: number;
}

/**
 * Load balancing strategy.
 */
export type LoadBalanceStrategy = 'round-robin' | 'least-connections' | 'random';

/**
 * Configuration for the load balancer.
 */
export interface LoadBalancerConfig {
  strategy: LoadBalanceStrategy;
  instances: InstanceConfig[];
  maxQueueSize: number;
  queueTimeoutMs: number;
}

/**
 * Streaming connection state.
 */
export interface StreamConnection {
  id: string;
  requestId: string;
  instanceId: string;
  startedAt: number;
  chunksDelivered: number;
  totalChunks: number;
  bytesDelivered: number;
  state: 'active' | 'completed' | 'aborted';
}

/**
 * Backpressure signal from downstream.
 */
export interface BackpressureSignal {
  type: 'pause' | 'resume' | 'abort';
  connectionId: string;
  reason?: string;
  timestamp: number;
}

/**
 * Configuration for backpressure handling.
 */
export interface BackpressureConfig {
  highWaterMark: number;
  lowWaterMark: number;
  maxBufferSize: number;
  pauseThresholdMs: number;
}

/**
 * Degradation level for graceful degradation.
 */
export type DegradationLevel = 'none' | 'shed-new' | 'shed-streaming' | 'emergency';

/**
 * Configuration for graceful degradation.
 */
export interface DegradationConfig {
  cpuThresholds: {
    shedNew: number;
    shedStreaming: number;
    emergency: number;
  };
  queueThresholds: {
    shedNew: number;
    shedStreaming: number;
    emergency: number;
  };
  recoveryHysteresis: number;
}

/**
 * System health snapshot.
 */
export interface SystemHealth {
  timestamp: number;
  cpuUtilization: number;
  memoryUtilization: number;
  queueDepth: number;
  activeConnections: number;
  degradationLevel: DegradationLevel;
}

/**
 * Throughput measurement result.
 */
export interface ThroughputResult {
  instanceCount: number;
  totalRequests: number;
  successfulRequests: number;
  rejectedRequests: number;
  totalTokens: number;
  durationMs: number;
  throughputRps: number;
  tokensPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}
