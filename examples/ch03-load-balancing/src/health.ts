// Health checking for backends with slow-response detection.
// See Chapter 3, "Building Production AI Systems".

import type { Backend, HealthCheckResult } from './types.ts';

/**
 * Configuration for the health checker.
 */
export interface HealthCheckerConfig {
  intervalMs: number;
  timeoutMs: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
  slowThresholdMs: number;
}

const DEFAULT_CONFIG: HealthCheckerConfig = {
  intervalMs: 5000,
  timeoutMs: 2000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
  slowThresholdMs: 5000,
};

/**
 * Track health check history for a backend.
 */
interface BackendHealthState {
  backendId: string;
  healthy: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  slowResponses: number;
  history: HealthCheckResult[];
  lastCheck: number;
}

/**
 * Health checker that detects both failed and slow backends.
 * Slow backends are critical for LLM workloads where a 40-second
 * p99 latency looks healthy by error rate but degrades user experience.
 */
export class HealthChecker {
  private config: HealthCheckerConfig;
  private states: Map<string, BackendHealthState>;
  private checkFn: ((backend: Backend) => Promise<HealthCheckResult>) | null;

  constructor(config: Partial<HealthCheckerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.states = new Map();
    this.checkFn = null;
  }

  /**
   * Register a backend for health checking.
   */
  register(backend: Backend): void {
    this.states.set(backend.id, {
      backendId: backend.id,
      healthy: backend.healthy,
      consecutiveSuccesses: backend.healthy ? this.config.healthyThreshold : 0,
      consecutiveFailures: backend.healthy ? 0 : this.config.unhealthyThreshold,
      slowResponses: 0,
      history: [],
      lastCheck: 0,
    });
  }

  /**
   * Unregister a backend.
   */
  unregister(backendId: string): void {
    this.states.delete(backendId);
  }

  /**
   * Set the function used to perform health checks.
   */
  setCheckFunction(fn: (backend: Backend) => Promise<HealthCheckResult>): void {
    this.checkFn = fn;
  }

  /**
   * Record a health check result (for testing or external checks).
   */
  recordResult(result: HealthCheckResult): boolean {
    const state = this.states.get(result.backendId);
    if (!state) return false;

    state.lastCheck = result.timestamp;
    state.history.push(result);

    // Keep only recent history
    if (state.history.length > 100) {
      state.history = state.history.slice(-100);
    }

    if (result.healthy) {
      state.consecutiveFailures = 0;
      state.consecutiveSuccesses++;

      // Check for slow response
      if (result.latencyMs > this.config.slowThresholdMs) {
        state.slowResponses++;
      } else {
        state.slowResponses = Math.max(0, state.slowResponses - 1);
      }

      // Transition to healthy after threshold
      if (
        !state.healthy &&
        state.consecutiveSuccesses >= this.config.healthyThreshold
      ) {
        state.healthy = true;
        return true; // State changed
      }
    } else {
      state.consecutiveSuccesses = 0;
      state.consecutiveFailures++;

      // Transition to unhealthy after threshold
      if (
        state.healthy &&
        state.consecutiveFailures >= this.config.unhealthyThreshold
      ) {
        state.healthy = false;
        return true; // State changed
      }
    }

    return false;
  }

  /**
   * Check if a backend is healthy.
   */
  isHealthy(backendId: string): boolean {
    const state = this.states.get(backendId);
    return state?.healthy ?? false;
  }

  /**
   * Check if a backend is responding slowly (healthy but degraded).
   */
  isSlow(backendId: string): boolean {
    const state = this.states.get(backendId);
    if (!state) return false;

    // Consider slow if recent responses exceed threshold
    return state.slowResponses >= 2;
  }

  /**
   * Get the average latency from recent health checks.
   */
  getAvgLatency(backendId: string): number {
    const state = this.states.get(backendId);
    if (!state || state.history.length === 0) return 0;

    const recent = state.history.slice(-10);
    const total = recent.reduce((sum, r) => sum + r.latencyMs, 0);
    return total / recent.length;
  }

  /**
   * Get health state for a backend.
   */
  getState(backendId: string): BackendHealthState | null {
    const state = this.states.get(backendId);
    return state ? { ...state, history: [...state.history] } : null;
  }

  /**
   * Get all backend states.
   */
  getAllStates(): BackendHealthState[] {
    return Array.from(this.states.values()).map((s) => ({
      ...s,
      history: [...s.history],
    }));
  }

  /**
   * Simulate a health check with configurable latency and success.
   */
  simulateCheck(
    backendId: string,
    latencyMs: number,
    success: boolean
  ): HealthCheckResult {
    const result: HealthCheckResult = {
      backendId,
      healthy: success,
      latencyMs,
      timestamp: Date.now(),
      reason: success ? undefined : 'simulated_failure',
    };

    this.recordResult(result);
    return result;
  }

  /**
   * Get configuration.
   */
  getConfig(): HealthCheckerConfig {
    return { ...this.config };
  }
}

export { DEFAULT_CONFIG as DEFAULT_HEALTH_CONFIG };
