// Hybrid search: combining vector similarity with BM25 keyword matching.
//
// The core insight: vector search and keyword search fail on different queries.
// - Vector search finds semantically similar documents but misses exact keywords
// - BM25 matches exact keywords but misses semantic similarity
//
// Hybrid search runs both, then fuses the results with RRF.
//
// When to use hybrid over single-method:
// - Mixed query types: some semantic, some keyword-heavy
// - Technical domains: acronyms and terms that embeddings miss
// - Critical recall: cannot afford to miss relevant documents

import type { SearchResult, RankedResult, HybridSearchOptions } from './types.ts';
import type { VectorIndex } from './vector-index.ts';
import type { BM25Index } from './bm25.ts';
import { reciprocalRankFusion, weightedRankFusion } from './fusion.ts';

export interface HybridIndex {
  search(query: string, options?: HybridSearchOptions): RankedResult[];
  searchVector(query: string, topK?: number): SearchResult[];
  searchBM25(query: string, topK?: number): SearchResult[];
  getVectorIndex(): VectorIndex;
  getBM25Index(): BM25Index;
}

/**
 * Create a hybrid index combining vector and BM25 search.
 */
export function createHybridIndex(
  vectorIndex: VectorIndex,
  bm25Index: BM25Index
): HybridIndex {
  return {
    search(
      query: string,
      options: HybridSearchOptions = {}
    ): RankedResult[] {
      const topK = options.topK ?? 5;
      const vectorWeight = options.vectorWeight ?? 0.5;
      const rrfK = options.rrfK ?? 60;

      // Retrieve more candidates than topK to allow fusion to work
      const retrieveK = Math.max(topK * 2, 20);

      const vectorResults = vectorIndex.search(query, retrieveK);
      const bm25Results = bm25Index.search(query, retrieveK);

      // If either method returns nothing, use the other
      if (vectorResults.length === 0) {
        return bm25Results.slice(0, topK).map((r, i) => ({
          ...r,
          rank: i + 1,
        }));
      }
      if (bm25Results.length === 0) {
        return vectorResults.slice(0, topK).map((r, i) => ({
          ...r,
          rank: i + 1,
        }));
      }

      // Fuse with optional weighting
      let fused: RankedResult[];
      if (vectorWeight === 0.5) {
        // Equal weights: use standard RRF
        fused = reciprocalRankFusion([vectorResults, bm25Results], rrfK);
      } else {
        // Weighted fusion
        const bm25Weight = 1 - vectorWeight;
        fused = weightedRankFusion(
          [vectorResults, bm25Results],
          [vectorWeight, bm25Weight],
          rrfK
        );
      }

      return fused.slice(0, topK);
    },

    searchVector(query: string, topK: number = 5): SearchResult[] {
      return vectorIndex.search(query, topK);
    },

    searchBM25(query: string, topK: number = 5): SearchResult[] {
      return bm25Index.search(query, topK);
    },

    getVectorIndex(): VectorIndex {
      return vectorIndex;
    },

    getBM25Index(): BM25Index {
      return bm25Index;
    },
  };
}

/**
 * Index a corpus into both vector and BM25 indexes.
 */
export function indexCorpusHybrid(
  documents: Array<{ id: string; text: string }>,
  hybridIndex: HybridIndex
): void {
  const vectorIndex = hybridIndex.getVectorIndex();
  const bm25Index = hybridIndex.getBM25Index();

  // Import dynamically to avoid circular dependency
  const { embed } = require('./embedding.ts') as typeof import('./embedding.ts');

  for (const doc of documents) {
    const embedding = embed(doc.text);
    vectorIndex.add({
      docId: doc.id,
      chunkIndex: 0,
      text: doc.text,
      embedding,
    });
    bm25Index.add(doc.id, 0, doc.text);
  }
}

/**
 * Calculate recall: what fraction of relevant documents were retrieved?
 */
export function calculateRecall(
  results: Array<{ docId: string }>,
  relevantDocIds: string[]
): number {
  if (relevantDocIds.length === 0) return 1.0;

  const retrievedDocIds = new Set(results.map((r) => r.docId));
  let found = 0;
  for (const docId of relevantDocIds) {
    if (retrievedDocIds.has(docId)) found++;
  }

  return found / relevantDocIds.length;
}

/**
 * Calculate precision: what fraction of retrieved documents were relevant?
 */
export function calculatePrecision(
  results: Array<{ docId: string }>,
  relevantDocIds: string[]
): number {
  if (results.length === 0) return 1.0;

  const relevantSet = new Set(relevantDocIds);
  let relevant = 0;
  for (const result of results) {
    if (relevantSet.has(result.docId)) relevant++;
  }

  return relevant / results.length;
}

/**
 * Calculate Mean Reciprocal Rank (MRR).
 * Measures how early the first relevant result appears.
 */
export function calculateMRR(
  results: Array<{ docId: string }>,
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
