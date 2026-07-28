// Format normalization for consistent downstream processing.
// Standardizes output regardless of input format.
// See Chapter 14, "Building Production AI Systems".

import type {
  ExtractionResult,
  NormalizedDocument,
  DocumentSection,
  PipelineConfig,
} from './types.ts';
import { extractMetadata, extractSections } from './metadata.ts';

/**
 * Default pipeline configuration.
 */
export const DEFAULT_CONFIG: PipelineConfig = {
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  extractionTimeoutMs: 30000,
  minConfidence: 'low',
  preserveWhitespace: false,
  detectSections: true,
};

/**
 * Normalize whitespace in text.
 * Collapses multiple spaces/newlines, trims lines.
 */
export function normalizeWhitespace(text: string, preserve: boolean): string {
  if (preserve) {
    return text;
  }

  let normalized = text;

  // Normalize line endings
  normalized = normalized.replace(/\r\n/g, '\n');
  normalized = normalized.replace(/\r/g, '\n');

  // Collapse multiple spaces within lines
  normalized = normalized.replace(/[ \t]+/g, ' ');

  // Trim each line
  normalized = normalized
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Collapse multiple blank lines to at most two
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  // Trim overall
  normalized = normalized.trim();

  return normalized;
}

/**
 * Remove control characters that cause downstream issues.
 */
export function removeControlCharacters(text: string): string {
  // Keep tabs and newlines, remove other control chars
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Normalize Unicode to NFC form.
 * Ensures consistent character representation.
 */
export function normalizeUnicode(text: string): string {
  return text.normalize('NFC');
}

/**
 * Fix common OCR/extraction artifacts.
 */
export function fixExtractionArtifacts(text: string): string {
  let fixed = text;

  // Fix hyphenation at line breaks (common in PDFs)
  // "docu-\nment" -> "document"
  fixed = fixed.replace(/(\w)-\n(\w)/g, '$1$2');

  // Fix missing spaces after periods
  fixed = fixed.replace(/\.([A-Z])/g, '. $1');

  // Fix multiple punctuation
  fixed = fixed.replace(/([.!?]){2,}/g, '$1');

  // Fix spacing around common punctuation
  fixed = fixed.replace(/\s+([,.:;!?])/g, '$1');
  fixed = fixed.replace(/([,.:;!?])([A-Za-z])/g, '$1 $2');

  return fixed;
}

/**
 * Detect and remove headers/footers that repeat on every page.
 * Common in multi-page PDF extractions.
 */
export function removeRepeatingHeaders(
  pages: string[],
  threshold: number = 0.7,
): string[] {
  if (pages.length < 3) return pages;

  // Find lines that appear in most pages
  const lineCounts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.split('\n').map((l) => l.trim()).filter(Boolean);

    // Check first and last few lines (likely header/footer)
    const candidates = [
      ...lines.slice(0, 3),
      ...lines.slice(-3),
    ];

    for (const line of candidates) {
      // Normalize for comparison (remove page numbers)
      const normalized = line.replace(/\d+/g, '#');
      lineCounts.set(normalized, (lineCounts.get(normalized) || 0) + 1);
    }
  }

  // Find lines that appear in > threshold of pages
  const repeating = new Set<string>();
  for (const [line, count] of lineCounts) {
    if (count / pages.length >= threshold) {
      repeating.add(line);
    }
  }

  // Remove repeating lines from pages
  return pages.map((page) => {
    const lines = page.split('\n');
    return lines
      .filter((line) => {
        const normalized = line.trim().replace(/\d+/g, '#');
        return !repeating.has(normalized);
      })
      .join('\n');
  });
}

/**
 * Merge pages into a single document text.
 * Handles page breaks intelligently.
 */
export function mergePages(
  pages: string[],
  preservePageBreaks: boolean = false,
): string {
  if (pages.length === 0) return '';
  if (pages.length === 1) return pages[0];

  // Remove repeating headers/footers
  const cleaned = removeRepeatingHeaders(pages);

  if (preservePageBreaks) {
    return cleaned.join('\n\n--- PAGE BREAK ---\n\n');
  }

  // Smart merge: join with appropriate spacing
  const merged: string[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const page = cleaned[i].trim();
    if (!page) continue;

    if (i > 0) {
      const prev = merged[merged.length - 1];
      const prevEndsWithSentence = /[.!?]\s*$/.test(prev);
      const pageStartsWithLower = /^[a-z]/.test(page);

      if (!prevEndsWithSentence && pageStartsWithLower) {
        // Continuation of sentence across page break
        merged[merged.length - 1] = prev + ' ' + page;
      } else {
        merged.push(page);
      }
    } else {
      merged.push(page);
    }
  }

  return merged.join('\n\n');
}

/**
 * Generate a document ID from source metadata.
 * Deterministic: same input produces same ID.
 */
export function generateDocumentId(
  sourcePath: string,
  content: string,
): string {
  // Simple hash based on path and content length
  // In production, use crypto.createHash('sha256')
  const input = `${sourcePath}:${content.length}:${content.slice(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `doc_${Math.abs(hash).toString(36)}`;
}

/**
 * Normalize an extraction result into a consistent format.
 */
export function normalizeDocument(
  result: ExtractionResult,
  config: Partial<PipelineConfig> = {},
): NormalizedDocument {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Merge all page text
  const pageTexts = result.pages.map((p) => p.text);
  let text = mergePages(pageTexts, false);

  // Apply normalizations
  text = removeControlCharacters(text);
  text = normalizeUnicode(text);
  text = fixExtractionArtifacts(text);
  text = normalizeWhitespace(text, cfg.preserveWhitespace);

  // Extract sections if enabled
  let sections: DocumentSection[] = [];
  if (cfg.detectSections) {
    sections = extractSections(text);
  }

  // Extract metadata
  const metadata = extractMetadata(result);

  // Generate ID
  const id = generateDocumentId(
    result.sourceMetadata.sourcePath,
    text,
  );

  return {
    id,
    text,
    sections,
    metadata,
    source: result.sourceMetadata,
    normalizedAt: Date.now(),
  };
}

/**
 * Validate a normalized document.
 * Returns errors that should block indexing.
 */
export function validateNormalized(doc: NormalizedDocument): string[] {
  const errors: string[] = [];

  if (!doc.text || doc.text.trim().length === 0) {
    errors.push('Document has no text content');
  }

  if (doc.text.length > 10 * 1024 * 1024) {
    errors.push('Document exceeds maximum size (10MB)');
  }

  if (doc.metadata.wordCount === 0) {
    errors.push('Document has zero word count');
  }

  return errors;
}

/**
 * Split a large document into parts for parallel processing.
 */
export function splitForProcessing(
  doc: NormalizedDocument,
  maxChars: number = 100000,
): NormalizedDocument[] {
  if (doc.text.length <= maxChars) {
    return [doc];
  }

  // Split on section boundaries if possible
  if (doc.sections.length > 1) {
    const parts: NormalizedDocument[] = [];
    let currentText = '';
    let currentSections: DocumentSection[] = [];

    for (const section of doc.sections) {
      const sectionText = doc.text.slice(section.startOffset, section.endOffset);

      if (currentText.length + sectionText.length > maxChars &&
          currentText.length > 0) {
        // Emit current part
        parts.push({
          ...doc,
          id: `${doc.id}_part${parts.length + 1}`,
          text: currentText,
          sections: currentSections,
        });
        currentText = '';
        currentSections = [];
      }

      currentText += sectionText + '\n\n';
      currentSections.push({
        ...section,
        startOffset: currentText.length - sectionText.length - 2,
        endOffset: currentText.length - 2,
      });
    }

    // Emit final part
    if (currentText.length > 0) {
      parts.push({
        ...doc,
        id: `${doc.id}_part${parts.length + 1}`,
        text: currentText.trim(),
        sections: currentSections,
      });
    }

    return parts;
  }

  // No sections - split on paragraph boundaries
  const paragraphs = doc.text.split(/\n\n+/);
  const parts: NormalizedDocument[] = [];
  let currentText = '';

  for (const para of paragraphs) {
    if (currentText.length + para.length > maxChars && currentText.length > 0) {
      parts.push({
        ...doc,
        id: `${doc.id}_part${parts.length + 1}`,
        text: currentText.trim(),
        sections: [],
      });
      currentText = '';
    }
    currentText += para + '\n\n';
  }

  if (currentText.length > 0) {
    parts.push({
      ...doc,
      id: `${doc.id}_part${parts.length + 1}`,
      text: currentText.trim(),
      sections: [],
    });
  }

  return parts;
}
