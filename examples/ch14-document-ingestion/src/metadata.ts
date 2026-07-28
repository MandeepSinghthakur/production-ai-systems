// Metadata extraction and preservation.
// Keeps track of source, page numbers, sections.
// See Chapter 14, "Building Production AI Systems".

import type {
  DocumentMetadata,
  DocumentSection,
  ExtractionResult,
  ExtractionConfidence,
} from './types.ts';

/**
 * Common section header patterns.
 * Used to detect document structure.
 */
const SECTION_PATTERNS = [
  // Markdown-style headers
  { regex: /^(#{1,6})\s+(.+)$/gm, levelFn: (m: RegExpMatchArray) => m[1].length },
  // Numbered sections: "1. Section", "1.2 Subsection"
  { regex: /^(\d+(?:\.\d+)*)[.)\s]+(.+)$/gm, levelFn: (m: RegExpMatchArray) => {
    const parts = m[1].split('.').length;
    return Math.min(parts, 6);
  }},
  // ALL CAPS headers (common in legal docs)
  { regex: /^([A-Z][A-Z\s]{3,50})$/gm, levelFn: () => 2 },
  // Underlined headers (in plaintext)
  { regex: /^(.+)\n[=]{3,}$/gm, levelFn: () => 1 },
  { regex: /^(.+)\n[-]{3,}$/gm, levelFn: () => 2 },
];

/**
 * Detect title from document content.
 * Looks for first heading or prominent text.
 */
export function detectTitle(text: string): string | null {
  // Try markdown H1
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Try underlined H1
  const underlineMatch = text.match(/^(.+)\n={3,}$/m);
  if (underlineMatch) return underlineMatch[1].trim();

  // Try first line if it looks like a title
  const firstLine = text.trim().split('\n')[0];
  if (firstLine &&
      firstLine.length < 100 &&
      !firstLine.endsWith('.') &&
      /^[A-Z]/.test(firstLine)) {
    return firstLine.trim();
  }

  return null;
}

/**
 * Detect author from document content.
 * Looks for common author attribution patterns.
 */
export function detectAuthor(text: string): string | null {
  // "By Author Name"
  const byMatch = text.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (byMatch) return byMatch[1];

  // "Author: Name"
  const authorMatch = text.match(/\bauthor:\s*([^\n]+)/i);
  if (authorMatch) return authorMatch[1].trim();

  // "Written by Name"
  const writtenMatch = text.match(/\bwritten\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  if (writtenMatch) return writtenMatch[1];

  return null;
}

/**
 * Detect language from document content.
 * Simple heuristic based on common words.
 */
export function detectLanguage(text: string): string {
  const lower = text.toLowerCase();

  // Count common words per language
  const indicators: Record<string, string[]> = {
    en: ['the', 'and', 'is', 'to', 'of', 'in', 'that', 'for'],
    es: ['el', 'la', 'de', 'que', 'en', 'los', 'del', 'por'],
    fr: ['le', 'la', 'de', 'et', 'des', 'les', 'en', 'que'],
    de: ['der', 'die', 'und', 'den', 'das', 'ist', 'von', 'mit'],
  };

  const scores: Record<string, number> = {};

  for (const [lang, words] of Object.entries(indicators)) {
    scores[lang] = words.filter((w) =>
      new RegExp(`\\b${w}\\b`, 'gi').test(lower)
    ).length;
  }

  const best = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)[0];

  return best && best[1] > 2 ? best[0] : 'en';
}

/**
 * Detect date from document content.
 * Returns timestamp or null.
 */
export function detectDate(text: string): number | null {
  // ISO format: 2024-01-15
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const date = new Date(isoMatch[0]);
    if (!isNaN(date.getTime())) return date.getTime();
  }

  // US format: January 15, 2024 or Jan 15, 2024
  const usMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (usMatch) {
    const date = new Date(usMatch[0]);
    if (!isNaN(date.getTime())) return date.getTime();
  }

  // European format: 15 January 2024
  const euMatch = text.match(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
  );
  if (euMatch) {
    const date = new Date(euMatch[0]);
    if (!isNaN(date.getTime())) return date.getTime();
  }

  return null;
}

/**
 * Extract sections from document text.
 * Identifies headers and their hierarchical structure.
 */
export function extractSections(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const seen = new Set<string>();

  for (const pattern of SECTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      const fullMatch = match[0];
      const startOffset = match.index;
      const key = `${startOffset}:${fullMatch}`;

      if (seen.has(key)) continue;
      seen.add(key);

      // Get title from capture group
      const titleGroup = match[2] || match[1];
      const title = titleGroup.trim();

      const level = pattern.levelFn(match);

      sections.push({
        title,
        level,
        startOffset,
        endOffset: startOffset + fullMatch.length,
        text: fullMatch,
      });
    }
  }

  // Sort by position in document
  sections.sort((a, b) => a.startOffset - b.startOffset);

  // Extend endOffset to next section start
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].endOffset = sections[i + 1].startOffset;
  }

  // Last section extends to end of document
  if (sections.length > 0) {
    sections[sections.length - 1].endOffset = text.length;
  }

  return sections;
}

/**
 * Extract all metadata from an extraction result.
 */
export function extractMetadata(
  result: ExtractionResult,
  customMetadata?: Record<string, unknown>,
): DocumentMetadata {
  // Combine all page text
  const fullText = result.pages.map((p) => p.text).join('\n\n');

  return {
    title: detectTitle(fullText),
    author: detectAuthor(fullText),
    createdAt: detectDate(fullText),
    language: detectLanguage(fullText),
    detectedFormat: result.sourceMetadata.sourceFormat,
    pageCount: result.pages.length,
    wordCount: result.totalWordCount,
    extractionConfidence: result.averageConfidence,
    custom: customMetadata || {},
  };
}

/**
 * Merge metadata from multiple sources.
 * Explicit metadata takes precedence over detected.
 */
export function mergeMetadata(
  detected: DocumentMetadata,
  explicit: Partial<DocumentMetadata>,
): DocumentMetadata {
  return {
    title: explicit.title ?? detected.title,
    author: explicit.author ?? detected.author,
    createdAt: explicit.createdAt ?? detected.createdAt,
    language: explicit.language ?? detected.language,
    detectedFormat: detected.detectedFormat,
    pageCount: detected.pageCount,
    wordCount: detected.wordCount,
    extractionConfidence: detected.extractionConfidence,
    custom: { ...detected.custom, ...explicit.custom },
  };
}

/**
 * Validate metadata completeness.
 * Returns warnings for missing fields.
 */
export function validateMetadata(metadata: DocumentMetadata): string[] {
  const warnings: string[] = [];

  if (!metadata.title) {
    warnings.push('No title detected');
  }

  if (!metadata.author) {
    warnings.push('No author detected');
  }

  if (!metadata.createdAt) {
    warnings.push('No creation date detected');
  }

  if (metadata.wordCount === 0) {
    warnings.push('Document appears to be empty');
  }

  if (metadata.extractionConfidence === 'low') {
    warnings.push('Low extraction confidence - consider manual review');
  }

  return warnings;
}

/**
 * Create a metadata summary for logging.
 */
export function summarizeMetadata(metadata: DocumentMetadata): string {
  const parts = [
    metadata.title ? `"${metadata.title}"` : '[untitled]',
    metadata.author ? `by ${metadata.author}` : '',
    `${metadata.pageCount} page(s)`,
    `${metadata.wordCount} words`,
    metadata.language,
    `confidence: ${metadata.extractionConfidence}`,
  ].filter(Boolean);

  return parts.join(', ');
}
