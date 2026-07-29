// Token-based capacity planning for AI workloads.
// See Chapter 1, "Building Production AI Systems".

import type {
  TokenCapacity,
  RequestCapacity,
  CapacityResult,
  ModelTier,
  LLMRequest,
  LLMResponse,
} from './types.ts';

/**
 * Default latency characteristics by model tier.
 * These are illustrative, not vendor-specific.
 */
const MODEL_CHARACTERISTICS: Record<
  ModelTier,
  { p50Ms: number; tokensPerSecond: number }
> = {
  frontier: { p50Ms: 2000, tokensPerSecond: 40 },
  mid: { p50Ms: 800, tokensPerSecond: 80 },
  small: { p50Ms: 200, tokensPerSecond: 150 },
};

/**
 * Capacity planner for token-based AI workloads.
 * The key insight: LLM capacity is denominated in tokens, not requests.
 */
export class TokenCapacityPlanner {
  private capacity: TokenCapacity;

  constructor(capacity: TokenCapacity) {
    this.capacity = capacity;
  }

  /**
   * Calculate effective request throughput given token-based capacity.
   * This is where traditional capacity planning breaks.
   */
  calculateEffectiveRps(avgTokensPerRequest: number): CapacityResult {
    // Tokens per second limits effective RPS
    const tokenLimitedRps = this.capacity.tokensPerSecond / avgTokensPerRequest;

    // Concurrency limits effective RPS based on latency
    const avgLatencyMs =
      (avgTokensPerRequest / MODEL_CHARACTERISTICS.mid.tokensPerSecond) * 1000;
    const concurrencyLimitedRps =
      (this.capacity.maxConcurrentRequests * 1000) / avgLatencyMs;

    // Effective RPS is the minimum of both constraints
    const effectiveRps = Math.min(tokenLimitedRps, concurrencyLimitedRps);

    // Calculate utilization
    const utilizationPercent =
      (effectiveRps * avgTokensPerRequest * 100) / this.capacity.tokensPerSecond;

    return {
      effectiveRps,
      utilizationPercent: Math.min(100, utilizationPercent),
      queueDepth: 0,
      waitTimeMs: 0,
    };
  }

  /**
   * Compare capacity for small vs large requests.
   * Shows why request-based capacity planning fails for LLM workloads.
   */
  compareRequestSizes(
    smallTokens: number,
    largeTokens: number,
    requestsPerSecond: number
  ): {
    smallEffectiveRps: number;
    largeEffectiveRps: number;
    ratio: number;
  } {
    const smallResult = this.calculateEffectiveRps(smallTokens);
    const largeResult = this.calculateEffectiveRps(largeTokens);

    return {
      smallEffectiveRps: smallResult.effectiveRps,
      largeEffectiveRps: largeResult.effectiveRps,
      ratio: smallResult.effectiveRps / largeResult.effectiveRps,
    };
  }
}

/**
 * Capacity planner for traditional request-based APIs.
 * Used as a comparison to show the difference.
 */
export class RequestCapacityPlanner {
  private capacity: RequestCapacity;

  constructor(capacity: RequestCapacity) {
    this.capacity = capacity;
  }

  /**
   * Calculate capacity using Little's Law.
   * L = lambda * W (queue length = arrival rate * wait time)
   */
  calculateCapacity(requestsPerSecond: number): CapacityResult {
    // Using Little's Law
    const concurrency = requestsPerSecond * (this.capacity.averageLatencyMs / 1000);

    if (concurrency <= this.capacity.maxConcurrentRequests) {
      return {
        effectiveRps: requestsPerSecond,
        utilizationPercent:
          (concurrency / this.capacity.maxConcurrentRequests) * 100,
        queueDepth: 0,
        waitTimeMs: 0,
      };
    }

    // System is overloaded - calculate queue depth
    const effectiveRps = this.capacity.maxConcurrentRequests /
      (this.capacity.averageLatencyMs / 1000);
    const excessRps = requestsPerSecond - effectiveRps;
    const queueDepth = excessRps * (this.capacity.averageLatencyMs / 1000);

    return {
      effectiveRps,
      utilizationPercent: 100,
      queueDepth,
      waitTimeMs: (queueDepth / effectiveRps) * 1000,
    };
  }
}

/**
 * Simulates an LLM request with realistic latency characteristics.
 */
export function simulateLLMRequest(request: LLMRequest): LLMResponse {
  const chars = MODEL_CHARACTERISTICS[request.tier];

  // Time to first token follows approximate log-normal
  const ttftBase = chars.p50Ms;
  const ttftVariance = ttftBase * 0.3;
  const timeToFirstTokenMs = Math.max(
    100,
    ttftBase + (Math.random() * 2 - 1) * ttftVariance
  );

  // Output tokens follow truncated distribution
  const outputTokens = Math.min(
    request.maxOutputTokens,
    Math.max(10, Math.floor(request.maxOutputTokens * (0.3 + Math.random() * 0.7)))
  );

  // Generation time is approximately linear with tokens
  const generationTimeMs = (outputTokens / chars.tokensPerSecond) * 1000;
  const latencyMs = timeToFirstTokenMs + generationTimeMs;

  return {
    requestId: request.id,
    outputTokens,
    latencyMs,
    timeToFirstTokenMs,
    tokensPerSecond: outputTokens / (generationTimeMs / 1000),
  };
}

/**
 * Calculates required capacity for a given workload mix.
 */
export function calculateRequiredCapacity(
  requests: LLMRequest[],
  targetLatencyMs: number
): TokenCapacity {
  if (requests.length === 0) {
    return {
      tokensPerSecond: 0,
      maxConcurrentRequests: 0,
      averageTokensPerRequest: 0,
    };
  }

  // Calculate average tokens per request
  const totalTokens = requests.reduce(
    (sum, r) => sum + r.inputTokens + r.maxOutputTokens,
    0
  );
  const averageTokensPerRequest = totalTokens / requests.length;

  // Estimate required tokens per second to meet latency target
  // Using Little's Law: C = lambda * T
  const estimatedRps = requests.length; // Assuming 1 second window
  const tokensPerSecond = estimatedRps * averageTokensPerRequest;

  // Calculate required concurrency
  const avgLatencyMs = targetLatencyMs;
  const maxConcurrentRequests = Math.ceil(estimatedRps * (avgLatencyMs / 1000));

  return {
    tokensPerSecond,
    maxConcurrentRequests,
    averageTokensPerRequest,
  };
}

/**
 * Demonstrates why token-based capacity differs from request-based.
 */
export function demonstrateCapacityDifference(): {
  tokenBased: { small: CapacityResult; large: CapacityResult };
  requestBased: { small: CapacityResult; large: CapacityResult };
  insight: string;
} {
  const tokenPlanner = new TokenCapacityPlanner({
    tokensPerSecond: 1000,
    maxConcurrentRequests: 10,
    averageTokensPerRequest: 500,
  });

  const requestPlanner = new RequestCapacityPlanner({
    requestsPerSecond: 100,
    maxConcurrentRequests: 10,
    averageLatencyMs: 100,
  });

  // Compare small (100 token) vs large (2000 token) requests
  const smallTokenResult = tokenPlanner.calculateEffectiveRps(100);
  const largeTokenResult = tokenPlanner.calculateEffectiveRps(2000);

  // Request-based does not distinguish
  const smallRequestResult = requestPlanner.calculateCapacity(10);
  const largeRequestResult = requestPlanner.calculateCapacity(10);

  return {
    tokenBased: {
      small: smallTokenResult,
      large: largeTokenResult,
    },
    requestBased: {
      small: smallRequestResult,
      large: largeRequestResult,
    },
    insight:
      'Token-based capacity shows 20x difference between small and large requests. ' +
      'Request-based capacity shows no difference. This is why request-based ' +
      'rate limiting fails for LLM workloads.',
  };
}

/**
 * Queue model for understanding wait times under load.
 */
export class QueueModel {
  private arrivalRate: number;
  private serviceRate: number;
  private servers: number;

  constructor(arrivalRate: number, serviceRate: number, servers: number) {
    this.arrivalRate = arrivalRate;
    this.serviceRate = serviceRate;
    this.servers = servers;
  }

  /**
   * Calculate system utilization.
   */
  getUtilization(): number {
    return this.arrivalRate / (this.servers * this.serviceRate);
  }

  /**
   * Calculate average queue length using M/M/c approximation.
   */
  getAverageQueueLength(): number {
    const rho = this.getUtilization();
    if (rho >= 1) {
      return Infinity; // System is unstable
    }

    // Simplified M/M/c formula
    const c = this.servers;
    const a = this.arrivalRate / this.serviceRate;

    // Erlang C approximation
    const erlangC =
      (Math.pow(a, c) / this.factorial(c)) *
      (c / (c - a)) /
      (this.sumPoisson(a, c - 1) +
        (Math.pow(a, c) / this.factorial(c)) * (c / (c - a)));

    return (erlangC * rho) / (1 - rho);
  }

  /**
   * Calculate average wait time.
   */
  getAverageWaitTimeMs(): number {
    const rho = this.getUtilization();
    if (rho >= 1) {
      return Infinity;
    }

    const Lq = this.getAverageQueueLength();
    return (Lq / this.arrivalRate) * 1000;
  }

  private factorial(n: number): number {
    if (n <= 1) return 1;
    return n * this.factorial(n - 1);
  }

  private sumPoisson(a: number, n: number): number {
    let sum = 0;
    for (let k = 0; k <= n; k++) {
      sum += Math.pow(a, k) / this.factorial(k);
    }
    return sum;
  }
}

/**
 * Compares throughput for different request sizes.
 */
export function compareRequestSizeThroughput(
  tokensPerSecond: number,
  sizes: number[]
): Array<{ size: number; maxRps: number }> {
  return sizes.map((size) => ({
    size,
    maxRps: tokensPerSecond / size,
  }));
}
