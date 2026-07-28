// OCR simulation without external dependencies.
// Demonstrates OCR concepts: confidence, bounding boxes, noise handling.
// See Chapter 14, "Building Production AI Systems".

import type {
  BoundingBox,
  ExtractedPage,
  ExtractionConfidence,
} from './types.ts';

/**
 * Common OCR errors by character.
 * Real OCR systems confuse similar-looking characters.
 */
const OCR_CONFUSION_MAP: Record<string, string[]> = {
  '0': ['O', 'o', 'Q'],
  'O': ['0', 'Q', 'D'],
  '1': ['l', 'I', '|', 'i'],
  'l': ['1', 'I', '|'],
  'I': ['1', 'l', '|'],
  '5': ['S', 's'],
  'S': ['5', '$'],
  '8': ['B', '&'],
  'B': ['8', '3'],
  '6': ['G', 'b'],
  'g': ['9', 'q'],
  'q': ['9', 'g'],
  'rn': ['m'],
  'm': ['rn', 'nn'],
  'nn': ['m'],
  'cl': ['d'],
  'vv': ['w'],
  'w': ['vv', 'uu'],
};

/**
 * Simulate OCR noise based on quality level.
 * Lower quality = more character substitutions.
 */
export function simulateOcrNoise(
  text: string,
  quality: 'high' | 'medium' | 'low',
): string {
  // Error rates by quality
  const errorRates = { high: 0.001, medium: 0.02, low: 0.08 };
  const errorRate = errorRates[quality];

  const chars = text.split('');
  const noisy: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      noisy.push(char);
      continue;
    }

    // Check for multi-character confusions (rn -> m, etc.)
    const twoChar = chars.slice(i, i + 2).join('');
    if (OCR_CONFUSION_MAP[twoChar] && Math.random() < errorRate * 2) {
      const options = OCR_CONFUSION_MAP[twoChar];
      noisy.push(options[Math.floor(Math.random() * options.length)]);
      i++; // Skip next character
      continue;
    }

    // Single character confusion
    if (OCR_CONFUSION_MAP[char] && Math.random() < errorRate) {
      const options = OCR_CONFUSION_MAP[char];
      noisy.push(options[Math.floor(Math.random() * options.length)]);
    } else {
      noisy.push(char);
    }
  }

  return noisy.join('');
}

/**
 * Generate bounding boxes for text.
 * Simulates character-level positioning from OCR.
 */
export function generateBoundingBoxes(
  text: string,
  quality: 'high' | 'medium' | 'low',
): BoundingBox[] {
  const confidenceBase = { high: 0.95, medium: 0.80, low: 0.60 };
  const base = confidenceBase[quality];

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const boxes: BoundingBox[] = [];

  // Simulate a page layout: ~10 words per line, ~30 lines
  const wordsPerLine = 10;
  const lineHeight = 0.03;
  const charWidth = 0.008;
  const margin = 0.1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lineNum = Math.floor(i / wordsPerLine);
    const wordInLine = i % wordsPerLine;

    // Calculate position
    const x = margin + wordInLine * 0.085;
    const y = margin + lineNum * lineHeight;
    const width = word.length * charWidth;
    const height = lineHeight * 0.8;

    // Add confidence variance
    const confidenceVariance = (Math.random() - 0.5) * 0.1;
    const confidence = Math.max(0.3, Math.min(1.0, base + confidenceVariance));

    boxes.push({
      text: word,
      x: Math.min(x, 0.9),
      y: Math.min(y, 0.95),
      width: Math.min(width, 0.1),
      height,
      confidence,
    });
  }

  return boxes;
}

/**
 * Simulate OCR processing of an "image".
 * In production, this would call Tesseract, Google Vision, AWS Textract, etc.
 */
export function processOcr(
  imageContent: string,
  quality: 'high' | 'medium' | 'low' = 'medium',
): ExtractedPage {
  // Check for embedded ground truth (for testing)
  const truthMarker = '<!-- GROUND TRUTH:';
  const truthEnd = '-->';
  const truthStart = imageContent.indexOf(truthMarker);
  const truthEndIdx = imageContent.indexOf(truthEnd, truthStart);

  let groundTruth: string | null = null;
  if (truthStart !== -1 && truthEndIdx !== -1) {
    groundTruth = imageContent
      .slice(truthStart + truthMarker.length, truthEndIdx)
      .trim();
  }

  // Extract visible text (simulating what OCR would see)
  const ocrMarker = '<!-- OCR TEXT:';
  const ocrEnd = '-->';
  const ocrStart = imageContent.indexOf(ocrMarker);
  const ocrEndIdx = imageContent.indexOf(ocrEnd, ocrStart);

  let rawText: string;
  if (ocrStart !== -1 && ocrEndIdx !== -1) {
    rawText = imageContent.slice(ocrStart + ocrMarker.length, ocrEndIdx).trim();
  } else {
    // Fallback: use content as-is
    rawText = imageContent.trim();
  }

  // Apply simulated OCR noise
  const ocrText = simulateOcrNoise(rawText, quality);
  const boundingBoxes = generateBoundingBoxes(ocrText, quality);

  // Calculate word-level confidence
  const avgConfidence = boundingBoxes.length > 0
    ? boundingBoxes.reduce((sum, b) => sum + b.confidence, 0) /
      boundingBoxes.length
    : 0;

  const confidenceLevel: ExtractionConfidence =
    avgConfidence >= 0.9 ? 'high' :
    avgConfidence >= 0.7 ? 'medium' : 'low';

  const wordCount = ocrText.split(/\s+/).filter((w) => w.length > 0).length;

  return {
    pageNumber: 1,
    text: ocrText,
    confidence: confidenceLevel,
    wordCount,
    boundingBoxes,
  };
}

/**
 * Calculate character error rate (CER) between OCR output and ground truth.
 * Used for OCR quality assessment.
 */
export function calculateCer(ocrText: string, groundTruth: string): number {
  // Levenshtein distance / ground truth length
  const distance = levenshteinDistance(ocrText, groundTruth);
  return groundTruth.length > 0 ? distance / groundTruth.length : 0;
}

/**
 * Calculate word error rate (WER) between OCR output and ground truth.
 */
export function calculateWer(ocrText: string, groundTruth: string): number {
  const ocrWords = ocrText.split(/\s+/).filter((w) => w.length > 0);
  const truthWords = groundTruth.split(/\s+/).filter((w) => w.length > 0);

  const distance = levenshteinDistance(
    ocrWords.join(' '),
    truthWords.join(' ')
  );

  return truthWords.length > 0 ? distance / truthWords.length : 0;
}

/**
 * Levenshtein edit distance.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix for memory efficiency
  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);

  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }

    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * Post-process OCR output to fix common errors.
 */
export function postProcessOcr(text: string): string {
  let processed = text;

  // Fix common OCR errors
  // Spaces around punctuation
  processed = processed.replace(/\s+([.,!?;:])/g, '$1');
  processed = processed.replace(/([.,!?;:])\s{2,}/g, '$1 ');

  // Fix common word-level errors
  processed = processed.replace(/\bteh\b/gi, 'the');
  processed = processed.replace(/\brecieve\b/gi, 'receive');
  processed = processed.replace(/\bsuccessfull\b/gi, 'successful');

  // Normalize quotes
  processed = processed.replace(/[""]/g, '"');
  processed = processed.replace(/['']/g, "'");

  // Fix spacing issues
  processed = processed.replace(/\s{2,}/g, ' ');
  processed = processed.replace(/^\s+|\s+$/gm, '');

  return processed;
}

/**
 * Determine if OCR quality is sufficient for indexing.
 */
export function isOcrUsable(
  page: ExtractedPage,
  minConfidence: ExtractionConfidence = 'low',
): boolean {
  const confidenceOrder = { high: 3, medium: 2, low: 1 };
  return confidenceOrder[page.confidence] >= confidenceOrder[minConfidence];
}
