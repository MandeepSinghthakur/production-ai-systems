// Combined retriever: optional amount filtering + BM25 search.
// This is the pattern that actually works for numeric queries.

import type { Document, Chunk, SearchResult, SearchOptions } from './types.ts';
import { chunkCorpus } from './chunker.ts';
import { buildStats, searchBM25 } from './bm25.ts';
import { extractQueryAmount, filterByAmount } from './filter.ts';

export interface Retriever {
  search(query: string, options?: SearchOptions): SearchResult[];
  getChunks(): Chunk[];
  getDocuments(): Document[];
}

export interface RetrieverOptions {
  // If true, canonicalize money amounts in text (the broken approach)
  canonicalizeAmounts: boolean;
  // If true, use amount filtering (the fix)
  useAmountFilter: boolean;
}

const DEFAULT_OPTIONS: RetrieverOptions = {
  canonicalizeAmounts: false,
  useAmountFilter: false,
};

/**
 * Create a retriever for a corpus of documents.
 */
export function createRetriever(
  documents: Document[],
  options: Partial<RetrieverOptions> = {}
): Retriever {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Chunk all documents
  const chunks = chunkCorpus(documents);

  // Build corpus statistics
  const stats = buildStats(chunks, opts.canonicalizeAmounts);

  return {
    search(query: string, searchOpts: SearchOptions = {}): SearchResult[] {
      const topK = searchOpts.topK ?? 5;
      let candidateChunks = chunks;

      // Apply amount filter if enabled and query contains an amount
      if (opts.useAmountFilter) {
        const amount = searchOpts.amountFilter ?? extractQueryAmount(query);
        if (amount !== null) {
          candidateChunks = filterByAmount(chunks, amount);
          // If filter returns nothing, fall back to full corpus
          // (the query amount might be a typo or not in corpus)
          if (candidateChunks.length === 0) {
            candidateChunks = chunks;
          }
        }
      }

      // Rebuild stats for filtered corpus (IDF changes with corpus size)
      const filteredStats = candidateChunks === chunks
        ? stats
        : buildStats(candidateChunks, opts.canonicalizeAmounts);

      return searchBM25(
        query,
        candidateChunks,
        filteredStats,
        opts.canonicalizeAmounts,
        topK
      );
    },

    getChunks(): Chunk[] {
      return chunks;
    },

    getDocuments(): Document[] {
      return documents;
    },
  };
}

/**
 * Calculate recall: what fraction of relevant documents were retrieved?
 */
export function calculateRecall(
  results: SearchResult[],
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
  results: SearchResult[],
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
