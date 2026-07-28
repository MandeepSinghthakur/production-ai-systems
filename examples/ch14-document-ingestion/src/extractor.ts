// Text extraction from different document formats.
// Simulates real extractors without external dependencies.
// See Chapter 14, "Building Production AI Systems".

import type {
  DocumentFormat,
  SourceMetadata,
  ExtractedPage,
  ExtractionResult,
  ExtractionConfidence,
} from './types.ts';

/**
 * Detect document format from content.
 * In production, you'd check magic bytes and MIME types.
 */
export function detectFormat(content: string, filename: string): DocumentFormat {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') || lower.endsWith('.tiff')) return 'image';

  // Check content signatures
  if (content.startsWith('%PDF')) return 'pdf';
  if (content.includes('<!DOCTYPE html') || content.includes('<html')) return 'html';

  return 'plaintext';
}

/**
 * Extract text from plaintext content.
 * Trivial case: the text is already text.
 */
function extractPlaintext(content: string): ExtractedPage[] {
  const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
  return [{
    pageNumber: 1,
    text: content,
    confidence: 'high',
    wordCount,
    boundingBoxes: null,
  }];
}

/**
 * Extract text from HTML content.
 * Strips tags, preserves structure through whitespace.
 */
function extractHtml(content: string): ExtractedPage[] {
  // Remove script and style tags with content
  let text = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br)[^>]*>/gi, '\n');
  text = text.replace(/<(br|hr)[^>]*\/?>/gi, '\n');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10)));

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  return [{
    pageNumber: 1,
    text,
    confidence: 'high',
    wordCount,
    boundingBoxes: null,
  }];
}

/**
 * Simulate PDF text extraction.
 * In production, this calls pdfjs, poppler, or similar.
 */
function extractPdf(content: string): ExtractedPage[] {
  // Simulate multi-page PDF
  // In a real implementation, parse the PDF structure
  const pages: ExtractedPage[] = [];

  // Check for simulated page markers in test content
  const pageMarker = '--- PAGE BREAK ---';
  const pageParts = content.split(pageMarker);

  for (let i = 0; i < pageParts.length; i++) {
    let text = pageParts[i].trim();

    // Remove PDF header/footer simulation
    text = text.replace(/%PDF-[\d.]+/, '');
    text = text.replace(/%%EOF/, '');
    text = text.trim();

    if (text.length === 0) continue;

    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

    pages.push({
      pageNumber: i + 1,
      text,
      confidence: 'high',
      wordCount,
      boundingBoxes: null,
    });
  }

  // Handle case where no valid pages extracted
  if (pages.length === 0) {
    const cleanContent = content
      .replace(/%PDF-[\d.]+/, '')
      .replace(/%%EOF/, '')
      .trim();

    if (cleanContent.length > 0) {
      const wordCount = cleanContent.split(/\s+/)
        .filter((w) => w.length > 0).length;
      pages.push({
        pageNumber: 1,
        text: cleanContent,
        confidence: 'high',
        wordCount,
        boundingBoxes: null,
      });
    }
  }

  return pages;
}

/**
 * Simulate image/OCR extraction.
 * Returns medium confidence since OCR is never perfect.
 */
function extractImage(content: string): ExtractedPage[] {
  // In production, this calls Tesseract, Google Vision, etc.
  // Our simulation expects the "image" to contain text in a marker

  const ocrMarker = '<!-- OCR TEXT:';
  const endMarker = '-->';

  const start = content.indexOf(ocrMarker);
  const end = content.indexOf(endMarker, start);

  let text: string;
  let confidence: ExtractionConfidence;

  if (start !== -1 && end !== -1) {
    text = content.slice(start + ocrMarker.length, end).trim();
    confidence = 'medium';
  } else {
    // No OCR marker - simulate noisy OCR
    text = content;
    confidence = 'low';
  }

  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

  // Simulate bounding boxes for OCR
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const boundingBoxes = words.map((word, i) => ({
    text: word,
    x: (i % 10) * 0.1,
    y: Math.floor(i / 10) * 0.05,
    width: 0.08,
    height: 0.04,
    confidence: confidence === 'medium' ? 0.85 : 0.6,
  }));

  return [{
    pageNumber: 1,
    text,
    confidence,
    wordCount,
    boundingBoxes,
  }];
}

/**
 * Calculate average confidence from pages.
 */
function aggregateConfidence(pages: ExtractedPage[]): ExtractionConfidence {
  if (pages.length === 0) return 'low';

  const weights = { high: 3, medium: 2, low: 1 };
  const total = pages.reduce((sum, p) => sum + weights[p.confidence], 0);
  const avg = total / pages.length;

  if (avg >= 2.5) return 'high';
  if (avg >= 1.5) return 'medium';
  return 'low';
}

/**
 * Extract text from a document.
 * Main entry point for the extraction layer.
 */
export function extractText(
  content: string,
  filename: string,
  sourceId: string,
): ExtractionResult {
  const startTime = Date.now();

  const format = detectFormat(content, filename);
  const sourceMetadata: SourceMetadata = {
    sourceId,
    sourcePath: filename,
    sourceFormat: format,
    ingestedAt: startTime,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  };

  let pages: ExtractedPage[];

  try {
    switch (format) {
      case 'pdf':
        pages = extractPdf(content);
        break;
      case 'html':
        pages = extractHtml(content);
        break;
      case 'image':
        pages = extractImage(content);
        break;
      case 'plaintext':
      default:
        pages = extractPlaintext(content);
        break;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sourceMetadata,
      pages: [],
      totalWordCount: 0,
      averageConfidence: 'low',
      extractionTimeMs: Date.now() - startTime,
      error: `Extraction failed: ${error}`,
    };
  }

  const totalWordCount = pages.reduce((sum, p) => sum + p.wordCount, 0);
  const averageConfidence = aggregateConfidence(pages);

  return {
    success: true,
    sourceMetadata,
    pages,
    totalWordCount,
    averageConfidence,
    extractionTimeMs: Date.now() - startTime,
  };
}

/**
 * Validate that extraction produced usable content.
 * Returns errors for downstream handling.
 */
export function validateExtraction(
  result: ExtractionResult,
  minWords: number = 1,
): string[] {
  const errors: string[] = [];

  if (!result.success) {
    errors.push(result.error || 'Unknown extraction error');
    return errors;
  }

  if (result.pages.length === 0) {
    errors.push('No pages extracted from document');
  }

  if (result.totalWordCount < minWords) {
    errors.push(
      `Insufficient content: ${result.totalWordCount} words, ` +
      `minimum ${minWords}`
    );
  }

  // Warn on low confidence
  if (result.averageConfidence === 'low') {
    errors.push('Low confidence extraction - manual review recommended');
  }

  return errors;
}
