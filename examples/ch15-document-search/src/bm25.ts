// BM25 implementation. No external dependencies.
// This chapter demonstrates why BM25 alone fails for numeric queries:
// canonicalized money tokens share substrings that inflate scores.

import type { Chunk, SearchResult, CorpusStats } from './types.ts';
import { normalizeForSearch } from './normalizer.ts';

// BM25 parameters. k1 controls term frequency saturation,
// b controls length normalization.
const K1 = 1.2;
const B = 0.75;

/**
 * Tokenize text into terms for BM25.
 */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Build corpus statistics: document frequency and IDF for each term.
 */
export function buildStats(chunks: Chunk[], canonicalizeAmounts: boolean): CorpusStats {
  const docFreq = new Map<string, number>();
  let totalLength = 0;

  for (const chunk of chunks) {
    const normalized = normalizeForSearch(chunk.text, canonicalizeAmounts);
    const terms = new Set(tokenize(normalized));
    totalLength += normalized.length;

    for (const term of terms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const n = chunks.length;
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    // IDF with smoothing to avoid division by zero
    idf.set(term, Math.log((n - df + 0.5) / (df + 0.5) + 1));
  }

  return {
    docCount: n,
    chunkCount: n,
    avgChunkLength: n > 0 ? totalLength / n : 0,
    idf,
  };
}

/**
 * Score a single chunk against a query using BM25.
 */
export function scoreBM25(
  chunk: Chunk,
  queryTerms: string[],
  stats: CorpusStats,
  canonicalizeAmounts: boolean
): number {
  const normalized = normalizeForSearch(chunk.text, canonicalizeAmounts);
  const docTerms = tokenize(normalized);
  const docLen = normalized.length;
  const avgLen = stats.avgChunkLength;

  // Term frequency in this document
  const tf = new Map<string, number>();
  for (const term of docTerms) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const termTf = tf.get(term) ?? 0;
    if (termTf === 0) continue;

    const idf = stats.idf.get(term) ?? 0;

    // BM25 scoring formula
    const numerator = termTf * (K1 + 1);
    const denominator = termTf + K1 * (1 - B + B * (docLen / avgLen));
    score += idf * (numerator / denominator);
  }

  return score;
}

/**
 * Search the corpus using BM25.
 */
export function searchBM25(
  query: string,
  chunks: Chunk[],
  stats: CorpusStats,
  canonicalizeAmounts: boolean,
  topK: number = 5
): SearchResult[] {
  const normalizedQuery = normalizeForSearch(query, canonicalizeAmounts);
  const queryTerms = tokenize(normalizedQuery);

  const results: SearchResult[] = [];
  for (const chunk of chunks) {
    const score = scoreBM25(chunk, queryTerms, stats, canonicalizeAmounts);
    if (score > 0) {
      results.push({
        docId: chunk.docId,
        chunkIndex: chunk.chunkIndex,
        score,
        text: chunk.text,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
}
