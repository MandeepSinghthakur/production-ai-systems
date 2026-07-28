// BM25 implementation for keyword search.
// This is the sparse retrieval baseline for hybrid search.
//
// BM25 excels at exact keyword matching but misses semantic similarity.
// Vector search catches semantics but misses exact keywords.
// Hybrid search combines both.

import type { SearchResult, BM25Stats } from './types.ts';

// BM25 parameters. k1 controls term frequency saturation,
// b controls length normalization.
const K1 = 1.2;
const B = 0.75;

/**
 * Tokenize text into terms for BM25.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export interface BM25Index {
  add(docId: string, chunkIndex: number, text: string): void;
  search(query: string, topK?: number): SearchResult[];
  getStats(): BM25Stats;
}

/**
 * Create a BM25 index.
 */
export function createBM25Index(): BM25Index {
  const documents: Array<{
    docId: string;
    chunkIndex: number;
    text: string;
    terms: string[];
    termFreq: Map<string, number>;
    length: number;
  }> = [];

  // Document frequency for each term
  const docFreq = new Map<string, number>();

  // Cached IDF values (recomputed after each add)
  let cachedIdf = new Map<string, number>();
  let avgLength = 0;

  function recomputeStats(): void {
    const n = documents.length;
    if (n === 0) {
      cachedIdf = new Map();
      avgLength = 0;
      return;
    }

    // Compute IDF for all terms
    cachedIdf = new Map();
    for (const [term, df] of docFreq) {
      // IDF with smoothing to avoid division by zero
      cachedIdf.set(term, Math.log((n - df + 0.5) / (df + 0.5) + 1));
    }

    // Compute average document length
    let totalLen = 0;
    for (const doc of documents) {
      totalLen += doc.length;
    }
    avgLength = totalLen / n;
  }

  return {
    add(docId: string, chunkIndex: number, text: string): void {
      const terms = tokenize(text);
      const termFreq = new Map<string, number>();

      for (const term of terms) {
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      }

      // Update document frequency
      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }

      documents.push({
        docId,
        chunkIndex,
        text,
        terms,
        termFreq,
        length: text.length,
      });

      recomputeStats();
    },

    search(query: string, topK: number = 5): SearchResult[] {
      if (documents.length === 0) {
        return [];
      }

      const queryTerms = tokenize(query);
      const results: SearchResult[] = [];

      for (const doc of documents) {
        let score = 0;

        for (const term of queryTerms) {
          const tf = doc.termFreq.get(term) ?? 0;
          if (tf === 0) continue;

          const idf = cachedIdf.get(term) ?? 0;

          // BM25 scoring formula
          const numerator = tf * (K1 + 1);
          const denominator = tf + K1 * (1 - B + B * (doc.length / avgLength));
          score += idf * (numerator / denominator);
        }

        if (score > 0) {
          results.push({
            docId: doc.docId,
            chunkIndex: doc.chunkIndex,
            score,
            text: doc.text,
          });
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, topK);
    },

    getStats(): BM25Stats {
      return {
        docCount: documents.length,
        chunkCount: documents.length,
        avgChunkLength: avgLength,
        idf: new Map(cachedIdf),
      };
    },
  };
}
