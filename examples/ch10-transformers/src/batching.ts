// Batching strategies for transformer inference.
// See Chapter 10, "Production Design".

import type {
  ModelConfig,
  BatchConfig,
  BatchedRequest,
  BatchResult,
  GPUSpec,
} from './types.ts';
import { computeForwardPassFlops } from './attention.ts';
import { kvCacheMemoryForSequence } from './kv-cache.ts';

/**
 * Common GPU specifications for capacity planning.
 */
export const GPU_SPECS: Record<string, GPUSpec> = {
  'a100-40gb': {
    name: 'A100 40GB',
    memoryBytes: 40 * 1024 * 1024 * 1024,
    flops: 312e12, // 312 TFLOPS fp16
    memoryBandwidth: 1555e9, // 1.5 TB/s
  },
  'a100-80gb': {
    name: 'A100 80GB',
    memoryBytes: 80 * 1024 * 1024 * 1024,
    flops: 312e12,
    memoryBandwidth: 2039e9, // 2 TB/s
  },
  'h100': {
    name: 'H100',
    memoryBytes: 80 * 1024 * 1024 * 1024,
    flops: 989e12, // ~1 PFLOPS fp16
    memoryBandwidth: 3350e9, // 3.35 TB/s
  },
};

/**
 * Static batching: all sequences in a batch must complete together.
 *
 * Simple but inefficient - short sequences wait for long ones.
 * Padding waste grows with sequence length variance.
 */
export function staticBatch(
  requests: BatchedRequest[],
  config: BatchConfig,
): BatchedRequest[][] {
  const batches: BatchedRequest[][] = [];
  let currentBatch: BatchedRequest[] = [];
  let currentTokens = 0;

  for (const req of requests) {
    const reqTokens = req.inputTokens.length;

    if (
      currentBatch.length >= config.maxBatchSize ||
      currentTokens + reqTokens > config.maxTotalTokens
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(req);
    currentTokens += reqTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Calculate padding overhead for a static batch.
 *
 * In static batching, all sequences are padded to match the longest.
 * This wastes compute on padding tokens.
 */
export function calculatePaddingOverhead(
  requests: BatchedRequest[],
): { paddingTokens: number; totalSlots: number; overhead: number } {
  if (requests.length === 0) {
    return { paddingTokens: 0, totalSlots: 0, overhead: 0 };
  }

  const maxLen = Math.max(...requests.map((r) => r.inputTokens.length));
  const actualTokens = requests.reduce(
    (sum, r) => sum + r.inputTokens.length,
    0,
  );
  const totalSlots = maxLen * requests.length;
  const paddingTokens = totalSlots - actualTokens;

  return {
    paddingTokens,
    totalSlots,
    overhead: paddingTokens / totalSlots,
  };
}

/**
 * Continuous batching: sequences can join and leave the batch dynamically.
 *
 * Key insight: when a sequence finishes generating, its slot can immediately
 * be filled with a new sequence. This maximizes GPU utilization.
 */
export class ContinuousBatcher {
  private config: BatchConfig;
  private modelConfig: ModelConfig;
  private activeRequests: Map<string, BatchedRequest>;
  private waitingRequests: BatchedRequest[];
  private completedCount: number;
  private totalTokensGenerated: number;

  constructor(config: BatchConfig, modelConfig: ModelConfig) {
    this.config = config;
    this.modelConfig = modelConfig;
    this.activeRequests = new Map();
    this.waitingRequests = [];
    this.completedCount = 0;
    this.totalTokensGenerated = 0;
  }

  /**
   * Add a request to the queue.
   */
  enqueue(request: BatchedRequest): void {
    this.waitingRequests.push(request);
    // Sort by priority (higher priority first)
    this.waitingRequests.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Fill available batch slots with waiting requests.
   */
  fillBatch(): number {
    let added = 0;

    while (
      this.activeRequests.size < this.config.maxBatchSize &&
      this.waitingRequests.length > 0
    ) {
      const totalTokens = this.getCurrentTotalTokens();
      const next = this.waitingRequests[0];

      if (!next) break;
      if (totalTokens + next.inputTokens.length > this.config.maxTotalTokens) {
        break; // Would exceed token limit
      }

      this.waitingRequests.shift();
      this.activeRequests.set(next.sequenceId, next);
      added++;
    }

    return added;
  }

  /**
   * Simulate one decode step: generate one token for each active sequence.
   */
  decodeStep(): string[] {
    const completed: string[] = [];

    for (const [id, req] of this.activeRequests) {
      req.currentLength++;
      this.totalTokensGenerated++;

      // Check if sequence is complete
      const newTokens = req.currentLength - req.inputTokens.length;
      if (newTokens >= req.maxNewTokens) {
        completed.push(id);
      }
    }

    // Remove completed sequences
    for (const id of completed) {
      this.activeRequests.delete(id);
      this.completedCount++;
    }

    // Fill vacated slots
    this.fillBatch();

    return completed;
  }

  /**
   * Get current total tokens across all active sequences.
   */
  getCurrentTotalTokens(): number {
    let total = 0;
    for (const req of this.activeRequests.values()) {
      total += req.currentLength;
    }
    return total;
  }

  /**
   * Get batch statistics.
   */
  getStats(): {
    activeCount: number;
    waitingCount: number;
    completedCount: number;
    totalTokensGenerated: number;
    currentTotalTokens: number;
    batchUtilization: number;
  } {
    return {
      activeCount: this.activeRequests.size,
      waitingCount: this.waitingRequests.length,
      completedCount: this.completedCount,
      totalTokensGenerated: this.totalTokensGenerated,
      currentTotalTokens: this.getCurrentTotalTokens(),
      batchUtilization: this.activeRequests.size / this.config.maxBatchSize,
    };
  }
}

/**
 * Estimate batch throughput based on hardware and configuration.
 *
 * Throughput depends on whether we are compute-bound or memory-bound.
 * Prefill (processing input) is typically compute-bound.
 * Decode (generating output) is typically memory-bound.
 */
export function estimateBatchThroughput(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  batchSize: number,
  seqLen: number,
  phase: 'prefill' | 'decode',
): { tokensPerSec: number; boundBy: 'compute' | 'memory' } {
  const flops = computeForwardPassFlops(modelConfig, batchSize, seqLen);

  // Compute-bound: limited by GPU FLOPS
  // Time = FLOPS / GPU_FLOPS
  const computeTime = flops / gpu.flops;
  const computeBoundThroughput = (batchSize * seqLen) / computeTime;

  // Memory-bound: limited by reading model weights and KV cache
  // For decode, we read weights once per token and KV cache grows
  const modelMemory = modelConfig.numLayers *
    modelConfig.hiddenSize *
    modelConfig.hiddenSize *
    12 * // approximate multiplier for all weight matrices
    modelConfig.bytesPerParam;
  const kvMemory = kvCacheMemoryForSequence(modelConfig, seqLen) * batchSize;
  const totalMemoryRead = modelMemory + kvMemory;
  const memoryTime = totalMemoryRead / gpu.memoryBandwidth;
  const memoryBoundThroughput = (batchSize * seqLen) / memoryTime;

  // Prefill is typically compute-bound, decode is memory-bound
  if (phase === 'prefill') {
    return {
      tokensPerSec: computeBoundThroughput,
      boundBy: 'compute',
    };
  } else {
    // Decode: each step generates 1 token per sequence
    // Memory-bound because we read all weights for each single token
    return {
      tokensPerSec: Math.min(computeBoundThroughput, memoryBoundThroughput),
      boundBy: memoryBoundThroughput < computeBoundThroughput
        ? 'memory'
        : 'compute',
    };
  }
}

/**
 * Simulate batch processing and measure throughput vs latency tradeoff.
 *
 * Key insight: batching improves throughput because:
 * 1. For prefill (compute-bound): we amortize model weight reads across batch
 * 2. For decode (memory-bound): we read weights once per step for all sequences
 *
 * The throughput gain comes from amortizing the fixed cost of reading model
 * weights across multiple sequences in a batch.
 */
export function simulateBatchProcessing(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  requests: BatchedRequest[],
): BatchResult {
  if (requests.length === 0) {
    return {
      batchSize: 0,
      totalInputTokens: 0,
      paddingTokens: 0,
      paddingOverhead: 0,
      throughputTokensPerSec: 0,
      latencyMs: 0,
    };
  }

  const batchSize = requests.length;
  const maxLen = Math.max(...requests.map((r) => r.inputTokens.length));
  const totalInputTokens = requests.reduce(
    (sum, r) => sum + r.inputTokens.length,
    0,
  );
  const totalSlots = maxLen * batchSize;
  const paddingTokens = totalSlots - totalInputTokens;

  // Model memory (weights) - read once per forward pass
  const modelMemory = modelConfig.numLayers *
    modelConfig.hiddenSize *
    modelConfig.hiddenSize *
    12 * modelConfig.bytesPerParam;

  // Time to read model weights once
  const weightReadTimeMs = (modelMemory / gpu.memoryBandwidth) * 1000;

  // Prefill: compute-bound, but weight reading is amortized across batch
  // Time ~ weightRead + (flops / gpu.flops)
  const prefillFlops = computeForwardPassFlops(modelConfig, batchSize, maxLen);
  const prefillComputeTimeMs = (prefillFlops / (gpu.flops * 0.7)) * 1000;
  const prefillTimeMs = weightReadTimeMs + prefillComputeTimeMs;

  // Decode: memory-bound, model weights read each step
  // Batch helps because we read weights once and process all sequences
  const avgOutputTokens = 50;
  const decodeSteps = avgOutputTokens;

  // Per decode step: read weights once, process all batch sequences
  // This is where batching helps most - amortize weight reads
  const perStepWeightTimeMs = weightReadTimeMs;
  const perStepComputeFlops = computeForwardPassFlops(modelConfig, batchSize, 1);
  const perStepComputeTimeMs = (perStepComputeFlops / (gpu.flops * 0.3)) * 1000;

  // Total decode time
  const decodeTimeMs = decodeSteps * (perStepWeightTimeMs + perStepComputeTimeMs);

  const totalTimeMs = prefillTimeMs + decodeTimeMs;
  const totalTokens = totalInputTokens + avgOutputTokens * batchSize;

  // Throughput calculation: tokens / time
  // Larger batch = more tokens in same time (weight reads amortized)
  const throughputTokensPerSec = (totalTokens / totalTimeMs) * 1000;

  return {
    batchSize,
    totalInputTokens,
    paddingTokens,
    paddingOverhead: paddingTokens / totalSlots,
    throughputTokensPerSec,
    latencyMs: totalTimeMs,
  };
}
