// KV cache simulation for understanding memory dynamics.
// See Chapter 10, "Core Concepts" and "Scaling Strategy".

import type {
  ModelConfig,
  KVCacheEntry,
  KVCacheStats,
} from './types.ts';

/**
 * Calculate KV cache memory for a single sequence.
 *
 * KV cache stores the key and value projections for all previous tokens,
 * allowing autoregressive generation without recomputing attention.
 *
 * Memory per token = 2 * numLayers * headDim * numHeads * bytesPerParam
 *                  = 2 * numLayers * hiddenSize * bytesPerParam
 *
 * The factor of 2 is for both K and V.
 */
export function kvCacheMemoryPerToken(config: ModelConfig): number {
  const { numLayers, hiddenSize, bytesPerParam } = config;
  return 2 * numLayers * hiddenSize * bytesPerParam;
}

/**
 * Calculate total KV cache memory for a sequence of given length.
 */
export function kvCacheMemoryForSequence(
  config: ModelConfig,
  seqLen: number,
): number {
  return kvCacheMemoryPerToken(config) * seqLen;
}

/**
 * Demonstrate that KV cache grows linearly with sequence length.
 * This is the critical insight: while attention is O(n^2), KV cache is O(n).
 */
export function analyzeKVCacheScaling(
  config: ModelConfig,
  sequenceLengths: number[],
): Array<{ seqLen: number; memoryMB: number; ratio: number }> {
  const results: Array<{ seqLen: number; memoryMB: number; ratio: number }> = [];
  let baseMemory: number | null = null;

  for (const seqLen of sequenceLengths) {
    const memoryBytes = kvCacheMemoryForSequence(config, seqLen);
    const memoryMB = memoryBytes / (1024 * 1024);

    if (baseMemory === null) {
      baseMemory = memoryMB;
    }

    results.push({
      seqLen,
      memoryMB,
      ratio: memoryMB / baseMemory,
    });
  }

  return results;
}

/**
 * A simple LRU cache for KV entries.
 * In production, this would be GPU memory management.
 */
export class KVCache {
  private entries: Map<string, KVCacheEntry>;
  private accessOrder: string[];
  private maxMemoryBytes: number;
  private currentMemoryBytes: number;
  private config: ModelConfig;
  private hits: number;
  private misses: number;
  private evictionCount: number;

  constructor(config: ModelConfig, maxMemoryBytes: number) {
    this.entries = new Map();
    this.accessOrder = [];
    this.maxMemoryBytes = maxMemoryBytes;
    this.currentMemoryBytes = 0;
    this.config = config;
    this.hits = 0;
    this.misses = 0;
    this.evictionCount = 0;
  }

  /**
   * Allocate a new KV cache entry for a sequence.
   */
  allocate(sequenceId: string, maxLength: number): KVCacheEntry | null {
    const memoryNeeded = kvCacheMemoryForSequence(this.config, maxLength);

    // Evict entries until we have space
    while (
      this.currentMemoryBytes + memoryNeeded > this.maxMemoryBytes &&
      this.accessOrder.length > 0
    ) {
      this.evict();
    }

    // Check if we can fit the new entry
    if (this.currentMemoryBytes + memoryNeeded > this.maxMemoryBytes) {
      return null; // Cannot allocate
    }

    const entry: KVCacheEntry = {
      sequenceId,
      keys: Array.from({ length: this.config.numLayers }, () => []),
      values: Array.from({ length: this.config.numLayers }, () => []),
      length: 0,
      maxLength,
      memoryBytes: memoryNeeded,
    };

    this.entries.set(sequenceId, entry);
    this.accessOrder.push(sequenceId);
    this.currentMemoryBytes += memoryNeeded;

    return entry;
  }

  /**
   * Get an existing entry and update access order.
   */
  get(sequenceId: string): KVCacheEntry | null {
    const entry = this.entries.get(sequenceId);
    if (entry) {
      this.hits++;
      // Move to end of access order (most recently used)
      const idx = this.accessOrder.indexOf(sequenceId);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(sequenceId);
      }
      return entry;
    }
    this.misses++;
    return null;
  }

  /**
   * Append a token's KV to the cache.
   */
  appendToken(sequenceId: string): boolean {
    const entry = this.entries.get(sequenceId);
    if (!entry) return false;
    if (entry.length >= entry.maxLength) return false;

    entry.length++;
    return true;
  }

  /**
   * Evict the least recently used entry.
   */
  private evict(): void {
    if (this.accessOrder.length === 0) return;

    const lruId = this.accessOrder.shift();
    if (!lruId) return;

    const entry = this.entries.get(lruId);
    if (entry) {
      this.currentMemoryBytes -= entry.memoryBytes;
      this.entries.delete(lruId);
      this.evictionCount++;
    }
  }

  /**
   * Free a specific entry.
   */
  free(sequenceId: string): void {
    const entry = this.entries.get(sequenceId);
    if (entry) {
      this.currentMemoryBytes -= entry.memoryBytes;
      this.entries.delete(sequenceId);
      const idx = this.accessOrder.indexOf(sequenceId);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
      }
    }
  }

  /**
   * Get cache statistics.
   */
  getStats(): KVCacheStats {
    let totalLength = 0;
    for (const entry of this.entries.values()) {
      totalLength += entry.length;
    }

    const totalAccesses = this.hits + this.misses;

    return {
      totalEntries: this.entries.size,
      totalMemoryBytes: this.currentMemoryBytes,
      avgSequenceLength: this.entries.size > 0
        ? totalLength / this.entries.size
        : 0,
      hitRate: totalAccesses > 0 ? this.hits / totalAccesses : 0,
      evictions: this.evictionCount,
    };
  }

  /**
   * Check available memory.
   */
  availableMemoryBytes(): number {
    return this.maxMemoryBytes - this.currentMemoryBytes;
  }

  /**
   * Get utilization ratio.
   */
  utilization(): number {
    return this.currentMemoryBytes / this.maxMemoryBytes;
  }
}

/**
 * Calculate how many concurrent sequences can fit in GPU memory.
 *
 * Available memory = GPU memory - model weights - activation memory
 * Concurrent sequences = Available memory / KV cache per sequence
 */
export function maxConcurrentSequences(
  config: ModelConfig,
  gpuMemoryBytes: number,
  modelMemoryBytes: number,
  activationOverheadBytes: number,
  avgSeqLen: number,
): number {
  const availableForKV = gpuMemoryBytes - modelMemoryBytes - activationOverheadBytes;
  const kvPerSequence = kvCacheMemoryForSequence(config, avgSeqLen);

  return Math.floor(availableForKV / kvPerSequence);
}
