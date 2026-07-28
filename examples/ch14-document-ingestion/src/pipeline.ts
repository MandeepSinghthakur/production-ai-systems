// Ingestion pipeline orchestration.
// Coordinates extraction, OCR, metadata, and normalization.
// See Chapter 14, "Building Production AI Systems".

import type {
  PipelineConfig,
  IngestionResult,
  IngestionStats,
  BatchIngestionResult,
  NormalizedDocument,
  ExtractionConfidence,
} from './types.ts';
import { extractText, validateExtraction, detectFormat } from './extractor.ts';
import { processOcr, isOcrUsable, postProcessOcr } from './ocr.ts';
import { extractMetadata, validateMetadata } from './metadata.ts';
import { normalizeDocument, validateNormalized, DEFAULT_CONFIG } from './normalizer.ts';

/**
 * Ingestion pipeline.
 * Processes documents through extraction, optional OCR, and normalization.
 */
export class IngestionPipeline {
  config: PipelineConfig;

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest a single document.
   */
  ingest(
    content: string,
    filename: string,
    sourceId?: string,
  ): IngestionResult {
    const startTime = Date.now();
    const warnings: string[] = [];
    const stats: IngestionStats = {
      extractionMs: 0,
      normalizationMs: 0,
      totalMs: 0,
      inputBytes: Buffer.byteLength(content, 'utf-8'),
      outputChars: 0,
      pageCount: 0,
      sectionCount: 0,
    };

    // Check size limit
    if (stats.inputBytes > this.config.maxSizeBytes) {
      return {
        success: false,
        documentId: null,
        normalized: null,
        error: `Document exceeds size limit: ${stats.inputBytes} > ${this.config.maxSizeBytes}`,
        warnings,
        stats: { ...stats, totalMs: Date.now() - startTime },
      };
    }

    // Generate source ID if not provided
    const effectiveSourceId = sourceId || `src_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Step 1: Extract text
    const extractStart = Date.now();
    const extraction = extractText(content, filename, effectiveSourceId);
    stats.extractionMs = Date.now() - extractStart;

    // Validate extraction
    const extractionErrors = validateExtraction(extraction);
    if (extractionErrors.some((e) => e.includes('Unknown extraction error'))) {
      return {
        success: false,
        documentId: null,
        normalized: null,
        error: extractionErrors.join('; '),
        warnings,
        stats: { ...stats, totalMs: Date.now() - startTime },
      };
    }

    // Add non-fatal errors as warnings
    for (const err of extractionErrors) {
      if (!err.includes('Unknown extraction error')) {
        warnings.push(err);
      }
    }

    // Step 2: Check if OCR is needed and usable
    const format = detectFormat(content, filename);
    if (format === 'image') {
      // Process through OCR
      const ocrPage = processOcr(content, 'medium');

      if (!isOcrUsable(ocrPage, this.config.minConfidence)) {
        return {
          success: false,
          documentId: null,
          normalized: null,
          error: `OCR confidence too low: ${ocrPage.confidence} < ${this.config.minConfidence}`,
          warnings,
          stats: { ...stats, totalMs: Date.now() - startTime },
        };
      }

      // Replace extraction pages with OCR result
      extraction.pages = [{
        ...ocrPage,
        text: postProcessOcr(ocrPage.text),
      }];
      extraction.averageConfidence = ocrPage.confidence;
      extraction.totalWordCount = ocrPage.wordCount;
    }

    stats.pageCount = extraction.pages.length;

    // Step 3: Normalize
    const normalizeStart = Date.now();
    const normalized = normalizeDocument(extraction, this.config);
    stats.normalizationMs = Date.now() - normalizeStart;

    // Validate normalized output
    const normalizeErrors = validateNormalized(normalized);
    if (normalizeErrors.length > 0) {
      return {
        success: false,
        documentId: null,
        normalized: null,
        error: normalizeErrors.join('; '),
        warnings,
        stats: { ...stats, totalMs: Date.now() - startTime },
      };
    }

    // Add metadata warnings
    const metadataWarnings = validateMetadata(normalized.metadata);
    warnings.push(...metadataWarnings);

    stats.outputChars = normalized.text.length;
    stats.sectionCount = normalized.sections.length;
    stats.totalMs = Date.now() - startTime;

    return {
      success: true,
      documentId: normalized.id,
      normalized,
      warnings,
      stats,
    };
  }

  /**
   * Ingest multiple documents.
   * Processes sequentially (for simplicity) but reports batch stats.
   */
  ingestBatch(
    documents: Array<{ content: string; filename: string; sourceId?: string }>,
  ): BatchIngestionResult {
    const startTime = Date.now();
    const results: IngestionResult[] = [];

    for (const doc of documents) {
      const result = this.ingest(doc.content, doc.filename, doc.sourceId);
      results.push(result);
    }

    return {
      total: documents.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
      totalMs: Date.now() - startTime,
    };
  }
}

/**
 * Create a pipeline with default configuration.
 */
export function createPipeline(config?: Partial<PipelineConfig>): IngestionPipeline {
  return new IngestionPipeline(config);
}

/**
 * Quick ingest for single document.
 */
export function ingestDocument(
  content: string,
  filename: string,
  config?: Partial<PipelineConfig>,
): IngestionResult {
  const pipeline = createPipeline(config);
  return pipeline.ingest(content, filename);
}

/**
 * Extract just the text from a document.
 * Convenience function for simple use cases.
 */
export function extractDocumentText(
  content: string,
  filename: string,
): string | null {
  const result = ingestDocument(content, filename);
  return result.success && result.normalized ? result.normalized.text : null;
}

/**
 * Check if a document can be ingested.
 * Useful for pre-validation before queuing.
 */
export function canIngest(
  content: string,
  filename: string,
  config?: Partial<PipelineConfig>,
): { canIngest: boolean; reason?: string } {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const size = Buffer.byteLength(content, 'utf-8');
  if (size > cfg.maxSizeBytes) {
    return {
      canIngest: false,
      reason: `Document size ${size} exceeds limit ${cfg.maxSizeBytes}`,
    };
  }

  if (size === 0) {
    return {
      canIngest: false,
      reason: 'Document is empty',
    };
  }

  const format = detectFormat(content, filename);
  if (format === 'image' && cfg.minConfidence === 'high') {
    return {
      canIngest: false,
      reason: 'Image documents cannot guarantee high confidence extraction',
    };
  }

  return { canIngest: true };
}

/**
 * Get pipeline statistics for monitoring.
 */
export function getPipelineMetrics(results: IngestionResult[]): {
  totalDocuments: number;
  successRate: number;
  avgExtractionMs: number;
  avgNormalizationMs: number;
  avgTotalMs: number;
  totalInputBytes: number;
  totalOutputChars: number;
  avgCompressionRatio: number;
} {
  const successful = results.filter((r) => r.success);

  const totalInputBytes = results.reduce((sum, r) => sum + r.stats.inputBytes, 0);
  const totalOutputChars = successful.reduce((sum, r) => sum + r.stats.outputChars, 0);

  const avgExtractionMs = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.stats.extractionMs, 0) / successful.length
    : 0;

  const avgNormalizationMs = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.stats.normalizationMs, 0) / successful.length
    : 0;

  const avgTotalMs = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.stats.totalMs, 0) / successful.length
    : 0;

  // Compression ratio: input bytes to output chars (rough approximation)
  const avgCompressionRatio = totalInputBytes > 0
    ? totalOutputChars / totalInputBytes
    : 0;

  return {
    totalDocuments: results.length,
    successRate: results.length > 0 ? successful.length / results.length : 0,
    avgExtractionMs,
    avgNormalizationMs,
    avgTotalMs,
    totalInputBytes,
    totalOutputChars,
    avgCompressionRatio,
  };
}
