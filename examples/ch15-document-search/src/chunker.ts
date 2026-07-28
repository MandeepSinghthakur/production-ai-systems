// Document chunking strategies. This chapter focuses on the interaction
// between chunking and numeric retrieval, not chunking in general.

import type { Document, Chunk } from './types.ts';
import { extractAmounts } from './normalizer.ts';

export interface ChunkingOptions {
  maxChunkSize: number;
  overlap: number;
}

const DEFAULTS: ChunkingOptions = {
  maxChunkSize: 500,
  overlap: 50,
};

/**
 * Split a document into chunks with optional overlap.
 * Amounts are extracted and stored for filtering.
 */
export function chunkDocument(
  doc: Document,
  options: Partial<ChunkingOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULTS, ...options };
  const text = doc.text;
  const chunks: Chunk[] = [];

  // For short documents, return a single chunk
  if (text.length <= opts.maxChunkSize) {
    chunks.push({
      docId: doc.id,
      chunkIndex: 0,
      text: text,
      amounts: extractAmounts(text),
    });
    return chunks;
  }

  // Split on sentence boundaries where possible
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > opts.maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push({
          docId: doc.id,
          chunkIndex,
          text: currentChunk.trim(),
          amounts: extractAmounts(currentChunk),
        });
        chunkIndex++;

        // Apply overlap: keep the last part of current chunk
        if (opts.overlap > 0) {
          const overlapStart = Math.max(0, currentChunk.length - opts.overlap);
          currentChunk = currentChunk.slice(overlapStart) + sentence;
        } else {
          currentChunk = sentence;
        }
      } else {
        // Single sentence is too long, just use it
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      docId: doc.id,
      chunkIndex,
      text: currentChunk.trim(),
      amounts: extractAmounts(currentChunk),
    });
  }

  return chunks;
}

/**
 * Chunk a corpus of documents.
 */
export function chunkCorpus(
  docs: Document[],
  options: Partial<ChunkingOptions> = {}
): Chunk[] {
  const allChunks: Chunk[] = [];
  for (const doc of docs) {
    allChunks.push(...chunkDocument(doc, options));
  }
  return allChunks;
}
