// Reciprocal Rank Fusion (RRF) for combining ranked lists.
//
// The problem: vector search and BM25 produce scores on different scales.
// Cosine similarity ranges from -1 to 1. BM25 scores are unbounded positive.
// You cannot simply average them.
//
// RRF solves this by using ranks instead of scores. For each result,
// compute 1 / (k + rank) where k is a constant (typically 60). Sum
// across all retrievers. Higher totals rank higher in the fused list.
//
// Why RRF works:
// - Rank-based: immune to score scale differences
// - Rewards consensus: items ranked highly by both methods score higher
// - Handles missing items: if an item appears in only one list, it still
//   gets a score from that list
// - Simple: no hyperparameter tuning beyond k

import type { SearchResult, RankedResult } from './types.ts';

/**
 * Default RRF constant. Higher values give more weight to lower ranks.
 * 60 is the value used in the original RRF paper.
 */
const DEFAULT_RRF_K = 60;

/**
 * Fuse multiple ranked lists using Reciprocal Rank Fusion.
 *
 * @param rankedLists - Arrays of search results, each sorted by score descending
 * @param rrfK - RRF constant (default 60)
 * @returns Fused results sorted by combined RRF score
 */
export function reciprocalRankFusion(
  rankedLists: SearchResult[][],
  rrfK: number = DEFAULT_RRF_K
): RankedResult[] {
  // Map from "docId:chunkIndex" to accumulated RRF score
  const scores = new Map<string, {
    docId: string;
    chunkIndex: number;
    text: string;
    rrfScore: number;
    ranks: number[];
  }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const result = list[rank];
      const key = `${result.docId}:${result.chunkIndex}`;

      // RRF score contribution: 1 / (k + rank)
      // rank is 0-indexed, so the top result has rank 0
      const contribution = 1 / (rrfK + rank + 1);

      if (scores.has(key)) {
        const existing = scores.get(key)!;
        existing.rrfScore += contribution;
        existing.ranks.push(rank + 1);
      } else {
        scores.set(key, {
          docId: result.docId,
          chunkIndex: result.chunkIndex,
          text: result.text,
          rrfScore: contribution,
          ranks: [rank + 1],
        });
      }
    }
  }

  // Convert to array and sort by RRF score descending
  const results: RankedResult[] = [];
  for (const [, value] of scores) {
    results.push({
      docId: value.docId,
      chunkIndex: value.chunkIndex,
      rank: 0, // Will be set after sorting
      score: value.rrfScore,
      text: value.text,
    });
  }

  results.sort((a, b) => b.score - a.score);

  // Assign final ranks
  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }

  return results;
}

/**
 * Weighted fusion: apply different weights to each ranked list.
 *
 * Useful when you want to give more importance to one retriever.
 * For example, weight vector search higher for semantic queries,
 * or BM25 higher for queries with specific keywords.
 *
 * @param rankedLists - Arrays of search results
 * @param weights - Weight for each list (should sum to 1 for interpretability)
 * @param rrfK - RRF constant
 */
export function weightedRankFusion(
  rankedLists: SearchResult[][],
  weights: number[],
  rrfK: number = DEFAULT_RRF_K
): RankedResult[] {
  if (rankedLists.length !== weights.length) {
    throw new Error('Number of lists must match number of weights');
  }

  const scores = new Map<string, {
    docId: string;
    chunkIndex: number;
    text: string;
    rrfScore: number;
  }>();

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx];
    const weight = weights[listIdx];

    for (let rank = 0; rank < list.length; rank++) {
      const result = list[rank];
      const key = `${result.docId}:${result.chunkIndex}`;

      // Weighted RRF score contribution
      const contribution = (weight * 1) / (rrfK + rank + 1);

      if (scores.has(key)) {
        scores.get(key)!.rrfScore += contribution;
      } else {
        scores.set(key, {
          docId: result.docId,
          chunkIndex: result.chunkIndex,
          text: result.text,
          rrfScore: contribution,
        });
      }
    }
  }

  const results: RankedResult[] = [];
  for (const [, value] of scores) {
    results.push({
      docId: value.docId,
      chunkIndex: value.chunkIndex,
      rank: 0,
      score: value.rrfScore,
      text: value.text,
    });
  }

  results.sort((a, b) => b.score - a.score);

  for (let i = 0; i < results.length; i++) {
    results[i].rank = i + 1;
  }

  return results;
}

/**
 * Calculate how much agreement there is between two ranked lists.
 * Returns a value from 0 (no overlap) to 1 (identical top-K).
 */
export function rankCorrelation(
  listA: SearchResult[],
  listB: SearchResult[],
  topK: number
): number {
  const setA = new Set(
    listA.slice(0, topK).map((r) => `${r.docId}:${r.chunkIndex}`)
  );
  const setB = new Set(
    listB.slice(0, topK).map((r) => `${r.docId}:${r.chunkIndex}`)
  );

  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }

  return overlap / topK;
}
