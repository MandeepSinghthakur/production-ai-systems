// Deterministic embedding simulation for testing.
// In production, you would call an embedding API. This chapter focuses on
// the retrieval logic, not the embedding model itself.
//
// The simulation creates embeddings where:
// - Semantically similar terms produce similar vectors
// - The same text always produces the same embedding (deterministic)
// - Embeddings are normalized to unit length

const DIMENSIONS = 64;

// Seed-based random number generator for determinism.
// Simple xorshift128+ variant.
function createRng(seed: number): () => number {
  let s0 = seed;
  let s1 = seed ^ 0xdeadbeef;

  return function(): number {
    const x = s0;
    const y = s1;
    s0 = y;
    let t = x ^ (x << 23);
    t = t ^ (t >>> 17);
    t = t ^ y ^ (y >>> 26);
    s1 = t;
    // Convert to 0-1 range
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
    'expense', 'financial', 'dollar', 'fund', 'investment', 'bank'
  ],
  technology: [
    'software', 'computer', 'system', 'digital', 'technology', 'data',
    'algorithm', 'code', 'program', 'network', 'server', 'database'
  ],
  contract: [
    'agreement', 'contract', 'legal', 'clause', 'term', 'party', 'signed',
    'binding', 'obligation', 'provision', 'warranty', 'liability'
  ],
  time: [
    'quarter', 'month', 'year', 'date', 'deadline', 'schedule', 'period',
    'annual', 'fiscal', 'timeline'
  ],
  action: [
    'approved', 'signed', 'received', 'sent', 'completed', 'pending',
    'processed', 'submitted', 'confirmed', 'rejected'
  ]
};

// Build reverse lookup: word -> cluster
const wordToCluster = new Map<string, string>();
for (const [cluster, words] of Object.entries(SEMANTIC_CLUSTERS)) {
  for (const word of words) {
    wordToCluster.set(word.toLowerCase(), cluster);
  }
}

// Generate a base vector for a semantic cluster
function clusterVector(cluster: string): number[] {
  const rng = createRng(hashString(cluster));
  const vec = new Array(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    vec[i] = rng() * 2 - 1;
  }
  return normalize(vec);
}

// Cache cluster vectors
const clusterVectors = new Map<string, number[]>();
for (const cluster of Object.keys(SEMANTIC_CLUSTERS)) {
  clusterVectors.set(cluster, clusterVector(cluster));
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
 * 4. Normalizing to unit length
 */
export function embed(text: string): number[] {
  const tokens = tokenizeForEmbedding(text);
  if (tokens.length === 0) {
    // Empty text: return a random but deterministic vector
    const rng = createRng(hashString(text || 'empty'));
    const vec = new Array(DIMENSIONS);
    for (let i = 0; i < DIMENSIONS; i++) {
      vec[i] = rng() * 2 - 1;
    }
    return normalize(vec);
  }

  // Accumulate embeddings from all tokens
  const accumulated = new Array(DIMENSIONS).fill(0);

  for (const token of tokens) {
    const cluster = wordToCluster.get(token);
    let tokenVec: number[];

    if (cluster && clusterVectors.has(cluster)) {
      // Token is in a semantic cluster: use cluster vector with token noise
      const clusterVec = clusterVectors.get(cluster)!;
      const tokenRng = createRng(hashString(token));
      tokenVec = clusterVec.map((v) => v + (tokenRng() - 0.5) * 0.3);
    } else {
      // Token not in cluster: generate from hash
      const rng = createRng(hashString(token));
      tokenVec = new Array(DIMENSIONS);
      for (let i = 0; i < DIMENSIONS; i++) {
        tokenVec[i] = rng() * 2 - 1;
      }
    }

    for (let i = 0; i < DIMENSIONS; i++) {
      accumulated[i] += tokenVec[i];
    }
  }

  // Average and normalize
  for (let i = 0; i < DIMENSIONS; i++) {
    accumulated[i] /= tokens.length;
  }

  return normalize(accumulated);
}

/**
 * Compute cosine similarity between two vectors.
 * Assumes vectors are already normalized (returns dot product).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Get the embedding dimensions.
 */
export function getDimensions(): number {
  return DIMENSIONS;
}
