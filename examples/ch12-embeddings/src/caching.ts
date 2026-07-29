// Embedding cache to reduce redundant computation.
// In production, embeddings are expensive: API calls cost money and add
// latency. Caching identical texts saves both.

import type { CacheStats, EmbeddingCacheEntry } from './types.ts';

/**
 * LRU cache for embeddings.
 *
 * Key insight: the cache key is text + model version. The same text
 * embedded with different models produces different vectors, and you
 * must not serve a cached v1 embedding when the request wants v2.
 */
export class EmbeddingCache {
  private cache: Map<string, EmbeddingCacheEntry>;
  private maxSize: number;
  private stats: {
    hits: number;
    misses: number;
    evictions: number;
  };

  constructor(maxSize: number = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Generate a cache key from text and model version.
   */
  private makeKey(text: string, modelVersion: string): string {
    // Normalize whitespace to avoid cache misses on formatting differences
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    return `${modelVersion}:${normalizedText}`;
  }

  /**
   * Get an embedding from cache.
   * Returns null if not found or if model version doesn't match.
   */
  get(text: string, modelVersion: string): number[] | null {
    const key = this.makeKey(text, modelVersion);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Update access tracking for LRU
    entry.hitCount++;
    entry.lastAccessedAt = new Date();

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.embedding;
  }

  /**
   * Store an embedding in cache.
   */
  set(text: string, embedding: number[], modelVersion: string): void {
    const key = this.makeKey(text, modelVersion);

    // If already exists, update it
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      entry.embedding = embedding;
      entry.lastAccessedAt = new Date();
      this.cache.delete(key);
      this.cache.set(key, entry);
      return;
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    const entry: EmbeddingCacheEntry = {
      key,
      embedding,
      modelVersion,
      hitCount: 0,
      createdAt: new Date(),
      lastAccessedAt: new Date()
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if an embedding is cached.
   */
  has(text: string, modelVersion: string): boolean {
    const key = this.makeKey(text, modelVersion);
    return this.cache.has(key);
  }

  /**
   * Remove an embedding from cache.
   */
  delete(text: string, modelVersion: string): boolean {
    const key = this.makeKey(text, modelVersion);
    return this.cache.delete(key);
  }

  /**
   * Clear all entries for a specific model version.
   * Useful when a model version is deprecated or updated.
   */
  clearModelVersion(modelVersion: string): number {
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.modelVersion === modelVersion) {
        this.cache.delete(key);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      totalEntries: this.cache.size,
      evictions: this.stats.evictions
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
  }

  /**
   * Get current cache size.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum cache size.
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}

/**
 * Cached embedding generator that wraps a generator with caching.
 */
export class CachedEmbeddingGenerator {
  private generator: {
    embed: (req: { text: string; modelVersion?: string }) => {
      vector: number[];
      modelVersion: string;
    };
    getModelVersion: () => string;
  };
  private cache: EmbeddingCache;

  constructor(
    generator: {
      embed: (req: { text: string; modelVersion?: string }) => {
        vector: number[];
        modelVersion: string;
      };
      getModelVersion: () => string;
    },
    cacheSize: number = 1000
  ) {
    this.generator = generator;
    this.cache = new EmbeddingCache(cacheSize);
  }

  /**
   * Get embedding, using cache if available.
   */
  embed(text: string, modelVersion?: string): number[] {
    const version = modelVersion ?? this.generator.getModelVersion();

    // Try cache first
    const cached = this.cache.get(text, version);
    if (cached !== null) {
      return cached;
    }

    // Generate and cache
    const result = this.generator.embed({ text, modelVersion: version });
    this.cache.set(text, result.vector, result.modelVersion);

    return result.vector;
  }

  /**
   * Embed multiple texts, using cache where possible.
   */
  embedBatch(texts: string[], modelVersion?: string): number[][] {
    return texts.map((text) => this.embed(text, modelVersion));
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clear cache for a model version.
   */
  clearModelVersion(modelVersion: string): number {
    return this.cache.clearModelVersion(modelVersion);
  }

  /**
   * Clear entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Create a cached embedding generator.
 */
export function createCachedGenerator(
  generator: {
    embed: (req: { text: string; modelVersion?: string }) => {
      vector: number[];
      modelVersion: string;
    };
    getModelVersion: () => string;
  },
  cacheSize?: number
): CachedEmbeddingGenerator {
  return new CachedEmbeddingGenerator(generator, cacheSize);
}
