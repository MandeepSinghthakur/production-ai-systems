// Hot key detection for LLM caching.
//
// The hot key problem: when everyone asks the same question at the same
// time, a single cache key receives all the load. In Redis, this means
// one shard handles the entire request volume. In LLM caching, it also
// means a single popular prompt can dominate your cache.
//
// Detection is the first step. Once you know which keys are hot, you
// can replicate them across shards, pre-warm them, or serve them from
// a local in-process cache that never hits Redis at all.
//
// This implements a Count-Min Sketch approximation for space efficiency,
// plus an exact top-N tracker for the hottest keys.

import type { HotKeyEntry, HotKeyReport } from './types.ts';

interface SketchConfig {
  width: number;
  depth: number;
}

const DEFAULT_SKETCH_CONFIG: SketchConfig = {
  width: 1024,
  depth: 4,
};

export class HotKeyDetector {
  private windowMs: number;
  private threshold: number;
  private keyAccess: Map<string, HotKeyEntry>;
  private totalRequests: number;
  private sketch: number[][];
  private sketchConfig: SketchConfig;

  constructor(
    windowMs: number = 60_000,
    threshold: number = 100,
    sketchConfig: Partial<SketchConfig> = {}
  ) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    this.keyAccess = new Map();
    this.totalRequests = 0;
    this.sketchConfig = { ...DEFAULT_SKETCH_CONFIG, ...sketchConfig };
    this.sketch = this.createSketch();
  }

  private createSketch(): number[][] {
    const sketch: number[][] = [];
    for (let i = 0; i < this.sketchConfig.depth; i++) {
      sketch.push(new Array(this.sketchConfig.width).fill(0));
    }
    return sketch;
  }

  /**
   * Simple hash functions for the sketch.
   * In production, use a proper hash like xxhash.
   */
  private hash(key: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
      h ^= h >>> 15;
    }
    return Math.abs(h) % this.sketchConfig.width;
  }

  /**
   * Get approximate count from Count-Min Sketch.
   */
  private getSketchCount(key: string): number {
    let min = Infinity;
    for (let i = 0; i < this.sketchConfig.depth; i++) {
      const idx = this.hash(key, i * 31337);
      min = Math.min(min, this.sketch[i][idx]);
    }
    return min;
  }

  /**
   * Increment count in Count-Min Sketch.
   */
  private incrementSketch(key: string): void {
    for (let i = 0; i < this.sketchConfig.depth; i++) {
      const idx = this.hash(key, i * 31337);
      this.sketch[i][idx]++;
    }
  }

  /**
   * Record an access to a key.
   */
  recordAccess(key: string): void {
    const now = Date.now();
    this.totalRequests++;
    this.incrementSketch(key);

    // Only track exact counts for keys that appear frequently
    const approxCount = this.getSketchCount(key);
    if (approxCount >= this.threshold / 10) {
      const entry = this.keyAccess.get(key);
      if (entry) {
        entry.count++;
        entry.lastSeen = now;
      } else {
        this.keyAccess.set(key, {
          key,
          count: approxCount,
          firstSeen: now,
          lastSeen: now,
        });
      }
    }

    // Periodically prune old entries
    if (this.totalRequests % 1000 === 0) {
      this.pruneOldEntries();
    }
  }

  /**
   * Remove entries outside the window.
   */
  private pruneOldEntries(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entry] of this.keyAccess) {
      if (entry.lastSeen < cutoff) {
        this.keyAccess.delete(key);
      }
    }
  }

  /**
   * Get the top N hot keys.
   */
  getHotKeys(topN: number = 10): HotKeyReport {
    this.pruneOldEntries();

    const entries = Array.from(this.keyAccess.values())
      .filter((e) => e.count >= this.threshold)
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);

    return {
      hotKeys: entries,
      threshold: this.threshold,
      windowMs: this.windowMs,
      totalRequests: this.totalRequests,
    };
  }

  /**
   * Check if a key is currently hot.
   */
  isHot(key: string): boolean {
    const entry = this.keyAccess.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.lastSeen > this.windowMs) {
      this.keyAccess.delete(key);
      return false;
    }

    return entry.count >= this.threshold;
  }

  /**
   * Get the access count for a key (approximate).
   */
  getAccessCount(key: string): number {
    const entry = this.keyAccess.get(key);
    if (entry) return entry.count;
    return this.getSketchCount(key);
  }

  /**
   * Reset all tracking.
   */
  reset(): void {
    this.keyAccess.clear();
    this.totalRequests = 0;
    this.sketch = this.createSketch();
  }

  /**
   * Get total requests tracked.
   */
  getTotalRequests(): number {
    return this.totalRequests;
  }
}

/**
 * Hot key replicator that maintains local copies of hot keys.
 * This is the mitigation for the hot key problem: serve hot keys
 * from a local cache that never touches the shared Redis instance.
 */
export class HotKeyReplicator {
  private detector: HotKeyDetector;
  private localCache: Map<string, { value: string; expireAt: number }>;
  private maxLocalEntries: number;
  private localTtlMs: number;

  constructor(
    detector: HotKeyDetector,
    maxLocalEntries: number = 100,
    localTtlMs: number = 5_000
  ) {
    this.detector = detector;
    this.localCache = new Map();
    this.maxLocalEntries = maxLocalEntries;
    this.localTtlMs = localTtlMs;
  }

  /**
   * Get a value, checking local cache first for hot keys.
   * Returns { value, source } where source is 'local' or 'remote'.
   */
  get(
    key: string,
    remoteFetcher: () => string | null
  ): { value: string | null; source: 'local' | 'remote' } {
    this.detector.recordAccess(key);

    // Check local cache first
    const local = this.localCache.get(key);
    if (local && local.expireAt > Date.now()) {
      return { value: local.value, source: 'local' };
    }

    // Fetch from remote
    const remoteValue = remoteFetcher();

    // If this is a hot key, cache it locally
    if (remoteValue !== null && this.detector.isHot(key)) {
      this.cacheLocally(key, remoteValue);
    }

    return { value: remoteValue, source: 'remote' };
  }

  /**
   * Store a value in local cache if it's hot.
   */
  private cacheLocally(key: string, value: string): void {
    // Evict if at capacity
    if (this.localCache.size >= this.maxLocalEntries) {
      // Remove the oldest entry
      const oldestKey = this.localCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.localCache.delete(oldestKey);
      }
    }

    this.localCache.set(key, {
      value,
      expireAt: Date.now() + this.localTtlMs,
    });
  }

  /**
   * Invalidate a key from local cache.
   */
  invalidate(key: string): void {
    this.localCache.delete(key);
  }

  /**
   * Get local cache stats.
   */
  getStats(): { localEntries: number; hotKeys: number } {
    return {
      localEntries: this.localCache.size,
      hotKeys: this.detector.getHotKeys().hotKeys.length,
    };
  }

  /**
   * Clear local cache.
   */
  clearLocal(): void {
    this.localCache.clear();
  }
}
