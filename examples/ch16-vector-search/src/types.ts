// Canonical types for vector search and hybrid retrieval.
// See Chapter 16, "Core Concepts".

export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  docId: string;
  chunkIndex: number;
  text: string;
  // Vector embedding of the chunk text
  embedding: number[];
}

export interface SearchResult {
  docId: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export interface RankedResult {
  docId: string;
  chunkIndex: number;
  rank: number;
  score: number;
  text: string;
}

export interface VectorIndexStats {
  dimensions: number;
  chunkCount: number;
  avgMagnitude: number;
}

export interface BM25Stats {
  docCount: number;
  chunkCount: number;
  avgChunkLength: number;
  idf: Map<string, number>;
}

export interface HybridSearchOptions {
  topK?: number;
  // Weight for vector results in fusion (0-1). BM25 weight is 1 - vectorWeight.
  vectorWeight?: number;
  // RRF constant k (default 60)
  rrfK?: number;
}
