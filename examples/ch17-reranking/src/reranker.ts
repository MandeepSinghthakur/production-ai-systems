// Cross-encoder re-ranker simulation.
//
// In production, a cross-encoder (like a BERT model fine-tuned for
// relevance) takes a (query, document) pair and outputs a relevance
// score. This is more accurate than bi-encoder retrieval because it
// can model token-level interactions between query and document.
//
// The tradeoff: cross-encoders are slow. You cannot run them on
// 100,000 documents. Hence the cascade architecture: fast retrieval
// returns top-N candidates, then the re-ranker scores those N.
//
// This file simulates cross-encoder behavior for testing purposes.
// The simulation boosts relevant documents (simulating correct
// relevance modeling) and adds latency (simulating model inference).

import type { RetrievalResult, RerankerConfig } from './types.ts';

const DEFAULT_CONFIG: RerankerConfig = {
  latencyPerDocMs: 5,
  relevanceBoost: 0.4,
};

/**
 * Simulate cross-encoder re-ranking.
 *
 * A real cross-encoder would:
 * 1. Tokenize query + document together
 * 2. Run through a transformer model
 * 3. Output a relevance score from the [CLS] token
 *
 * This simulation:
 * 1. Boosts scores for documents in relevantDocIds (simulating the
 *    cross-encoder correctly identifying relevance)
 * 2. Adds noise (simulating imperfect relevance modeling)
 * 3. Adds latency proportional to document count (simulating inference)
 */
export function rerank(
  query: string,
  results: RetrievalResult[],
  relevantDocIds: string[],
  config: Partial<RerankerConfig> = {}
): { reranked: RetrievalResult[]; latencyMs: number } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const relevantSet = new Set(relevantDocIds);

  const startTime = performance.now();

  // Simulate per-document processing time
  // In a real system this would be batch inference on GPU
  const totalLatencyMs = results.length * cfg.latencyPerDocMs;

  // Re-score each document
  const rescored = results.map((result, index) => {
    let newScore = result.score;

    // Cross-encoders are better at identifying relevance
    if (relevantSet.has(result.docId)) {
      // Boost relevant documents
      newScore += cfg.relevanceBoost;
    } else {
      // Slight penalty for irrelevant documents
      newScore -= cfg.relevanceBoost * 0.2;
    }

    // Add deterministic small noise for tie-breaking (based on position)
    // This simulates imperfect relevance modeling while being reproducible
    newScore += (index * 0.001);

    // Query-document interaction bonus based on term overlap
    // (simulating the cross-encoder modeling this)
    const queryTerms = new Set(tokenize(query));
    const docTerms = tokenize(result.text);
    let overlap = 0;
    for (const term of docTerms) {
      if (queryTerms.has(term)) overlap++;
    }
    newScore += overlap * 0.02;

    return { ...result, score: newScore };
  });

  // Sort by new scores
  rescored.sort((a, b) => b.score - a.score);

  // Simulate blocking latency
  // (In a real system you would await the model inference)
  const actualLatency = performance.now() - startTime + totalLatencyMs;

  return { reranked: rescored, latencyMs: actualLatency };
}

/**
 * Batch re-ranking with configurable depth.
 * Only re-ranks the top rerankDepth documents, leaves rest unchanged.
 */
export function rerankTopK(
  query: string,
  results: RetrievalResult[],
  relevantDocIds: string[],
  rerankDepth: number,
  config: Partial<RerankerConfig> = {}
): { reranked: RetrievalResult[]; latencyMs: number } {
  // Only re-rank the top rerankDepth documents
  const toRerank = results.slice(0, rerankDepth);
  const rest = results.slice(rerankDepth);

  const { reranked, latencyMs } = rerank(
    query,
    toRerank,
    relevantDocIds,
    config
  );

  // Combine re-ranked top-K with un-reranked tail
  return { reranked: [...reranked, ...rest], latencyMs };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Calculate the improvement from re-ranking.
 */
export function calculateImprovement(
  beforeMetric: number,
  afterMetric: number
): { absolute: number; relative: number } {
  const absolute = afterMetric - beforeMetric;
  const relative = beforeMetric > 0 ? (afterMetric - beforeMetric) / beforeMetric : 0;
  return { absolute, relative };
}
