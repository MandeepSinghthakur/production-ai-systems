// Truncation strategies for fitting text within token limits.
//
// The core problem: when text exceeds the limit, you must cut something.
// The question is what to cut and how to signal the cut.
//
// The key insight: different content types need different strategies.
// Narrative text reads better with head truncation (keep beginning).
// Log files work better with tail truncation (keep recent).
// Documents may need middle truncation (keep intro and conclusion).

import { ProductionTokenizer } from './tokenizer.ts';
import type { TruncationResult, TruncationStrategy, Token } from './types.ts';

// Markers to indicate truncation happened
const TRUNCATION_MARKERS = {
  head: '\n\n[...truncated...]',
  tail: '[...truncated...]\n\n',
  middle: '\n\n[...middle truncated...]\n\n',
};

/**
 * Truncation engine with multiple strategies.
 */
export class TruncationEngine {
  private tokenizer: ProductionTokenizer;

  constructor() {
    this.tokenizer = new ProductionTokenizer();
  }

  /**
   * Truncate text to fit within token limit.
   */
  truncate(
    text: string,
    maxTokens: number,
    strategy: TruncationStrategy = 'head'
  ): TruncationResult {
    const originalTokens = this.tokenizer.countTokens(text);

    // No truncation needed
    if (originalTokens <= maxTokens) {
      return {
        text,
        originalTokens,
        truncatedTokens: originalTokens,
        strategy,
        truncated: false,
      };
    }

    // Reserve tokens for truncation marker
    const markerTokens = this.tokenizer.countTokens(TRUNCATION_MARKERS[strategy] || '');
    const targetTokens = maxTokens - markerTokens;

    if (targetTokens <= 0) {
      return {
        text: '',
        originalTokens,
        truncatedTokens: 0,
        strategy,
        truncated: true,
      };
    }

    let truncatedText: string;

    switch (strategy) {
      case 'head':
        truncatedText = this.truncateHead(text, targetTokens);
        break;
      case 'tail':
        truncatedText = this.truncateTail(text, targetTokens);
        break;
      case 'middle':
        truncatedText = this.truncateMiddle(text, targetTokens);
        break;
      case 'sentence':
        truncatedText = this.truncateSentence(text, targetTokens);
        break;
      default:
        truncatedText = this.truncateHead(text, targetTokens);
    }

    const truncatedTokens = this.tokenizer.countTokens(truncatedText);

    return {
      text: truncatedText,
      originalTokens,
      truncatedTokens,
      strategy,
      truncated: true,
    };
  }

  /**
   * Keep the beginning of the text, truncate the end.
   * Best for: narratives, documents, explanations.
   */
  private truncateHead(text: string, targetTokens: number): string {
    const result = this.tokenizer.tokenize(text, targetTokens);
    const truncatedText = this.tokenizer.decode(result.tokens);
    return truncatedText + TRUNCATION_MARKERS.head;
  }

  /**
   * Keep the end of the text, truncate the beginning.
   * Best for: logs, recent history, stack traces.
   */
  private truncateTail(text: string, targetTokens: number): string {
    // Tokenize full text
    const fullResult = this.tokenizer.tokenize(text);
    const allTokens = fullResult.tokens;

    // Take last N tokens
    const startIdx = Math.max(0, allTokens.length - targetTokens);
    const keptTokens = allTokens.slice(startIdx);
    const truncatedText = this.tokenizer.decode(keptTokens);

    return TRUNCATION_MARKERS.tail + truncatedText;
  }

  /**
   * Keep beginning and end, truncate the middle.
   * Best for: documents where intro and conclusion matter.
   */
  private truncateMiddle(text: string, targetTokens: number): string {
    const fullResult = this.tokenizer.tokenize(text);
    const allTokens = fullResult.tokens;

    // Split tokens: 60% beginning, 40% end
    const beginTokens = Math.floor(targetTokens * 0.6);
    const endTokens = targetTokens - beginTokens;

    const beginPart = allTokens.slice(0, beginTokens);
    const endPart = allTokens.slice(-endTokens);

    const beginText = this.tokenizer.decode(beginPart);
    const endText = this.tokenizer.decode(endPart);

    return beginText + TRUNCATION_MARKERS.middle + endText;
  }

  /**
   * Truncate at sentence boundaries for cleaner cuts.
   * Best for: prose where partial sentences are jarring.
   */
  private truncateSentence(text: string, targetTokens: number): string {
    // First, do rough token-based truncation
    const roughResult = this.tokenizer.tokenize(text, targetTokens);
    let truncatedText = this.tokenizer.decode(roughResult.tokens);

    // Find the last sentence boundary
    const sentenceEnd = /[.!?]\s+/g;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;

    while ((match = sentenceEnd.exec(truncatedText)) !== null) {
      lastMatch = match;
    }

    // If we found a sentence boundary, cut there
    if (lastMatch && lastMatch.index > truncatedText.length * 0.5) {
      truncatedText = truncatedText.slice(0, lastMatch.index + 1);
    }

    return truncatedText + TRUNCATION_MARKERS.head;
  }

  /**
   * Choose the best truncation strategy based on content type.
   */
  chooseBestStrategy(
    text: string,
    contentType: 'narrative' | 'log' | 'document' | 'code' | 'conversation'
  ): TruncationStrategy {
    switch (contentType) {
      case 'narrative':
        return 'sentence';
      case 'log':
        return 'tail';
      case 'document':
        return 'middle';
      case 'code':
        return 'head'; // Keep imports and early definitions
      case 'conversation':
        return 'tail'; // Keep recent messages
      default:
        return 'head';
    }
  }
}

/**
 * Smart truncation that preserves semantic structure.
 */
export class SmartTruncation {
  private tokenizer: ProductionTokenizer;
  private engine: TruncationEngine;

  constructor() {
    this.tokenizer = new ProductionTokenizer();
    this.engine = new TruncationEngine();
  }

  /**
   * Truncate document while preserving structure.
   * Keeps headers and key sections.
   */
  truncateDocument(text: string, maxTokens: number): TruncationResult {
    const originalTokens = this.tokenizer.countTokens(text);

    if (originalTokens <= maxTokens) {
      return {
        text,
        originalTokens,
        truncatedTokens: originalTokens,
        strategy: 'head',
        truncated: false,
      };
    }

    // Split into sections by headers
    const sections = this.splitIntoSections(text);

    // Always keep first section (usually intro/summary)
    const kept: string[] = [sections[0]];
    let usedTokens = this.tokenizer.countTokens(sections[0]);

    // Try to keep other sections
    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const sectionTokens = this.tokenizer.countTokens(section);

      if (usedTokens + sectionTokens <= maxTokens) {
        kept.push(section);
        usedTokens += sectionTokens;
      } else {
        // Truncate this section to fit remaining budget
        const remaining = maxTokens - usedTokens - 10; // Reserve for marker
        if (remaining > 50) {
          const truncated = this.engine.truncate(section, remaining, 'head');
          kept.push(truncated.text);
          usedTokens += truncated.truncatedTokens;
        }
        break;
      }
    }

    const result = kept.join('\n\n');
    return {
      text: result,
      originalTokens,
      truncatedTokens: this.tokenizer.countTokens(result),
      strategy: 'head',
      truncated: true,
    };
  }

  /**
   * Split text into sections by markdown headers.
   */
  private splitIntoSections(text: string): string[] {
    const headerPattern = /^#{1,6}\s+/m;
    const parts = text.split(headerPattern);

    // Filter empty parts
    return parts.filter((p) => p.trim().length > 0);
  }

  /**
   * Truncate code while preserving structure.
   * Keeps imports, class/function definitions, truncates bodies.
   */
  truncateCode(text: string, maxTokens: number): TruncationResult {
    const originalTokens = this.tokenizer.countTokens(text);

    if (originalTokens <= maxTokens) {
      return {
        text,
        originalTokens,
        truncatedTokens: originalTokens,
        strategy: 'head',
        truncated: false,
      };
    }

    const lines = text.split('\n');
    const kept: string[] = [];
    let usedTokens = 0;
    let inImports = true;

    for (const line of lines) {
      const lineTokens = this.tokenizer.countTokens(line + '\n');

      // Always keep import/require lines
      const isImport = /^(import|require|from|const\s+\w+\s*=\s*require)/.test(
        line.trim()
      );

      // Keep function/class definitions
      const isDefinition =
        /^(export\s+)?(function|class|const|let|var|interface|type)\s+\w+/.test(
          line.trim()
        );

      if (isImport) {
        kept.push(line);
        usedTokens += lineTokens;
      } else if (inImports && line.trim() === '') {
        // Blank line after imports
        kept.push(line);
        inImports = false;
      } else if (isDefinition) {
        if (usedTokens + lineTokens <= maxTokens) {
          kept.push(line);
          usedTokens += lineTokens;
        }
      } else if (usedTokens + lineTokens <= maxTokens) {
        kept.push(line);
        usedTokens += lineTokens;
      }
    }

    let result = kept.join('\n');
    if (usedTokens < originalTokens) {
      result += '\n\n// [...truncated...]';
    }

    return {
      text: result,
      originalTokens,
      truncatedTokens: this.tokenizer.countTokens(result),
      strategy: 'head',
      truncated: true,
    };
  }
}

/**
 * Batch truncation for multiple texts with a shared budget.
 */
export class BatchTruncation {
  private tokenizer: ProductionTokenizer;
  private engine: TruncationEngine;

  constructor() {
    this.tokenizer = new ProductionTokenizer();
    this.engine = new TruncationEngine();
  }

  /**
   * Truncate multiple texts to fit within a total budget.
   * Distributes budget proportionally to original sizes.
   */
  truncateBatch(
    texts: string[],
    totalBudget: number,
    strategy: TruncationStrategy = 'head'
  ): TruncationResult[] {
    // Count original tokens
    const originals = texts.map((t) => ({
      text: t,
      tokens: this.tokenizer.countTokens(t),
    }));

    const totalOriginal = originals.reduce((sum, o) => sum + o.tokens, 0);

    // If everything fits, no truncation needed
    if (totalOriginal <= totalBudget) {
      return originals.map((o) => ({
        text: o.text,
        originalTokens: o.tokens,
        truncatedTokens: o.tokens,
        strategy,
        truncated: false,
      }));
    }

    // Distribute budget proportionally
    const ratio = totalBudget / totalOriginal;

    return originals.map((o) => {
      const allocated = Math.floor(o.tokens * ratio);
      return this.engine.truncate(o.text, allocated, strategy);
    });
  }

  /**
   * Truncate with minimum guarantees.
   * Ensures each text gets at least minTokens.
   */
  truncateWithMinimums(
    texts: string[],
    totalBudget: number,
    minTokensPerText: number,
    strategy: TruncationStrategy = 'head'
  ): TruncationResult[] {
    const count = texts.length;
    const minTotal = count * minTokensPerText;

    if (minTotal > totalBudget) {
      // Cannot satisfy minimums, give equal shares
      const perText = Math.floor(totalBudget / count);
      return texts.map((t) => this.engine.truncate(t, perText, strategy));
    }

    // Calculate original sizes
    const originals = texts.map((t) => ({
      text: t,
      tokens: this.tokenizer.countTokens(t),
    }));

    // Texts that need less than minimum get their full size
    // Remaining budget goes to larger texts proportionally
    const results: TruncationResult[] = [];
    let usedBudget = 0;
    const needsTruncation: number[] = [];

    for (let i = 0; i < originals.length; i++) {
      if (originals[i].tokens <= minTokensPerText) {
        results[i] = {
          text: originals[i].text,
          originalTokens: originals[i].tokens,
          truncatedTokens: originals[i].tokens,
          strategy,
          truncated: false,
        };
        usedBudget += originals[i].tokens;
      } else {
        needsTruncation.push(i);
      }
    }

    // Distribute remaining budget to larger texts
    const remainingBudget = totalBudget - usedBudget;
    const largeTextsTotal = needsTruncation.reduce(
      (sum, i) => sum + originals[i].tokens,
      0
    );

    for (const i of needsTruncation) {
      const ratio = originals[i].tokens / largeTextsTotal;
      const allocated = Math.floor(remainingBudget * ratio);
      results[i] = this.engine.truncate(originals[i].text, allocated, strategy);
    }

    return results;
  }
}
