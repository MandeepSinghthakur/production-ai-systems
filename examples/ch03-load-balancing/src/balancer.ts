// Load balancing algorithms for long-lived AI connections.
// See Chapter 3, "Building Production AI Systems".

import type {
  Backend,
  BalancerConfig,
  SelectionResult,
  BackendStats,
} from './types.ts';

const DEFAULT_CONFIG: BalancerConfig = {
  algorithm: 'least-connections',
  healthCheckIntervalMs: 5000,
  healthCheckTimeoutMs: 2000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
  slowBackendMs: 5000,
};

/**
 * Load balancer that supports multiple algorithms and health-aware
 * routing for long-lived LLM connections.
 */
export class LoadBalancer {
  private backends: Map<string, Backend>;
  private config: BalancerConfig;
  private roundRobinIndex: number;
  private weightedIndex: number;
  private weightedCurrent: number;

  constructor(config: Partial<BalancerConfig> = {}) {
    this.backends = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.roundRobinIndex = 0;
    this.weightedIndex = 0;
    this.weightedCurrent = 0;
  }

  /**
   * Add a backend to the pool.
   */
  addBackend(id: string, address: string, weight: number = 1): void {
    const backend: Backend = {
      id,
      address,
      weight,
      healthy: true,
      activeConnections: 0,
      totalRequests: 0,
      totalLatencyMs: 0,
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
    };
    this.backends.set(id, backend);
  }

  /**
   * Remove a backend from the pool.
   */
  removeBackend(id: string): boolean {
    return this.backends.delete(id);
  }

  /**
   * Get all backends.
   */
  getBackends(): Backend[] {
    return Array.from(this.backends.values());
  }

  /**
   * Get healthy backends only.
   */
  getHealthyBackends(): Backend[] {
    return this.getBackends().filter((b) => b.healthy);
  }

  /**
   * Select a backend for a new request.
   */
  select(): SelectionResult {
    const all = this.getBackends();
    const healthy = this.getHealthyBackends();

    if (healthy.length === 0) {
      return {
        backend: null,
        reason: 'no_healthy_backends',
        candidates: all.length,
        healthy: 0,
      };
    }

    let backend: Backend;

    switch (this.config.algorithm) {
      case 'round-robin':
        backend = this.selectRoundRobin(healthy);
        break;
      case 'weighted-round-robin':
        backend = this.selectWeightedRoundRobin(healthy);
        break;
      case 'least-connections':
        backend = this.selectLeastConnections(healthy);
        break;
      default:
        backend = this.selectRoundRobin(healthy);
    }

    return {
      backend,
      reason: this.config.algorithm,
      candidates: all.length,
      healthy: healthy.length,
    };
  }

  /**
   * Round-robin selection: each backend gets requests in turn.
   */
  private selectRoundRobin(backends: Backend[]): Backend {
    const index = this.roundRobinIndex % backends.length;
    this.roundRobinIndex++;
    return backends[index];
  }

  /**
   * Weighted round-robin: backends with higher weights get more
   * requests proportionally.
   */
  private selectWeightedRoundRobin(backends: Backend[]): Backend {
    // Sort by id for deterministic ordering
    const sorted = [...backends].sort((a, b) => a.id.localeCompare(b.id));

    // Find max weight for the algorithm
    const maxWeight = Math.max(...sorted.map((b) => b.weight));
    const gcd = this.gcdArray(sorted.map((b) => b.weight));

    while (true) {
      this.weightedIndex = (this.weightedIndex + 1) % sorted.length;

      if (this.weightedIndex === 0) {
        this.weightedCurrent = this.weightedCurrent - gcd;
        if (this.weightedCurrent <= 0) {
          this.weightedCurrent = maxWeight;
        }
      }

      const backend = sorted[this.weightedIndex];
      if (backend.weight >= this.weightedCurrent) {
        return backend;
      }
    }
  }

  /**
   * Least-connections selection: pick the backend with fewest active
   * connections. This naturally handles variable request durations.
   */
  private selectLeastConnections(backends: Backend[]): Backend {
    let selected = backends[0];
    let minConnections = selected.activeConnections;

    for (let i = 1; i < backends.length; i++) {
      const backend = backends[i];
      // Tie-break by total latency (prefer faster backends)
      if (
        backend.activeConnections < minConnections ||
        (backend.activeConnections === minConnections &&
          this.avgLatency(backend) < this.avgLatency(selected))
      ) {
        selected = backend;
        minConnections = backend.activeConnections;
      }
    }

    return selected;
  }

  /**
   * Record that a connection started on a backend.
   */
  recordConnectionStart(backendId: string): void {
    const backend = this.backends.get(backendId);
    if (backend) {
      backend.activeConnections++;
      backend.totalRequests++;
    }
  }

  /**
   * Record that a connection ended on a backend.
   */
  recordConnectionEnd(backendId: string, latencyMs: number): void {
    const backend = this.backends.get(backendId);
    if (backend) {
      backend.activeConnections = Math.max(0, backend.activeConnections - 1);
      backend.totalLatencyMs += latencyMs;
    }
  }

  /**
   * Mark a backend as healthy or unhealthy.
   */
  setHealth(backendId: string, healthy: boolean): void {
    const backend = this.backends.get(backendId);
    if (backend) {
      backend.healthy = healthy;
      backend.lastHealthCheck = Date.now();
      if (healthy) {
        backend.consecutiveFailures = 0;
      } else {
        backend.consecutiveFailures++;
      }
    }
  }

  /**
   * Get statistics for all backends.
   */
  getStats(): BackendStats[] {
    const now = Date.now();
    return this.getBackends().map((b) => ({
      id: b.id,
      activeConnections: b.activeConnections,
      requestsPerSecond: 0, // Would need time-series tracking
      avgLatencyMs: this.avgLatency(b),
      errorRate: 0, // Would need error tracking
      healthy: b.healthy,
    }));
  }

  /**
   * Calculate coefficient of variation for connection distribution.
   * Lower is better balanced.
   */
  getImbalance(): number {
    const healthy = this.getHealthyBackends();
    if (healthy.length < 2) return 0;

    const connections = healthy.map((b) => b.activeConnections);
    const mean = connections.reduce((a, b) => a + b, 0) / connections.length;

    if (mean === 0) return 0;

    const variance =
      connections.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) /
      connections.length;
    const stdDev = Math.sqrt(variance);

    return stdDev / mean; // Coefficient of variation
  }

  /**
   * Get current configuration.
   */
  getConfig(): BalancerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<BalancerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private avgLatency(backend: Backend): number {
    if (backend.totalRequests === 0) return 0;
    return backend.totalLatencyMs / backend.totalRequests;
  }

  private gcdArray(arr: number[]): number {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    return arr.reduce((acc, val) => gcd(acc, val), arr[0]);
  }
}

export { DEFAULT_CONFIG };
