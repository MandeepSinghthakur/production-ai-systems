// Prompt cache with TTL and LRU eviction.
//
// The key insight: LLM responses are expensive to generate but cheap to
// store. Exact-match caching on normalized prompts is safe and can cut
// costs by 30-80% on repetitive workloads like internal tooling.
//
// This is an in-memory implementation that models Redis behavior.
// In production, replace the Map with actual Redis commands.

import { createHash } from 'node:crypto';
import type {
  CacheConfig,
  CacheEntry,
  CacheResult,
  CacheStats,
} from './types.ts';

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 10_000,
  maxMemoryBytes: 100 * 1024 * 1024, // 100 MB
  ttlMs: 3600_000, // 1 hour
  evictionPolicy: 'lru',
};

export class PromptCache {
  private entries: Map<string, CacheEntry>;
  private config: CacheConfig;
  private stats: CacheStats;

  constructor(config: Partial<CacheConfig> = {}) {
    this.entries = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentEntries: 0,
      currentMemoryBytes: 0,
      hitRate: 0,
    };
  }

  /**
   * Hash a prompt to create a cache key.
   * Normalizes whitespace and lowercases for better hit rates.
   */
  hashPrompt(prompt: string, systemPrompt?: string): string {
    const normalized = (systemPrompt ?? '') + '|' + prompt.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Get an entry from cache. Returns null on miss or expired.
   */
  get(prompt: string, systemPrompt?: string): CacheResult {
    const start = performance.now();
    const key = this.hashPrompt(prompt, systemPrompt);
    const entry = this.entries.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return {
        hit: false,
        entry: null,
        latencyMs: performance.now() - start,
      };
    }

    // Check TTL expiration
    const now = Date.now();
    if (now - entry.createdAt > this.config.ttlMs) {
      this.entries.delete(key);
      this.stats.currentEntries--;
      this.stats.currentMemoryBytes -= entry.sizeBytes;
      this.stats.misses++;
      this.updateHitRate();
      return {
        hit: false,
        entry: null,
        latencyMs: performance.now() - start,
      };
    }

    // Update access tracking for LRU
    entry.lastAccessedAt = now;
    entry.accessCount++;

    this.stats.hits++;
    this.updateHitRate();

    return {
      hit: true,
      entry,
      latencyMs: performance.now() - start,
    };
  }

  /**
   * Set an entry in cache. Evicts if necessary.
   */
  set(
    prompt: string,
    response: string,
    tokens: number,
    systemPrompt?: string
  ): CacheEntry {
    const key = this.hashPrompt(prompt, systemPrompt);
    const now = Date.now();
    const sizeBytes = Buffer.byteLength(prompt + response, 'utf8');

    // Evict if necessary before adding
    while (this.shouldEvict(sizeBytes)) {
      this.evictOne();
    }

    const entry: CacheEntry = {
      key,
      promptHash: key,
      response,
      tokens,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      sizeBytes,
    };

    // Check if we're replacing an existing entry
    const existing = this.entries.get(key);
    if (existing) {
      this.stats.currentMemoryBytes -= existing.sizeBytes;
    } else {
      this.stats.currentEntries++;
    }

    this.entries.set(key, entry);
    this.stats.currentMemoryBytes += sizeBytes;

    return entry;
  }

  /**
   * Check if eviction is needed.
   */
  private shouldEvict(pendingSizeBytes: number): boolean {
    const wouldExceedEntries =
      this.stats.currentEntries >= this.config.maxEntries;
    const wouldExceedMemory =
      this.stats.currentMemoryBytes + pendingSizeBytes >
      this.config.maxMemoryBytes;
    return (
      this.entries.size > 0 && (wouldExceedEntries || wouldExceedMemory)
    );
  }

  /**
   * Evict one entry based on eviction policy.
   */
  private evictOne(): void {
    if (this.entries.size === 0) return;

    let victim: string | null = null;

    switch (this.config.evictionPolicy) {
      case 'lru':
        victim = this.findLRUVictim();
        break;
      case 'lfu':
        victim = this.findLFUVictim();
        break;
      case 'fifo':
        victim = this.findFIFOVictim();
        break;
    }

    if (victim) {
      const entry = this.entries.get(victim);
      if (entry) {
        this.stats.currentMemoryBytes -= entry.sizeBytes;
        this.stats.currentEntries--;
        this.stats.evictions++;
      }
      this.entries.delete(victim);
    }
  }

  /**
   * Find the least recently used entry.
   */
  private findLRUVictim(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldest = key;
      }
    }

    return oldest;
  }

  /**
   * Find the least frequently used entry.
   */
  private findLFUVictim(): string | null {
    let lowest: string | null = null;
    let lowestCount = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.accessCount < lowestCount) {
        lowestCount = entry.accessCount;
        lowest = key;
      }
    }

    return lowest;
  }

  /**
   * Find the oldest entry (FIFO).
   */
  private findFIFOVictim(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldest = key;
      }
    }

    return oldest;
  }

  /**
   * Update hit rate statistic.
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Get current cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      currentEntries: 0,
      currentMemoryBytes: 0,
      hitRate: 0,
    };
  }

  /**
   * Get current entry count.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Expire all entries older than TTL.
   * Call this periodically to free memory.
   */
  expireStale(): number {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > this.config.ttlMs) {
        this.stats.currentMemoryBytes -= entry.sizeBytes;
        this.stats.currentEntries--;
        this.entries.delete(key);
        expired++;
      }
    }

    return expired;
  }
}
