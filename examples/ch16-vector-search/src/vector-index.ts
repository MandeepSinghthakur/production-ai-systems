// In-memory vector index with cosine similarity search.
//
// Production vector databases use approximate nearest neighbor (ANN)
// algorithms like HNSW for sub-linear search time. This implementation
// uses exact search (O(n) per query) for simplicity.
//
// The concepts transfer:
// - Vectors are normalized at insert time
// - Search computes similarity against all stored vectors
// - Results are sorted by score and truncated to top-K

import type { Chunk, SearchResult, VectorIndexStats } from './types.ts';
import { embed, cosineSimilarity, normalize, getDimensions } from './embedding.ts';

export interface VectorIndex {
  add(chunk: Chunk): void;
  search(query: string, topK?: number): SearchResult[];
  getStats(): VectorIndexStats;
  getChunks(): Chunk[];
}

/**
 * Create an in-memory vector index.
 *
 * In production, you would use a purpose-built vector database with:
 * - HNSW or IVF indexing for O(log n) search
 * - Sharding for horizontal scale
 * - Persistence and replication
 *
 * This implementation demonstrates the interface and correctness.
 */
export function createVectorIndex(): VectorIndex {
  const chunks: Chunk[] = [];

  return {
    add(chunk: Chunk): void {
      // Ensure embedding is normalized
      const normalized = normalize(chunk.embedding);
      chunks.push({
        ...chunk,
        embedding: normalized,
      });
    },

    search(query: string, topK: number = 5): SearchResult[] {
      if (chunks.length === 0) {
        return [];
      }

      // Embed and normalize the query
      const queryEmbedding = normalize(embed(query));

      // Score all chunks
      const scored: Array<{ chunk: Chunk; score: number }> = [];
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        scored.push({ chunk, score });
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Return top-K
      return scored.slice(0, topK).map(({ chunk, score }) => ({
        docId: chunk.docId,
        chunkIndex: chunk.chunkIndex,
        score,
        text: chunk.text,
      }));
    },

    getStats(): VectorIndexStats {
      if (chunks.length === 0) {
        return {
          dimensions: getDimensions(),
          chunkCount: 0,
          avgMagnitude: 0,
        };
      }

      let totalMag = 0;
      for (const chunk of chunks) {
        const mag = Math.sqrt(
          chunk.embedding.reduce((sum, v) => sum + v * v, 0)
        );
        totalMag += mag;
      }

      return {
        dimensions: getDimensions(),
        chunkCount: chunks.length,
        avgMagnitude: totalMag / chunks.length,
      };
    },

    getChunks(): Chunk[] {
      return chunks;
    },
  };
}

/**
 * Index a corpus of documents.
 * Chunks each document and adds embeddings to the index.
 */
export function indexCorpus(
  documents: Array<{ id: string; text: string }>,
  index: VectorIndex
): void {
  for (const doc of documents) {
    // For simplicity, treat each document as a single chunk.
    // In production, you would chunk based on size limits.
    const embedding = embed(doc.text);
    index.add({
      docId: doc.id,
      chunkIndex: 0,
      text: doc.text,
      embedding,
    });
  }
}
