// Latency distribution modeling for AI workloads.
// See Chapter 1, "Building Production AI Systems".

import type { LatencyDistribution, ModelTier } from './types.ts';

/**
 * Generates samples from a log-normal distribution.
 * LLM latencies follow approximately log-normal: most requests are fast,
 * but a long tail exists.
 */
export class LogNormalDistribution {
  private mu: number;
  private sigma: number;

  constructor(median: number, p99: number) {
    // mu is the log of the median
    this.mu = Math.log(median);
    // sigma derived from p99 (99th percentile is mu + 2.326 * sigma)
    const z99 = 2.326; // z-score for 99th percentile
    this.sigma = (Math.log(p99) - this.mu) / z99;
  }

  /**
   * Generate a single sample.
   */
  sample(): number {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    return Math.exp(this.mu + this.sigma * z);
  }

  /**
   * Generate multiple samples.
   */
  samples(n: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this.sample());
    }
    return result;
  }

  /**
   * Calculate percentile from samples.
   */
  percentile(samples: number[], p: number): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * (p / 100));
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Calculate theoretical percentile.
   */
  theoreticalPercentile(p: number): number {
    const zScores: Record<number, number> = {
      50: 0,
      90: 1.282,
      95: 1.645,
      99: 2.326,
      99.9: 3.09,
    };
    const z = zScores[p] ?? 0;
    return Math.exp(this.mu + this.sigma * z);
  }
}

/**
 * Bimodal distribution for LLM requests.
 * Captures the two-phase nature: time-to-first-token + generation.
 */
export class BimodalLatencyDistribution {
  private ttft: LogNormalDistribution;
  private generationRate: number; // tokens per second

  constructor(ttftMedian: number, ttftP99: number, tokensPerSecond: number) {
    this.ttft = new LogNormalDistribution(ttftMedian, ttftP99);
    this.generationRate = tokensPerSecond;
  }

  /**
   * Sample total latency for a request with given output tokens.
   */
  sample(outputTokens: number): { ttft: number; generation: number; total: number } {
    const ttft = this.ttft.sample();
    const generation = (outputTokens / this.generationRate) * 1000;

    // Add some variance to generation time
    const generationVariance = generation * 0.1 * (Math.random() * 2 - 1);

    return {
      ttft,
      generation: generation + generationVariance,
      total: ttft + generation + generationVariance,
    };
  }
}

/**
 * Models latency characteristics for different model tiers.
 */
export function getModelLatencyCharacteristics(tier: ModelTier): LatencyDistribution {
  const characteristics: Record<ModelTier, LatencyDistribution> = {
    frontier: {
      p50Ms: 2000,
      p90Ms: 5000,
      p99Ms: 15000,
      mean: 3000,
      stdDev: 2500,
    },
    mid: {
      p50Ms: 800,
      p90Ms: 2000,
      p99Ms: 5000,
      mean: 1200,
      stdDev: 1000,
    },
    small: {
      p50Ms: 200,
      p90Ms: 500,
      p99Ms: 1500,
      mean: 350,
      stdDev: 300,
    },
  };

  return characteristics[tier];
}

/**
 * Simulates latency for a batch of requests.
 */
export function simulateLatencyDistribution(
  tier: ModelTier,
  requestCount: number,
  outputTokens: number
): {
  samples: number[];
  p50: number;
  p90: number;
  p99: number;
  mean: number;
} {
  const chars = getModelLatencyCharacteristics(tier);
  // Use log-normal for realistic long-tail distribution
  const dist = new LogNormalDistribution(chars.p50Ms, chars.p99Ms);

  const samples: number[] = [];
  for (let i = 0; i < requestCount; i++) {
    // Base latency from TTFT distribution
    const ttft = dist.sample();
    // Token generation adds linear component with variance
    const genRate = tier === 'frontier' ? 40 : tier === 'mid' ? 80 : 150;
    const generation = (outputTokens / genRate) * 1000;
    const genVariance = generation * 0.2 * (Math.random() * 2 - 1);
    samples.push(ttft + generation + genVariance);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p50Index = Math.floor(sorted.length * 0.5);
  const p90Index = Math.floor(sorted.length * 0.9);
  const p99Index = Math.floor(sorted.length * 0.99);

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  return {
    samples,
    p50: sorted[p50Index],
    p90: sorted[p90Index],
    p99: sorted[Math.min(p99Index, sorted.length - 1)],
    mean,
  };
}

/**
 * Demonstrates the difference between traditional API and LLM latencies.
 */
export function compareLatencyProfiles(): {
  traditionalApi: LatencyDistribution;
  llmApi: LatencyDistribution;
  ratioP50: number;
  ratioP99: number;
} {
  const traditionalApi: LatencyDistribution = {
    p50Ms: 5,
    p90Ms: 15,
    p99Ms: 50,
    mean: 8,
    stdDev: 10,
  };

  const llmApi = getModelLatencyCharacteristics('mid');

  return {
    traditionalApi,
    llmApi,
    ratioP50: llmApi.p50Ms / traditionalApi.p50Ms,
    ratioP99: llmApi.p99Ms / traditionalApi.p99Ms,
  };
}

/**
 * Calculate timeout recommendation based on latency distribution.
 */
export function recommendTimeout(
  dist: LatencyDistribution,
  targetSuccessRate: number
): number {
  // Map success rate to percentile
  const percentile = targetSuccessRate * 100;

  // Approximate timeout based on percentile
  if (percentile <= 50) {
    return dist.p50Ms;
  } else if (percentile <= 90) {
    return dist.p50Ms + ((percentile - 50) / 40) * (dist.p90Ms - dist.p50Ms);
  } else if (percentile <= 99) {
    return dist.p90Ms + ((percentile - 90) / 9) * (dist.p99Ms - dist.p90Ms);
  } else {
    // Beyond p99, extrapolate conservatively
    return dist.p99Ms * 1.5;
  }
}

/**
 * Simulates the impact of timeout settings on throughput.
 */
export function simulateTimeoutImpact(
  tier: ModelTier,
  timeoutMs: number,
  requestCount: number
): {
  completed: number;
  timedOut: number;
  avgLatencyMs: number;
  throughput: number;
} {
  const dist = simulateLatencyDistribution(tier, requestCount, 500);

  let completed = 0;
  let timedOut = 0;
  let totalLatency = 0;

  for (const latency of dist.samples) {
    if (latency <= timeoutMs) {
      completed++;
      totalLatency += latency;
    } else {
      timedOut++;
      totalLatency += timeoutMs; // Timeout cuts off at limit
    }
  }

  return {
    completed,
    timedOut,
    avgLatencyMs: totalLatency / requestCount,
    throughput: completed / (totalLatency / 1000),
  };
}

/**
 * Calculates latency percentiles from raw samples.
 */
export function calculatePercentiles(
  samples: number[]
): { p50: number; p90: number; p99: number; p999: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    p50: sorted[Math.floor(n * 0.5)] ?? 0,
    p90: sorted[Math.floor(n * 0.9)] ?? 0,
    p99: sorted[Math.floor(n * 0.99)] ?? 0,
    p999: sorted[Math.min(Math.floor(n * 0.999), n - 1)] ?? 0,
  };
}
