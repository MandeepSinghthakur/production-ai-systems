// Horizontal scaling simulation for stateless APIs.
//
// The key insight: stateless APIs scale linearly by adding instances.
// The bottleneck moves from compute to load balancing to downstream
// dependencies. This module simulates each phase.

import type {
  APIRequest,
  APIResponse,
  InstanceConfig,
  InstanceMetrics,
  LoadBalancerConfig,
  LoadBalanceStrategy,
  ThroughputResult,
} from './types.ts';

/**
 * Simulates a single stateless API instance.
 * No shared state - each instance processes requests independently.
 */
export class APIInstance {
  private config: InstanceConfig;
  private currentConcurrency: number;
  private metrics: InstanceMetrics;
  private activeRequests: Map<string, { startedAt: number }>;

  constructor(config: InstanceConfig) {
    this.config = config;
    this.currentConcurrency = 0;
    this.activeRequests = new Map();
    this.metrics = {
      instanceId: config.id,
      requestsProcessed: 0,
      requestsRejected: 0,
      tokensProcessed: 0,
      currentConcurrency: 0,
      peakConcurrency: 0,
      avgLatencyMs: 0,
    };
  }

  /**
   * Check if this instance can accept a new request.
   */
  canAccept(): boolean {
    return this.currentConcurrency < this.config.maxConcurrency;
  }

  /**
   * Process a request. Returns a promise that resolves when complete.
   */
  async process(request: APIRequest): Promise<APIResponse> {
    if (!this.canAccept()) {
      this.metrics.requestsRejected++;
      return {
        requestId: request.id,
        status: 'rejected',
        latencyMs: 0,
        tokensProcessed: 0,
        instanceId: this.config.id,
      };
    }

    const startedAt = Date.now();
    this.currentConcurrency++;
    this.activeRequests.set(request.id, { startedAt });
    this.metrics.currentConcurrency = this.currentConcurrency;
    if (this.currentConcurrency > this.metrics.peakConcurrency) {
      this.metrics.peakConcurrency = this.currentConcurrency;
    }

    // Simulate processing time proportional to tokens
    const baseTime = this.config.processingTimeMs;
    const tokenFactor = request.estimatedTokens / 1000;
    const jitter = Math.random() * 0.2 - 0.1; // +/- 10%
    const processingTime = baseTime * (1 + tokenFactor) * (1 + jitter);

    await this.sleep(processingTime);

    this.currentConcurrency--;
    this.activeRequests.delete(request.id);
    this.metrics.currentConcurrency = this.currentConcurrency;

    const latencyMs = Date.now() - startedAt;
    this.metrics.requestsProcessed++;
    this.metrics.tokensProcessed += request.estimatedTokens;
    this.updateAvgLatency(latencyMs);

    return {
      requestId: request.id,
      status: 'success',
      latencyMs,
      tokensProcessed: request.estimatedTokens,
      instanceId: this.config.id,
    };
  }

  private updateAvgLatency(latencyMs: number): void {
    const n = this.metrics.requestsProcessed;
    this.metrics.avgLatencyMs =
      (this.metrics.avgLatencyMs * (n - 1) + latencyMs) / n;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getMetrics(): InstanceMetrics {
    return { ...this.metrics };
  }

  getId(): string {
    return this.config.id;
  }

  getConcurrency(): number {
    return this.currentConcurrency;
  }
}

/**
 * Load balancer distributing requests across multiple instances.
 */
export class LoadBalancer {
  private config: LoadBalancerConfig;
  private instances: APIInstance[];
  private roundRobinIndex: number;
  private queue: Array<{
    request: APIRequest;
    resolve: (response: APIResponse) => void;
    queuedAt: number;
  }>;

  constructor(config: LoadBalancerConfig) {
    this.config = config;
    this.instances = config.instances.map((ic) => new APIInstance(ic));
    this.roundRobinIndex = 0;
    this.queue = [];
  }

  /**
   * Route a request to an instance based on the configured strategy.
   */
  async route(request: APIRequest): Promise<APIResponse> {
    const instance = this.selectInstance();

    if (instance && instance.canAccept()) {
      return instance.process(request);
    }

    // No available instance - try queueing
    if (this.queue.length >= this.config.maxQueueSize) {
      return {
        requestId: request.id,
        status: 'rejected',
        latencyMs: 0,
        tokensProcessed: 0,
        instanceId: 'load-balancer',
      };
    }

    // Queue the request and wait
    return new Promise((resolve) => {
      this.queue.push({
        request,
        resolve,
        queuedAt: Date.now(),
      });

      // Set timeout for queued requests
      setTimeout(() => {
        const idx = this.queue.findIndex(
          (q) => q.request.id === request.id
        );
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          resolve({
            requestId: request.id,
            status: 'rejected',
            latencyMs: Date.now() - request.arrivedAt,
            tokensProcessed: 0,
            instanceId: 'load-balancer',
          });
        }
      }, this.config.queueTimeoutMs);
    });
  }

  /**
   * Select an instance based on the load balancing strategy.
   */
  private selectInstance(): APIInstance | null {
    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin();
      case 'least-connections':
        return this.selectLeastConnections();
      case 'random':
        return this.selectRandom();
      default:
        return this.selectRoundRobin();
    }
  }

  private selectRoundRobin(): APIInstance {
    const instance = this.instances[this.roundRobinIndex];
    this.roundRobinIndex =
      (this.roundRobinIndex + 1) % this.instances.length;
    return instance;
  }

  private selectLeastConnections(): APIInstance {
    let minConn = Infinity;
    let selected = this.instances[0];

    for (const instance of this.instances) {
      const conn = instance.getConcurrency();
      if (conn < minConn) {
        minConn = conn;
        selected = instance;
      }
    }

    return selected;
  }

  private selectRandom(): APIInstance {
    const idx = Math.floor(Math.random() * this.instances.length);
    return this.instances[idx];
  }

  /**
   * Process queued requests when capacity becomes available.
   * Call this periodically.
   */
  async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const instance = this.selectLeastConnections();
      if (!instance.canAccept()) break;

      const queued = this.queue.shift();
      if (!queued) break;

      // Check if timed out
      if (Date.now() - queued.queuedAt > this.config.queueTimeoutMs) {
        queued.resolve({
          requestId: queued.request.id,
          status: 'rejected',
          latencyMs: Date.now() - queued.request.arrivedAt,
          tokensProcessed: 0,
          instanceId: 'load-balancer',
        });
        continue;
      }

      const response = await instance.process(queued.request);
      queued.resolve(response);
    }
  }

  getInstanceMetrics(): InstanceMetrics[] {
    return this.instances.map((i) => i.getMetrics());
  }

  getInstanceCount(): number {
    return this.instances.length;
  }
}

/**
 * Run a throughput test with a given number of instances.
 * Demonstrates linear scaling with instance count.
 */
export async function measureThroughput(
  instanceCount: number,
  requestCount: number,
  concurrentBatches: number,
  config?: Partial<InstanceConfig>
): Promise<ThroughputResult> {
  const instanceConfigs: InstanceConfig[] = [];
  for (let i = 0; i < instanceCount; i++) {
    instanceConfigs.push({
      id: `instance-${i}`,
      maxConcurrency: config?.maxConcurrency ?? 10,
      processingTimeMs: config?.processingTimeMs ?? 50,
      streamChunkIntervalMs: config?.streamChunkIntervalMs ?? 10,
    });
  }

  const lb = new LoadBalancer({
    strategy: 'least-connections',
    instances: instanceConfigs,
    maxQueueSize: 100,
    queueTimeoutMs: 5000,
  });

  const requests: APIRequest[] = [];
  for (let i = 0; i < requestCount; i++) {
    requests.push({
      id: `req-${i}`,
      tenantId: `tenant-${i % 10}`,
      payload: `Request ${i}`,
      estimatedTokens: 100 + Math.floor(Math.random() * 400),
      streaming: false,
      arrivedAt: Date.now(),
    });
  }

  const startTime = Date.now();
  const latencies: number[] = [];
  let successCount = 0;
  let rejectCount = 0;
  let totalTokens = 0;

  // Process requests in batches
  const batchSize = Math.ceil(requestCount / concurrentBatches);
  for (let batch = 0; batch < concurrentBatches; batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, requestCount);
    const batchRequests = requests.slice(batchStart, batchEnd);

    const responses = await Promise.all(
      batchRequests.map((r) => lb.route(r))
    );

    for (const resp of responses) {
      if (resp.status === 'success') {
        successCount++;
        totalTokens += resp.tokensProcessed;
        latencies.push(resp.latencyMs);
      } else {
        rejectCount++;
      }
    }
  }

  const durationMs = Date.now() - startTime;

  // Calculate p99 latency
  latencies.sort((a, b) => a - b);
  const p99Index = Math.floor(latencies.length * 0.99);
  const p99Latency = latencies[p99Index] ?? 0;

  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    instanceCount,
    totalRequests: requestCount,
    successfulRequests: successCount,
    rejectedRequests: rejectCount,
    totalTokens,
    durationMs,
    throughputRps: (successCount / durationMs) * 1000,
    tokensPerSecond: (totalTokens / durationMs) * 1000,
    avgLatencyMs: avgLatency,
    p99LatencyMs: p99Latency,
  };
}

/**
 * Demonstrate that adding instances increases throughput linearly.
 * Returns results for 1, 2, and 4 instances.
 */
export async function demonstrateLinearScaling(
  requestsPerTest: number
): Promise<ThroughputResult[]> {
  const results: ThroughputResult[] = [];

  for (const instanceCount of [1, 2, 4]) {
    const result = await measureThroughputDirect(
      instanceCount,
      requestsPerTest,
      { processingTimeMs: 20, maxConcurrency: 2 }
    );
    results.push(result);
  }

  return results;
}

/**
 * Measure throughput by sending all requests concurrently.
 * This better demonstrates scaling because requests compete for capacity.
 */
export async function measureThroughputDirect(
  instanceCount: number,
  requestCount: number,
  config?: Partial<InstanceConfig>
): Promise<ThroughputResult> {
  const instanceConfigs: InstanceConfig[] = [];
  for (let i = 0; i < instanceCount; i++) {
    instanceConfigs.push({
      id: `instance-${i}`,
      maxConcurrency: config?.maxConcurrency ?? 2,
      processingTimeMs: config?.processingTimeMs ?? 20,
      streamChunkIntervalMs: config?.streamChunkIntervalMs ?? 10,
    });
  }

  const lb = new LoadBalancer({
    strategy: 'least-connections',
    instances: instanceConfigs,
    maxQueueSize: requestCount,
    queueTimeoutMs: 10000,
  });

  const requests: APIRequest[] = [];
  for (let i = 0; i < requestCount; i++) {
    requests.push({
      id: `req-${i}`,
      tenantId: `tenant-${i % 10}`,
      payload: `Request ${i}`,
      estimatedTokens: 100, // Fixed for consistent measurement
      streaming: false,
      arrivedAt: Date.now(),
    });
  }

  const startTime = Date.now();
  const latencies: number[] = [];
  let successCount = 0;
  let rejectCount = 0;
  let totalTokens = 0;

  // Send all requests concurrently - this saturates the instances
  const responses = await Promise.all(
    requests.map((r) => lb.route(r))
  );

  for (const resp of responses) {
    if (resp.status === 'success') {
      successCount++;
      totalTokens += resp.tokensProcessed;
      latencies.push(resp.latencyMs);
    } else {
      rejectCount++;
    }
  }

  const durationMs = Date.now() - startTime;

  // Calculate p99 latency
  latencies.sort((a, b) => a - b);
  const p99Index = Math.floor(latencies.length * 0.99);
  const p99Latency = latencies[p99Index] ?? 0;

  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  return {
    instanceCount,
    totalRequests: requestCount,
    successfulRequests: successCount,
    rejectedRequests: rejectCount,
    totalTokens,
    durationMs,
    throughputRps: (successCount / durationMs) * 1000,
    tokensPerSecond: (totalTokens / durationMs) * 1000,
    avgLatencyMs: avgLatency,
    p99LatencyMs: p99Latency,
  };
}
