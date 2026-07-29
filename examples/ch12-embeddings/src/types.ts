// Canonical types for embeddings.
// See Chapter 12, "Core Concepts".

export interface Embedding {
  id: string;
  text: string;
  vector: number[];
  dimensions: number;
  modelVersion: string;
  createdAt: Date;
}

export interface EmbeddingRequest {
  text: string;
  modelVersion?: string;
}

export interface SimilarityResult {
  id: string;
  text: string;
  score: number;
  metric: SimilarityMetric;
}

export type SimilarityMetric = 'cosine' | 'dot_product' | 'euclidean';

export interface EmbeddingCacheEntry {
  key: string;
  embedding: number[];
  modelVersion: string;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  evictions: number;
}

export interface DriftReport {
  modelA: string;
  modelB: string;
  sampleSize: number;
  avgCosineDelta: number;
  maxCosineDelta: number;
  driftDetected: boolean;
  affectedPairs: DriftPair[];
}

export interface DriftPair {
  textA: string;
  textB: string;
  oldSimilarity: number;
  newSimilarity: number;
  delta: number;
}

export interface EmbeddingConfig {
  dimensions: number;
  normalize: boolean;
  modelVersion: string;
}

// Dimension trade-offs
export const DIMENSION_PROFILES: Record<string, EmbeddingDimensionProfile> = {
  small: {
    dimensions: 256,
    storageBytesPerVector: 1024,
    searchLatencyMs: 5,
    semanticResolution: 'coarse',
    useCase: 'High-throughput, low-latency applications'
  },
  medium: {
    dimensions: 768,
    storageBytesPerVector: 3072,
    searchLatencyMs: 15,
    semanticResolution: 'balanced',
    useCase: 'General-purpose semantic search'
  },
  large: {
    dimensions: 1536,
    storageBytesPerVector: 6144,
    searchLatencyMs: 30,
    semanticResolution: 'fine',
    useCase: 'High-precision similarity, subtle distinctions'
  }
};

export interface EmbeddingDimensionProfile {
  dimensions: number;
  storageBytesPerVector: number;
  searchLatencyMs: number;
  semanticResolution: 'coarse' | 'balanced' | 'fine';
  useCase: string;
}
