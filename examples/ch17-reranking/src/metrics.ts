// Retrieval evaluation metrics: Precision@k, Recall@k, MRR, NDCG.
// These are the standard metrics used to evaluate search quality.

import type { RetrievalResult, EvalMetrics } from './types.ts';

/**
 * Precision@K: What fraction of the top K results are relevant?
 *
 * High precision means few false positives in the results.
 * Low precision means the user sees many irrelevant documents.
 */
export function precisionAtK(
  results: RetrievalResult[],
  relevantDocIds: string[],
  k: number
): number {
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;

  const relevantSet = new Set(relevantDocIds);
  let relevant = 0;

  for (const result of topK) {
    if (relevantSet.has(result.docId)) {
      relevant++;
    }
  }

  return relevant / topK.length;
}

/**
 * Recall@K: What fraction of all relevant documents appear in top K?
 *
 * High recall means most relevant documents were retrieved.
 * Low recall means important documents are missing from results.
 */
export function recallAtK(
  results: RetrievalResult[],
  relevantDocIds: string[],
  k: number
): number {
  if (relevantDocIds.length === 0) return 1;

  const topK = results.slice(0, k);
  const retrievedIds = new Set(topK.map((r) => r.docId));
  let found = 0;

  for (const docId of relevantDocIds) {
    if (retrievedIds.has(docId)) {
      found++;
    }
  }

  return found / relevantDocIds.length;
}

/**
 * Mean Reciprocal Rank (MRR): Where does the first relevant result appear?
 *
 * If the first relevant document is at position 1, MRR = 1.
 * If at position 2, MRR = 0.5. If at position 10, MRR = 0.1.
 *
 * MRR rewards putting relevant documents early in the ranking.
 */
export function meanReciprocalRank(
  results: RetrievalResult[],
  relevantDocIds: string[]
): number {
  const relevantSet = new Set(relevantDocIds);

  for (let i = 0; i < results.length; i++) {
    if (relevantSet.has(results[i].docId)) {
      return 1 / (i + 1);
    }
  }

  return 0;
}

/**
 * Normalized Discounted Cumulative Gain (NDCG): How good is the ranking?
 *
 * NDCG accounts for both relevance and position. A relevant document
 * at position 1 contributes more than one at position 10.
 *
 * Returns a value between 0 and 1, where 1 is a perfect ranking.
 */
export function ndcg(
  results: RetrievalResult[],
  relevantDocIds: string[],
  k: number
): number {
  const topK = results.slice(0, k);
  const relevantSet = new Set(relevantDocIds);

  // DCG: sum of rel_i / log2(i + 2) for binary relevance
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = relevantSet.has(topK[i].docId) ? 1 : 0;
    dcg += rel / Math.log2(i + 2);
  }

  // IDCG: DCG of the ideal ranking (all relevant docs first)
  const idealCount = Math.min(relevantDocIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Compute all standard metrics for a single query result.
 */
export function computeMetrics(
  results: RetrievalResult[],
  relevantDocIds: string[],
  k: number
): EvalMetrics {
  return {
    precisionAtK: precisionAtK(results, relevantDocIds, k),
    recallAtK: recallAtK(results, relevantDocIds, k),
    mrr: meanReciprocalRank(results, relevantDocIds),
    ndcg: ndcg(results, relevantDocIds, k),
  };
}

/**
 * Aggregate metrics across multiple queries.
 */
export function aggregateMetrics(allMetrics: EvalMetrics[]): EvalMetrics {
  if (allMetrics.length === 0) {
    return { precisionAtK: 0, recallAtK: 0, mrr: 0, ndcg: 0 };
  }

  const sum = allMetrics.reduce(
    (acc, m) => ({
      precisionAtK: acc.precisionAtK + m.precisionAtK,
      recallAtK: acc.recallAtK + m.recallAtK,
      mrr: acc.mrr + m.mrr,
      ndcg: acc.ndcg + m.ndcg,
    }),
    { precisionAtK: 0, recallAtK: 0, mrr: 0, ndcg: 0 }
  );

  const n = allMetrics.length;
  return {
    precisionAtK: sum.precisionAtK / n,
    recallAtK: sum.recallAtK / n,
    mrr: sum.mrr / n,
    ndcg: sum.ndcg / n,
  };
}
