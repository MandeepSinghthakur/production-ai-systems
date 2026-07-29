// Core types for load balancing long-lived connections.
// See Chapter 3, "Building Production AI Systems".

/**
 * A backend server that can receive requests.
 */
export interface Backend {
  id: string;
  address: string;
  weight: number;
  healthy: boolean;
  activeConnections: number;
  totalRequests: number;
  totalLatencyMs: number;
  lastHealthCheck: number;
  consecutiveFailures: number;
}

/**
 * Configuration for the load balancer.
 */
export interface BalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted-round-robin';
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
  slowBackendMs: number;
}

/**
 * Result of selecting a backend.
 */
export interface SelectionResult {
  backend: Backend | null;
  reason: string;
  candidates: number;
  healthy: number;
}

/**
 * A simulated request to a backend.
 */
export interface Request {
  id: string;
  tenantId: string;
  startTime: number;
  estimatedDurationMs: number;
  actualDurationMs?: number;
  backendId?: string;
  sticky?: boolean;
}

/**
 * A long-lived connection (WebSocket or SSE).
 */
export interface Connection {
  id: string;
  tenantId: string;
  backendId: string;
  startTime: number;
  lastActivity: number;
  requestCount: number;
  state: 'active' | 'idle' | 'draining' | 'closed';
}

/**
 * Health check result for a backend.
 */
export interface HealthCheckResult {
  backendId: string;
  healthy: boolean;
  latencyMs: number;
  timestamp: number;
  reason?: string;
}

/**
 * Statistics for a backend.
 */
export interface BackendStats {
  id: string;
  activeConnections: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  healthy: boolean;
}

/**
 * Configuration for sticky sessions.
 */
export interface StickyConfig {
  enabled: boolean;
  ttlMs: number;
  cookieName: string;
  hashFunction: 'tenant' | 'session' | 'ip';
}

/**
 * A sticky session mapping.
 */
export interface StickySession {
  key: string;
  backendId: string;
  createdAt: number;
  lastAccessedAt: number;
  requestCount: number;
}

/**
 * Result of a sticky session lookup.
 */
export interface StickyResult {
  hit: boolean;
  session: StickySession | null;
  backend: Backend | null;
  fallback: boolean;
}

/**
 * Configuration for connection rebalancing.
 */
export interface RebalanceConfig {
  enabled: boolean;
  intervalMs: number;
  imbalanceThreshold: number;
  maxMigrationsPerCycle: number;
  drainTimeoutMs: number;
}

/**
 * Result of a rebalancing operation.
 */
export interface RebalanceResult {
  timestamp: number;
  migrationsAttempted: number;
  migrationsCompleted: number;
  connectionsPreserved: number;
  imbalanceBefore: number;
  imbalanceAfter: number;
}

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Request to the LLM via the load balancer.
 */
export interface LLMRequest {
  tenantId: string;
  sessionId?: string;
  prompt: string;
  tier: ModelTier;
  maxTokens: number;
  stream: boolean;
}
