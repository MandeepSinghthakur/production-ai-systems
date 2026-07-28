// Core types for document ingestion pipeline.
// See Chapter 14, "Building Production AI Systems".

/**
 * Supported document formats for ingestion.
 * We handle these at the extraction layer before normalization.
 */
export type DocumentFormat = 'pdf' | 'html' | 'plaintext' | 'image';

/**
 * Extraction confidence: how certain are we about the text?
 * OCR outputs lower confidence than native text extraction.
 */
export type ExtractionConfidence = 'high' | 'medium' | 'low';

/**
 * Source metadata: where did this document come from?
 * Preserved through the pipeline for traceability.
 */
export interface SourceMetadata {
  sourceId: string;
  sourcePath: string;
  sourceFormat: DocumentFormat;
  ingestedAt: number;
  sizeBytes: number;
}

/**
 * Page-level extraction result.
 * PDFs and images produce multiple pages; plaintext is one page.
 */
export interface ExtractedPage {
  pageNumber: number;
  text: string;
  confidence: ExtractionConfidence;
  wordCount: number;
  // Bounding boxes for OCR'd text, null for native text
  boundingBoxes: BoundingBox[] | null;
}

/**
 * Bounding box for OCR text location.
 * Coordinates are normalized 0-1 relative to page dimensions.
 */
export interface BoundingBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/**
 * Result of text extraction from a document.
 * Contains all pages plus aggregated metadata.
 */
export interface ExtractionResult {
  success: boolean;
  sourceMetadata: SourceMetadata;
  pages: ExtractedPage[];
  totalWordCount: number;
  averageConfidence: ExtractionConfidence;
  extractionTimeMs: number;
  error?: string;
}

/**
 * Section detected within a document.
 * Used for structural chunking downstream.
 */
export interface DocumentSection {
  title: string | null;
  level: number; // 1 = h1, 2 = h2, etc.
  startOffset: number;
  endOffset: number;
  text: string;
}

/**
 * Normalized document ready for chunking.
 * All format-specific quirks removed.
 */
export interface NormalizedDocument {
  id: string;
  text: string;
  sections: DocumentSection[];
  metadata: DocumentMetadata;
  source: SourceMetadata;
  normalizedAt: number;
}

/**
 * Extracted document metadata.
 * Includes both detected and explicit metadata.
 */
export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  createdAt: number | null;
  language: string;
  detectedFormat: DocumentFormat;
  pageCount: number;
  wordCount: number;
  extractionConfidence: ExtractionConfidence;
  // Custom fields from document properties
  custom: Record<string, unknown>;
}

/**
 * Pipeline configuration.
 */
export interface PipelineConfig {
  // Max document size in bytes (default 10MB)
  maxSizeBytes: number;
  // Timeout for extraction in ms (default 30000)
  extractionTimeoutMs: number;
  // Minimum confidence to accept OCR output (default 'low')
  minConfidence: ExtractionConfidence;
  // Whether to preserve whitespace exactly (default false)
  preserveWhitespace: boolean;
  // Whether to detect sections/headers (default true)
  detectSections: boolean;
}

/**
 * Ingestion result for a single document.
 */
export interface IngestionResult {
  success: boolean;
  documentId: string | null;
  normalized: NormalizedDocument | null;
  error?: string;
  warnings: string[];
  stats: IngestionStats;
}

/**
 * Statistics for an ingestion operation.
 */
export interface IngestionStats {
  extractionMs: number;
  normalizationMs: number;
  totalMs: number;
  inputBytes: number;
  outputChars: number;
  pageCount: number;
  sectionCount: number;
}

/**
 * Batch ingestion result.
 */
export interface BatchIngestionResult {
  total: number;
  succeeded: number;
  failed: number;
  results: IngestionResult[];
  totalMs: number;
}
