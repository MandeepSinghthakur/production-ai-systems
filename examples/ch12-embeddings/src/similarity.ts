// Similarity metrics for comparing embeddings.
// Each metric has different properties and use cases.

import type { SimilarityMetric, SimilarityResult } from './types.ts';

/**
 * Compute cosine similarity between two vectors.
 *
 * Range: -1 to 1
 * - 1: identical direction
 * - 0: orthogonal (unrelated)
 * - -1: opposite direction
 *
 * For normalized vectors, this equals the dot product.
 * Cosine similarity is magnitude-invariant, making it ideal for
 * comparing semantic meaning regardless of text length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (magA * magB);
}

/**
 * Compute dot product between two vectors.
 *
 * Range: unbounded (depends on vector magnitudes)
 *
 * For normalized vectors, dot product equals cosine similarity.
 * Faster to compute than full cosine similarity when vectors
 * are pre-normalized at index time.
 */
export function dotProduct(a: number[], b: number[]): number {
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
 * Compute Euclidean distance between two vectors.
 *
 * Range: 0 to infinity
 * - 0: identical vectors
 * - Higher values: more different
 *
 * Note: This returns distance, not similarity. To use as similarity,
 * convert with 1 / (1 + distance) or similar transformation.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Convert Euclidean distance to a similarity score.
 * Uses the formula: 1 / (1 + distance)
 *
 * Range: 0 to 1
 * - 1: identical vectors (distance = 0)
 * - Approaches 0 as distance increases
 */
export function euclideanSimilarity(a: number[], b: number[]): number {
  const distance = euclideanDistance(a, b);
  return 1 / (1 + distance);
}

/**
 * Compute similarity using the specified metric.
 */
export function computeSimilarity(
  a: number[],
  b: number[],
  metric: SimilarityMetric
): number {
  switch (metric) {
    case 'cosine':
      return cosineSimilarity(a, b);
    case 'dot_product':
      return dotProduct(a, b);
    case 'euclidean':
      return euclideanSimilarity(a, b);
    default:
      throw new Error(`Unknown similarity metric: ${metric}`);
  }
}

/**
 * Find the most similar vectors to a query vector.
 */
export function findMostSimilar(
  query: number[],
  candidates: Array<{ id: string; text: string; vector: number[] }>,
  metric: SimilarityMetric = 'cosine',
  topK: number = 5
): SimilarityResult[] {
  const scored = candidates.map((candidate) => ({
    id: candidate.id,
    text: candidate.text,
    score: computeSimilarity(query, candidate.vector, metric),
    metric
  }));

  // Sort by score descending (for cosine and dot product)
  // For euclidean, higher similarity means closer
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

/**
 * Check if two vectors are nearly identical.
 * Useful for deduplication.
 */
export function areNearlyIdentical(
  a: number[],
  b: number[],
  threshold: number = 0.99
): boolean {
  return cosineSimilarity(a, b) >= threshold;
}

/**
 * Get the similarity bounds for a metric.
 */
export function getSimilarityBounds(
  metric: SimilarityMetric
): { min: number; max: number } {
  switch (metric) {
    case 'cosine':
      return { min: -1, max: 1 };
    case 'dot_product':
      // For normalized vectors, same as cosine
      // For unnormalized, technically unbounded
      return { min: -Infinity, max: Infinity };
    case 'euclidean':
      // Using the 1/(1+d) transformation
      return { min: 0, max: 1 };
    default:
      throw new Error(`Unknown similarity metric: ${metric}`);
  }
}

/**
 * Validate that a similarity score is within expected bounds.
 */
export function isValidSimilarity(
  score: number,
  metric: SimilarityMetric
): boolean {
  const bounds = getSimilarityBounds(metric);
  return score >= bounds.min && score <= bounds.max;
}
