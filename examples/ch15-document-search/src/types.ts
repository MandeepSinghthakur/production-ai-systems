// Canonical schema for document search. See Chapter 15, "Core Concepts".

export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  docId: string;
  chunkIndex: number;
  text: string;
  // Extracted amounts, stored for filtering. The insight: amounts are
  // constraints (filters), not hints (search terms).
  amounts: number[];
}

export interface SearchResult {
  docId: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export interface SearchOptions {
  // When set, only chunks containing this exact amount are candidates.
  // This is the fix for the canonicalization bug: substring collisions
  // in BM25 scores make amounts useless as search terms.
  amountFilter?: number;
  topK?: number;
}

export interface CorpusStats {
  docCount: number;
  chunkCount: number;
  avgChunkLength: number;
  idf: Map<string, number>;
}
