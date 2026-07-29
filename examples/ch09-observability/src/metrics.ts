// Metrics collection for AI systems.
//
// The key insight: LLM workloads have unique dimensions that traditional
// metrics miss. Token counts, model tier, cache hits, and cost per request
// are the metrics that matter for AI systems.
//
// This implements a Prometheus-compatible metrics collector without deps.

import type {
  Metric,
  MetricDataPoint,
  HistogramBucket,
  MetricsConfig,
  LLMRequestMetrics,
  AIMetricLabels,
} from './types.ts';

const DEFAULT_CONFIG: MetricsConfig = {
  serviceName: 'ai-service',
  defaultLabels: {},
  histogramBuckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
};

// Default latency buckets for LLM requests (in ms)
// LLM requests are slow: 100ms to 60s is typical
const LLM_LATENCY_BUCKETS = [
  100, 250, 500, 1000, 2500, 5000, 10000, 20000, 40000, 60000,
];

// Default token count buckets
const TOKEN_COUNT_BUCKETS = [
  10, 50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/**
 * Counter metric that only increases.
 */
export class Counter {
  private name: string;
  private description: string;
  private unit: string;
  private values: Map<string, number>;
  private defaultLabels: Record<string, string>;

  constructor(
    name: string,
    description: string,
    unit: string = '1',
    defaultLabels: Record<string, string> = {}
  ) {
    this.name = name;
    this.description = description;
    this.unit = unit;
    this.values = new Map();
    this.defaultLabels = defaultLabels;
  }

  /**
   * Increment the counter by the given amount.
   */
  inc(labels: Record<string, string> = {}, amount: number = 1): void {
    if (amount < 0) {
      throw new Error('Counter cannot be decremented');
    }
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + amount);
  }

  /**
   * Get the current value for a label set.
   */
  get(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    return this.values.get(key) ?? 0;
  }

  /**
   * Export all values as metric data points.
   */
  export(): Metric {
    const dataPoints: MetricDataPoint[] = [];
    const now = Date.now();

    for (const [key, value] of this.values) {
      dataPoints.push({
        timestampMs: now,
        value,
        labels: this.keyToLabels(key),
      });
    }

    return {
      name: this.name,
      description: this.description,
      unit: this.unit,
      type: 'counter',
      dataPoints,
    };
  }

  private labelsToKey(labels: Record<string, string>): string {
    const sorted = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(',');
    return sorted;
  }

  private keyToLabels(key: string): Record<string, string> {
    if (!key) return {};
    const labels: Record<string, string> = {};
    const pairs = key.split(',');
    for (const pair of pairs) {
      const match = pair.match(/^(.+?)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    }
    return labels;
  }

  /**
   * Clear all values.
   */
  clear(): void {
    this.values.clear();
  }
}

/**
 * Gauge metric that can increase or decrease.
 */
export class Gauge {
  private name: string;
  private description: string;
  private unit: string;
  private values: Map<string, number>;
  private defaultLabels: Record<string, string>;

  constructor(
    name: string,
    description: string,
    unit: string = '1',
    defaultLabels: Record<string, string> = {}
  ) {
    this.name = name;
    this.description = description;
    this.unit = unit;
    this.values = new Map();
    this.defaultLabels = defaultLabels;
  }

  /**
   * Set the gauge to a specific value.
   */
  set(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    this.values.set(key, value);
  }

  /**
   * Increment the gauge.
   */
  inc(labels: Record<string, string> = {}, amount: number = 1): void {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + amount);
  }

  /**
   * Decrement the gauge.
   */
  dec(labels: Record<string, string> = {}, amount: number = 1): void {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current - amount);
  }

  /**
   * Get the current value for a label set.
   */
  get(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    return this.values.get(key) ?? 0;
  }

  /**
   * Export all values as metric data points.
   */
  export(): Metric {
    const dataPoints: MetricDataPoint[] = [];
    const now = Date.now();

    for (const [key, value] of this.values) {
      dataPoints.push({
        timestampMs: now,
        value,
        labels: this.keyToLabels(key),
      });
    }

    return {
      name: this.name,
      description: this.description,
      unit: this.unit,
      type: 'gauge',
      dataPoints,
    };
  }

  private labelsToKey(labels: Record<string, string>): string {
    const sorted = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(',');
    return sorted;
  }

  private keyToLabels(key: string): Record<string, string> {
    if (!key) return {};
    const labels: Record<string, string> = {};
    const pairs = key.split(',');
    for (const pair of pairs) {
      const match = pair.match(/^(.+?)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    }
    return labels;
  }

  /**
   * Clear all values.
   */
  clear(): void {
    this.values.clear();
  }
}

/**
 * Histogram metric for measuring distributions.
 */
export class Histogram {
  private name: string;
  private description: string;
  private unit: string;
  private buckets: number[];
  private counts: Map<string, number[]>;
  private sums: Map<string, number>;
  private totals: Map<string, number>;
  private defaultLabels: Record<string, string>;

  constructor(
    name: string,
    description: string,
    unit: string = 'ms',
    buckets: number[] = DEFAULT_CONFIG.histogramBuckets,
    defaultLabels: Record<string, string> = {}
  ) {
    this.name = name;
    this.description = description;
    this.unit = unit;
    this.buckets = buckets.slice().sort((a, b) => a - b);
    this.counts = new Map();
    this.sums = new Map();
    this.totals = new Map();
    this.defaultLabels = defaultLabels;
  }

  /**
   * Observe a value and place it in the appropriate bucket.
   */
  observe(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });

    // Initialize if needed
    if (!this.counts.has(key)) {
      this.counts.set(key, new Array(this.buckets.length + 1).fill(0));
      this.sums.set(key, 0);
      this.totals.set(key, 0);
    }

    const bucketCounts = this.counts.get(key)!;
    const sum = this.sums.get(key)!;
    const total = this.totals.get(key)!;

    // Increment appropriate bucket(s)
    // Each bucket is cumulative: count of values <= upper bound
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        bucketCounts[i]++;
      }
    }
    // +Inf bucket always gets incremented
    bucketCounts[this.buckets.length]++;

    this.sums.set(key, sum + value);
    this.totals.set(key, total + 1);
  }

  /**
   * Get histogram buckets for a label set.
   */
  getBuckets(labels: Record<string, string> = {}): HistogramBucket[] {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    const counts = this.counts.get(key);
    if (!counts) return [];

    const result: HistogramBucket[] = [];
    for (let i = 0; i < this.buckets.length; i++) {
      result.push({ upperBound: this.buckets[i], count: counts[i] });
    }
    result.push({ upperBound: Infinity, count: counts[this.buckets.length] });

    return result;
  }

  /**
   * Get the sum of all observed values for a label set.
   */
  getSum(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    return this.sums.get(key) ?? 0;
  }

  /**
   * Get the count of all observed values for a label set.
   */
  getCount(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey({ ...this.defaultLabels, ...labels });
    return this.totals.get(key) ?? 0;
  }

  /**
   * Calculate percentile from histogram data.
   * This is an approximation since we only have bucket counts.
   */
  getPercentile(labels: Record<string, string>, percentile: number): number {
    const total = this.getCount(labels);
    if (total === 0) return 0;

    const target = total * (percentile / 100);
    const buckets = this.getBuckets(labels);

    let prevBound = 0;
    for (const bucket of buckets) {
      if (bucket.count >= target) {
        // Interpolate within the bucket
        const prevCount =
          buckets.find((b) => b.upperBound < bucket.upperBound)?.count ?? 0;
        const bucketRange = bucket.upperBound - prevBound;
        const bucketCount = bucket.count - prevCount;
        if (bucketCount === 0) return bucket.upperBound;
        const fraction = (target - prevCount) / bucketCount;
        return prevBound + bucketRange * fraction;
      }
      prevBound = bucket.upperBound;
    }

    return this.buckets[this.buckets.length - 1];
  }

  /**
   * Export as metric.
   */
  export(): Metric {
    const dataPoints: MetricDataPoint[] = [];
    const now = Date.now();

    for (const [key, counts] of this.counts) {
      const labels = this.keyToLabels(key);
      for (let i = 0; i < this.buckets.length; i++) {
        dataPoints.push({
          timestampMs: now,
          value: counts[i],
          labels: { ...labels, le: String(this.buckets[i]) },
        });
      }
      dataPoints.push({
        timestampMs: now,
        value: counts[this.buckets.length],
        labels: { ...labels, le: '+Inf' },
      });
    }

    return {
      name: this.name,
      description: this.description,
      unit: this.unit,
      type: 'histogram',
      dataPoints,
    };
  }

  private labelsToKey(labels: Record<string, string>): string {
    const sorted = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${labels[k]}"`)
      .join(',');
    return sorted;
  }

  private keyToLabels(key: string): Record<string, string> {
    if (!key) return {};
    const labels: Record<string, string> = {};
    const pairs = key.split(',');
    for (const pair of pairs) {
      const match = pair.match(/^(.+?)="(.+)"$/);
      if (match) {
        labels[match[1]] = match[2];
      }
    }
    return labels;
  }

  /**
   * Clear all values.
   */
  clear(): void {
    this.counts.clear();
    this.sums.clear();
    this.totals.clear();
  }
}

/**
 * MetricsRegistry manages all metrics for a service.
 */
export class MetricsRegistry {
  private config: MetricsConfig;

  // Standard LLM metrics
  public readonly requestsTotal: Counter;
  public readonly requestLatency: Histogram;
  public readonly inputTokensTotal: Counter;
  public readonly outputTokensTotal: Counter;
  public readonly tokensHistogram: Histogram;
  public readonly cacheHitsTotal: Counter;
  public readonly cacheMissesTotal: Counter;
  public readonly errorsTotal: Counter;
  public readonly activeRequests: Gauge;
  public readonly estimatedCost: Counter;

  constructor(config: Partial<MetricsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const defaultLabels = this.config.defaultLabels;

    this.requestsTotal = new Counter(
      'llm_requests_total',
      'Total number of LLM requests',
      '1',
      defaultLabels
    );

    this.requestLatency = new Histogram(
      'llm_request_duration_ms',
      'LLM request latency in milliseconds',
      'ms',
      LLM_LATENCY_BUCKETS,
      defaultLabels
    );

    this.inputTokensTotal = new Counter(
      'llm_input_tokens_total',
      'Total input tokens processed',
      '1',
      defaultLabels
    );

    this.outputTokensTotal = new Counter(
      'llm_output_tokens_total',
      'Total output tokens generated',
      '1',
      defaultLabels
    );

    this.tokensHistogram = new Histogram(
      'llm_tokens_per_request',
      'Token count per request',
      '1',
      TOKEN_COUNT_BUCKETS,
      defaultLabels
    );

    this.cacheHitsTotal = new Counter(
      'llm_cache_hits_total',
      'Total cache hits',
      '1',
      defaultLabels
    );

    this.cacheMissesTotal = new Counter(
      'llm_cache_misses_total',
      'Total cache misses',
      '1',
      defaultLabels
    );

    this.errorsTotal = new Counter(
      'llm_errors_total',
      'Total errors by type',
      '1',
      defaultLabels
    );

    this.activeRequests = new Gauge(
      'llm_active_requests',
      'Number of currently processing requests',
      '1',
      defaultLabels
    );

    this.estimatedCost = new Counter(
      'llm_estimated_cost_usd',
      'Estimated cost in USD (multiply by 1e-6)',
      'usd',
      defaultLabels
    );
  }

  /**
   * Record a complete LLM request.
   */
  recordRequest(metrics: LLMRequestMetrics): void {
    const labels: AIMetricLabels = {
      tenant: metrics.tenant,
      model: metrics.tier,
      operation: 'completion',
      status: 'success',
    };

    this.requestsTotal.inc(labels);
    this.requestLatency.observe(labels, metrics.latencyMs);
    this.inputTokensTotal.inc(labels, metrics.inputTokens);
    this.outputTokensTotal.inc(labels, metrics.outputTokens);
    this.tokensHistogram.observe(
      labels,
      metrics.inputTokens + metrics.outputTokens
    );

    if (metrics.cached) {
      this.cacheHitsTotal.inc(labels);
    } else {
      this.cacheMissesTotal.inc(labels);
    }

    // Estimate cost based on tier (relative units, not actual prices)
    const costMultiplier =
      metrics.tier === 'frontier' ? 10 : metrics.tier === 'mid' ? 1 : 0.1;
    const inputCost = metrics.inputTokens * costMultiplier * 0.001;
    const outputCost = metrics.outputTokens * costMultiplier * 0.003;
    this.estimatedCost.inc(labels, inputCost + outputCost);
  }

  /**
   * Record an error.
   */
  recordError(
    tenant: string,
    tier: string,
    errorType: string
  ): void {
    this.errorsTotal.inc({
      tenant,
      model: tier,
      error_type: errorType,
    });
  }

  /**
   * Export all metrics.
   */
  exportAll(): Metric[] {
    return [
      this.requestsTotal.export(),
      this.requestLatency.export(),
      this.inputTokensTotal.export(),
      this.outputTokensTotal.export(),
      this.tokensHistogram.export(),
      this.cacheHitsTotal.export(),
      this.cacheMissesTotal.export(),
      this.errorsTotal.export(),
      this.activeRequests.export(),
      this.estimatedCost.export(),
    ];
  }

  /**
   * Clear all metrics.
   */
  clear(): void {
    this.requestsTotal.clear();
    this.requestLatency.clear();
    this.inputTokensTotal.clear();
    this.outputTokensTotal.clear();
    this.tokensHistogram.clear();
    this.cacheHitsTotal.clear();
    this.cacheMissesTotal.clear();
    this.errorsTotal.clear();
    this.activeRequests.clear();
    this.estimatedCost.clear();
  }
}
