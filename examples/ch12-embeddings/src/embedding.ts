// Embedding generation simulation for production testing.
// In production, you would call an embedding API. This focuses on
// demonstrating properties that matter: normalization, determinism,
// semantic clustering, and dimension handling.

import type { Embedding, EmbeddingConfig, EmbeddingRequest } from './types.ts';

const DEFAULT_DIMENSIONS = 128;

// Seed-based random number generator for determinism.
// Simple xorshift128+ variant.
function createRng(seed: number): () => number {
  let s0 = seed;
  let s1 = seed ^ 0xdeadbeef;

  return function (): number {
    const x = s0;
    const y = s1;
    s0 = y;
    let t = x ^ (x << 23);
    t = t ^ (t >>> 17);
    t = t ^ y ^ (y >>> 26);
    s1 = t;
    return (s1 >>> 0) / 4294967296;
  };
}

// Simple hash function for strings
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

// Semantic clusters: words that should produce similar embeddings
const SEMANTIC_CLUSTERS: Record<string, string[]> = {
  finance: [
    'money', 'payment', 'budget', 'cost', 'price', 'revenue', 'profit',
    'expense', 'financial', 'dollar', 'fund', 'investment', 'bank', 'credit'
  ],
  technology: [
    'software', 'computer', 'system', 'digital', 'technology', 'data',
    'algorithm', 'code', 'program', 'network', 'server', 'database', 'api'
  ],
  health: [
    'medical', 'health', 'doctor', 'patient', 'hospital', 'treatment',
    'diagnosis', 'medicine', 'clinical', 'therapy', 'care', 'wellness'
  ],
  legal: [
    'agreement', 'contract', 'legal', 'clause', 'term', 'party', 'signed',
    'binding', 'obligation', 'provision', 'warranty', 'liability', 'law'
  ],
  travel: [
    'flight', 'hotel', 'travel', 'vacation', 'trip', 'destination',
    'booking', 'airport', 'journey', 'tourist', 'itinerary', 'passport'
  ]
};

// Build reverse lookup: word -> cluster
const wordToCluster = new Map<string, string>();
for (const [cluster, words] of Object.entries(SEMANTIC_CLUSTERS)) {
  for (const word of words) {
    wordToCluster.set(word.toLowerCase(), cluster);
  }
}

// Cache cluster vectors per dimension setting
const clusterVectorCache = new Map<string, number[]>();

function getClusterVector(cluster: string, dimensions: number): number[] {
  const key = `${cluster}:${dimensions}`;
  if (clusterVectorCache.has(key)) {
    return clusterVectorCache.get(key)!;
  }

  const rng = createRng(hashString(cluster));
  const vec = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    vec[i] = rng() * 2 - 1;
  }
  const normalized = normalize(vec);
  clusterVectorCache.set(key, normalized);
  return normalized;
}

/**
 * Normalize a vector to unit length.
 */
export function normalize(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (mag === 0) return vec.map(() => 0);
  return vec.map((v) => v / mag);
}

/**
 * Calculate vector magnitude.
 */
export function magnitude(vec: number[]): number {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

/**
 * Tokenize text into words for embedding.
 */
function tokenizeForEmbedding(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Generate a deterministic embedding for text.
 *
 * The embedding is constructed by:
 * 1. Tokenizing the text
 * 2. For each token, generating a component based on its cluster (if any)
 *    or its hash (if not in a cluster)
 * 3. Averaging all components
 * 4. Normalizing to unit length (optional based on config)
 */
export function generateEmbedding(
  text: string,
  dimensions: number = DEFAULT_DIMENSIONS,
  shouldNormalize: boolean = true
): number[] {
  const tokens = tokenizeForEmbedding(text);
  if (tokens.length === 0) {
    const rng = createRng(hashString(text || 'empty'));
    const vec = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      vec[i] = rng() * 2 - 1;
    }
    return shouldNormalize ? normalize(vec) : vec;
  }

  const accumulated = new Array(dimensions).fill(0);

  // Track cluster contributions for stronger semantic signal
  const clusterCounts = new Map<string, number>();

  for (const token of tokens) {
    const cluster = wordToCluster.get(token);
    let tokenVec: number[];

    if (cluster) {
      // Count cluster occurrences for weighting
      clusterCounts.set(cluster, (clusterCounts.get(cluster) ?? 0) + 1);

      // Use cluster vector with small per-token noise
      const clusterVec = getClusterVector(cluster, dimensions);
      const tokenRng = createRng(hashString(token));
      tokenVec = clusterVec.map((v) => v + (tokenRng() - 0.5) * 0.1);
    } else {
      const rng = createRng(hashString(token));
      tokenVec = new Array(dimensions);
      for (let i = 0; i < dimensions; i++) {
        tokenVec[i] = rng() * 2 - 1;
      }
    }

    for (let i = 0; i < dimensions; i++) {
      accumulated[i] += tokenVec[i];
    }
  }

  // Boost cluster signals - add extra weight for dominant clusters
  for (const [cluster, count] of clusterCounts) {
    if (count >= 1) {
      const clusterVec = getClusterVector(cluster, dimensions);
      const boostFactor = count * 0.5;
      for (let i = 0; i < dimensions; i++) {
        accumulated[i] += clusterVec[i] * boostFactor;
      }
    }
  }

  for (let i = 0; i < dimensions; i++) {
    accumulated[i] /= tokens.length;
  }

  return shouldNormalize ? normalize(accumulated) : accumulated;
}

/**
 * Embedding generator class that simulates a model API.
 */
export class EmbeddingGenerator {
  private config: EmbeddingConfig;
  private callCount: number;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = {
      dimensions: config?.dimensions ?? DEFAULT_DIMENSIONS,
      normalize: config?.normalize ?? true,
      modelVersion: config?.modelVersion ?? 'v1.0'
    };
    this.callCount = 0;
  }

  embed(request: EmbeddingRequest): Embedding {
    this.callCount++;
    const text = request.text;
    const modelVersion = request.modelVersion ?? this.config.modelVersion;

    // Simulate different model versions producing different embeddings
    // by appending a version suffix to the text before embedding
    const textForEmbedding = modelVersion === 'v2.0' ? text + '_v2' : text;

    const vector = generateEmbedding(
      textForEmbedding,
      this.config.dimensions,
      this.config.normalize
    );

    return {
      id: `emb_${hashString(text + modelVersion)}`,
      text,
      vector,
      dimensions: this.config.dimensions,
      modelVersion,
      createdAt: new Date()
    };
  }

  embedBatch(requests: EmbeddingRequest[]): Embedding[] {
    return requests.map((req) => this.embed(req));
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetCallCount(): void {
    this.callCount = 0;
  }

  getDimensions(): number {
    return this.config.dimensions;
  }

  getModelVersion(): string {
    return this.config.modelVersion;
  }
}

/**
 * Create an embedding generator with specific configuration.
 */
export function createEmbeddingGenerator(
  config?: Partial<EmbeddingConfig>
): EmbeddingGenerator {
  return new EmbeddingGenerator(config);
}

export { DEFAULT_DIMENSIONS };
