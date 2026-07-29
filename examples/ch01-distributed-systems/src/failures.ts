// Failure detection and timeout strategies for AI workloads.
// See Chapter 1, "Building Production AI Systems".

import type {
  TimeoutConfig,
  TimeoutResult,
  FailureDetectorConfig,
  FailureDetectionResult,
  NodeHealth,
} from './types.ts';

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  initialMs: 1000,
  maxMs: 30000,
  multiplier: 2.0,
  jitterRatio: 0.2,
};

const DEFAULT_FAILURE_DETECTOR_CONFIG: FailureDetectorConfig = {
  heartbeatIntervalMs: 1000,
  suspectThresholdMs: 3000,
  failureThresholdMs: 10000,
  phiThreshold: 8,
};

/**
 * Exponential backoff with jitter for retry strategies.
 * Critical for AI workloads where naive retries cause storms.
 */
export class ExponentialBackoff {
  private config: TimeoutConfig;
  private attempt: number;

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
    this.attempt = 0;
  }

  /**
   * Get the next timeout value with exponential increase and jitter.
   */
  nextTimeout(): number {
    const base =
      this.config.initialMs * Math.pow(this.config.multiplier, this.attempt);
    const capped = Math.min(base, this.config.maxMs);
    const jitter =
      capped * this.config.jitterRatio * (Math.random() * 2 - 1);
    this.attempt++;
    return Math.max(0, capped + jitter);
  }

  /**
   * Reset the backoff state.
   */
  reset(): void {
    this.attempt = 0;
  }

  /**
   * Get current attempt number.
   */
  getAttempt(): number {
    return this.attempt;
  }
}

/**
 * Simulates a request with configurable latency and failure rate.
 * Used to test timeout and retry strategies.
 */
export async function simulateRequest(
  latencyMs: number,
  failureRate: number,
  signal?: AbortSignal
): Promise<{ success: boolean; latencyMs: number }> {
  const actualLatency = latencyMs * (0.8 + Math.random() * 0.4);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (Math.random() < failureRate) {
        resolve({ success: false, latencyMs: actualLatency });
      } else {
        resolve({ success: true, latencyMs: actualLatency });
      }
    }, actualLatency);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Request aborted'));
      });
    }
  });
}

/**
 * Executes a request with timeout and retry logic.
 */
export async function executeWithTimeout(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  maxAttempts: number,
  backoff: ExponentialBackoff
): Promise<TimeoutResult> {
  const startTime = Date.now();
  let attempts = 0;
  let success = false;
  let timedOut = false;

  while (attempts < maxAttempts && !success) {
    attempts++;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const result = await Promise.race([
        fn(),
        new Promise<boolean>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            timedOut = true;
            reject(new Error('Timeout'));
          });
        }),
      ]);

      clearTimeout(timeout);
      success = result;
    } catch {
      // Timeout or error - wait before retry
      if (attempts < maxAttempts) {
        const delay = backoff.nextTimeout();
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return {
    success,
    attempts,
    totalLatencyMs: Date.now() - startTime,
    timedOut: timedOut && !success,
  };
}

/**
 * Phi Accrual Failure Detector.
 * Adapts to network conditions rather than using fixed thresholds.
 * Critical for AI workloads where latency is highly variable.
 */
export class PhiAccrualFailureDetector {
  private config: FailureDetectorConfig;
  private heartbeatHistory: Map<string, number[]>;
  private lastHeartbeat: Map<string, number>;
  private windowSize: number;

  constructor(config: Partial<FailureDetectorConfig> = {}) {
    this.config = { ...DEFAULT_FAILURE_DETECTOR_CONFIG, ...config };
    this.heartbeatHistory = new Map();
    this.lastHeartbeat = new Map();
    this.windowSize = 100;
  }

  /**
   * Record a heartbeat from a node.
   */
  recordHeartbeat(nodeId: string): void {
    const now = Date.now();
    const last = this.lastHeartbeat.get(nodeId);

    if (last !== undefined) {
      const interval = now - last;
      let history = this.heartbeatHistory.get(nodeId) ?? [];
      history.push(interval);

      // Keep only recent history
      if (history.length > this.windowSize) {
        history = history.slice(-this.windowSize);
      }

      this.heartbeatHistory.set(nodeId, history);
    }

    this.lastHeartbeat.set(nodeId, now);
  }

  /**
   * Calculate phi value for a node.
   * Higher phi means more likely to have failed.
   */
  calculatePhi(nodeId: string): number {
    const last = this.lastHeartbeat.get(nodeId);
    if (last === undefined) {
      return Infinity; // Never seen
    }

    const history = this.heartbeatHistory.get(nodeId);
    if (!history || history.length < 2) {
      // Not enough history - use fixed threshold
      const timeSinceLast = Date.now() - last;
      return timeSinceLast / this.config.heartbeatIntervalMs;
    }

    // Calculate mean and standard deviation
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance =
      history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      history.length;
    const stdDev = Math.sqrt(variance);

    const timeSinceLast = Date.now() - last;

    // Phi accrual formula
    // Uses normal distribution CDF approximation
    if (stdDev === 0) {
      return timeSinceLast > mean ? Infinity : 0;
    }

    const y = (timeSinceLast - mean) / stdDev;
    const phi = -Math.log10(1 - this.normalCDF(y));

    return Math.max(0, phi);
  }

  /**
   * Determine health status of a node.
   */
  getNodeHealth(nodeId: string): FailureDetectionResult {
    const phi = this.calculatePhi(nodeId);
    const last = this.lastHeartbeat.get(nodeId) ?? 0;
    const timeSinceLast = Date.now() - last;

    let status: NodeHealth;
    if (phi < this.config.phiThreshold * 0.5) {
      status = 'healthy';
    } else if (phi < this.config.phiThreshold) {
      status = 'suspect';
    } else {
      status = 'failed';
    }

    return {
      nodeId,
      status,
      lastHeartbeat: last,
      phi,
      latencyMs: timeSinceLast,
    };
  }

  /**
   * Check all nodes and return their health status.
   */
  checkAllNodes(): FailureDetectionResult[] {
    const results: FailureDetectionResult[] = [];
    for (const nodeId of this.lastHeartbeat.keys()) {
      results.push(this.getNodeHealth(nodeId));
    }
    return results;
  }

  /**
   * Normal distribution CDF approximation.
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }
}

/**
 * Simple heartbeat-based failure detector with fixed thresholds.
 * Less sophisticated than phi accrual but simpler to understand.
 */
export class SimpleFailureDetector {
  private config: FailureDetectorConfig;
  private lastHeartbeat: Map<string, number>;

  constructor(config: Partial<FailureDetectorConfig> = {}) {
    this.config = { ...DEFAULT_FAILURE_DETECTOR_CONFIG, ...config };
    this.lastHeartbeat = new Map();
  }

  /**
   * Record a heartbeat from a node.
   */
  recordHeartbeat(nodeId: string): void {
    this.lastHeartbeat.set(nodeId, Date.now());
  }

  /**
   * Determine health status of a node.
   */
  getNodeHealth(nodeId: string): FailureDetectionResult {
    const last = this.lastHeartbeat.get(nodeId) ?? 0;
    const timeSinceLast = Date.now() - last;

    let status: NodeHealth;
    let phi: number;

    if (timeSinceLast < this.config.suspectThresholdMs) {
      status = 'healthy';
      phi = timeSinceLast / this.config.suspectThresholdMs;
    } else if (timeSinceLast < this.config.failureThresholdMs) {
      status = 'suspect';
      phi =
        this.config.phiThreshold *
        0.5 *
        (1 +
          (timeSinceLast - this.config.suspectThresholdMs) /
            (this.config.failureThresholdMs - this.config.suspectThresholdMs));
    } else {
      status = 'failed';
      phi = this.config.phiThreshold * 2;
    }

    return {
      nodeId,
      status,
      lastHeartbeat: last,
      phi,
      latencyMs: timeSinceLast,
    };
  }
}

/**
 * Timeout strategy specifically for LLM requests.
 * Accounts for the bimodal latency distribution of model inference.
 */
export class LLMTimeoutStrategy {
  private p50Ms: number;
  private p99Ms: number;
  private tokenGenerationRateMs: number;

  constructor(p50Ms: number, p99Ms: number, tokenGenerationRateMs: number = 50) {
    this.p50Ms = p50Ms;
    this.p99Ms = p99Ms;
    this.tokenGenerationRateMs = tokenGenerationRateMs;
  }

  /**
   * Calculate timeout for a request based on expected output tokens.
   * LLM requests have two phases:
   * 1. Time to first token (TTFT) - fixed overhead
   * 2. Token generation - linear with output tokens
   */
  calculateTimeout(maxOutputTokens: number): number {
    // Use p99 for TTFT since it is the fixed overhead
    const ttftBudget = this.p99Ms;
    // Token generation is approximately linear
    const generationBudget = maxOutputTokens * this.tokenGenerationRateMs;
    // Add 50% buffer for variance
    return Math.ceil((ttftBudget + generationBudget) * 1.5);
  }

  /**
   * Calculate adaptive timeout based on recent latency observations.
   */
  calculateAdaptiveTimeout(
    recentLatencies: number[],
    maxOutputTokens: number
  ): number {
    if (recentLatencies.length === 0) {
      return this.calculateTimeout(maxOutputTokens);
    }

    // Use observed p99 if we have enough samples
    const sorted = [...recentLatencies].sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    const observedP99 = sorted[Math.min(p99Index, sorted.length - 1)];

    // Blend observed with expected, weighting toward observed
    const blendedP99 = observedP99 * 0.7 + this.p99Ms * 0.3;

    const generationBudget = maxOutputTokens * this.tokenGenerationRateMs;
    return Math.ceil((blendedP99 + generationBudget) * 1.5);
  }
}

/**
 * Circuit breaker pattern for protecting against cascading failures.
 */
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open';
  private failureCount: number;
  private successCount: number;
  private lastFailureTime: number;
  private failureThreshold: number;
  private recoveryTimeMs: number;
  private halfOpenSuccessThreshold: number;

  constructor(
    failureThreshold: number = 5,
    recoveryTimeMs: number = 30000,
    halfOpenSuccessThreshold: number = 3
  ) {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.failureThreshold = failureThreshold;
    this.recoveryTimeMs = recoveryTimeMs;
    this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;
  }

  /**
   * Check if a request should be allowed through.
   */
  shouldAllow(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        if (Date.now() - this.lastFailureTime > this.recoveryTimeMs) {
          this.state = 'half-open';
          this.successCount = 0;
          return true;
        }
        return false;
      case 'half-open':
        return true;
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    switch (this.state) {
      case 'closed':
        this.failureCount = 0;
        break;
      case 'half-open':
        this.successCount++;
        if (this.successCount >= this.halfOpenSuccessThreshold) {
          this.state = 'closed';
          this.failureCount = 0;
        }
        break;
      case 'open':
        // Should not happen
        break;
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    switch (this.state) {
      case 'closed':
        if (this.failureCount >= this.failureThreshold) {
          this.state = 'open';
        }
        break;
      case 'half-open':
        this.state = 'open';
        break;
      case 'open':
        // Already open
        break;
    }
  }

  /**
   * Get current state.
   */
  getState(): 'closed' | 'open' | 'half-open' {
    // Check if should transition from open to half-open
    if (
      this.state === 'open' &&
      Date.now() - this.lastFailureTime > this.recoveryTimeMs
    ) {
      this.state = 'half-open';
      this.successCount = 0;
    }
    return this.state;
  }

  /**
   * Reset the circuit breaker.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}
