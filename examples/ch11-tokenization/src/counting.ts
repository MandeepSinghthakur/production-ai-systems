// Token counting strategies for production systems.
//
// The core problem: exact token counting requires running the tokenizer,
// which is expensive at high throughput. Estimation allows admission
// control and capacity planning without the full cost.
//
// The key insight: different estimation methods trade accuracy for speed.
// Word-based estimation is fast but has 15-25% error. Character-based
// is slightly better. Hybrid methods with sampling can get within 5%.

import { ProductionTokenizer } from './tokenizer.ts';
import type { TokenEstimate } from './types.ts';

// Empirical ratios for English text. These vary by language and domain.
// Code has higher tokens-per-word; CJK has ~1.5 tokens per character.
const ENGLISH_TOKENS_PER_WORD = 1.3;
const ENGLISH_CHARS_PER_TOKEN = 4.0;
const CODE_CHARS_PER_TOKEN = 3.2;

/**
 * Token counting with multiple strategies.
 */
export class TokenCounter {
  private tokenizer: ProductionTokenizer;
  private sampleSize: number;

  constructor(sampleSize: number = 500) {
    this.tokenizer = new ProductionTokenizer();
    this.sampleSize = sampleSize;
  }

  /**
   * Exact token count using the tokenizer.
   * Accurate but expensive for large texts.
   */
  countExact(text: string): TokenEstimate {
    const count = this.tokenizer.countTokens(text);
    return {
      estimate: count,
      lowerBound: count,
      upperBound: count,
      method: 'exact',
    };
  }

  /**
   * Estimate tokens from word count.
   * Fast but ~20% error on average.
   */
  estimateFromWords(text: string): TokenEstimate {
    // Split on whitespace, filter empty strings
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;

    const estimate = Math.ceil(wordCount * ENGLISH_TOKENS_PER_WORD);

    // Error bounds based on empirical measurements
    const lowerBound = Math.floor(wordCount * 1.0);
    const upperBound = Math.ceil(wordCount * 1.8);

    return {
      estimate,
      lowerBound,
      upperBound,
      method: 'word-ratio',
    };
  }

  /**
   * Estimate tokens from character count.
   * Slightly more accurate than word-based for mixed content.
   */
  estimateFromChars(text: string, isCode: boolean = false): TokenEstimate {
    const charCount = text.length;
    const ratio = isCode ? CODE_CHARS_PER_TOKEN : ENGLISH_CHARS_PER_TOKEN;

    const estimate = Math.ceil(charCount / ratio);

    // Tighter bounds than word-based
    const lowerBound = Math.floor(charCount / (ratio * 1.3));
    const upperBound = Math.ceil(charCount / (ratio * 0.7));

    return {
      estimate,
      lowerBound,
      upperBound,
      method: 'char-ratio',
    };
  }

  /**
   * Hybrid estimation: sample a portion and extrapolate.
   * Best accuracy-speed tradeoff for long texts.
   */
  estimateHybrid(text: string): TokenEstimate {
    const charCount = text.length;

    // For short texts, just count exactly
    if (charCount <= this.sampleSize * 2) {
      return this.countExact(text);
    }

    // Sample from beginning, middle, and end
    const sampleChars = Math.floor(this.sampleSize / 3);

    const beginSample = text.slice(0, sampleChars);
    const middleStart = Math.floor((charCount - sampleChars) / 2);
    const middleSample = text.slice(middleStart, middleStart + sampleChars);
    const endSample = text.slice(-sampleChars);

    const combinedSample = beginSample + middleSample + endSample;
    const sampleTokens = this.tokenizer.countTokens(combinedSample);

    // Calculate tokens per character from sample
    const tokensPerChar = sampleTokens / combinedSample.length;
    const estimate = Math.ceil(charCount * tokensPerChar);

    // Error bounds based on sampling variance (typically 3-8%)
    const errorMargin = 0.08;
    const lowerBound = Math.floor(estimate * (1 - errorMargin));
    const upperBound = Math.ceil(estimate * (1 + errorMargin));

    return {
      estimate,
      lowerBound,
      upperBound,
      method: 'hybrid',
    };
  }

  /**
   * Choose the best estimation method based on text length.
   */
  estimateBest(text: string, preferSpeed: boolean = false): TokenEstimate {
    const charCount = text.length;

    // Very short: always exact
    if (charCount < 100) {
      return this.countExact(text);
    }

    // Short: exact unless speed preferred
    if (charCount < 500) {
      return preferSpeed ? this.estimateFromChars(text) : this.countExact(text);
    }

    // Medium: hybrid unless speed preferred
    if (charCount < 5000) {
      return preferSpeed ? this.estimateFromChars(text) : this.estimateHybrid(text);
    }

    // Long: hybrid (exact is too expensive)
    return this.estimateHybrid(text);
  }
}

/**
 * Compare estimation accuracy across methods.
 */
export function compareEstimationMethods(
  texts: string[]
): {
  method: string;
  avgError: number;
  maxError: number;
  avgTime: number;
}[] {
  const counter = new TokenCounter();
  const results: Map<string, { errors: number[]; times: number[] }> = new Map();

  results.set('word-ratio', { errors: [], times: [] });
  results.set('char-ratio', { errors: [], times: [] });
  results.set('hybrid', { errors: [], times: [] });
  results.set('exact', { errors: [], times: [] });

  for (const text of texts) {
    // Get ground truth (exact count)
    const exactStart = performance.now();
    const exact = counter.countExact(text);
    const exactTime = performance.now() - exactStart;
    const exactEntry = results.get('exact');
    if (exactEntry) {
      exactEntry.errors.push(0);
      exactEntry.times.push(exactTime);
    }

    // Word-ratio
    const wordStart = performance.now();
    const wordEst = counter.estimateFromWords(text);
    const wordTime = performance.now() - wordStart;
    const wordError = Math.abs(wordEst.estimate - exact.estimate) / exact.estimate;
    const wordEntry = results.get('word-ratio');
    if (wordEntry) {
      wordEntry.errors.push(wordError);
      wordEntry.times.push(wordTime);
    }

    // Char-ratio
    const charStart = performance.now();
    const charEst = counter.estimateFromChars(text);
    const charTime = performance.now() - charStart;
    const charError = Math.abs(charEst.estimate - exact.estimate) / exact.estimate;
    const charEntry = results.get('char-ratio');
    if (charEntry) {
      charEntry.errors.push(charError);
      charEntry.times.push(charTime);
    }

    // Hybrid
    const hybridStart = performance.now();
    const hybridEst = counter.estimateHybrid(text);
    const hybridTime = performance.now() - hybridStart;
    const hybridError =
      Math.abs(hybridEst.estimate - exact.estimate) / exact.estimate;
    const hybridEntry = results.get('hybrid');
    if (hybridEntry) {
      hybridEntry.errors.push(hybridError);
      hybridEntry.times.push(hybridTime);
    }
  }

  return Array.from(results.entries()).map(([method, data]) => ({
    method,
    avgError: data.errors.reduce((a, b) => a + b, 0) / data.errors.length,
    maxError: Math.max(...data.errors),
    avgTime: data.times.reduce((a, b) => a + b, 0) / data.times.length,
  }));
}

/**
 * Calculate reserved token budget for different message types.
 */
export function calculateTokenBudget(
  contextLimit: number,
  options: {
    systemPromptTokens?: number;
    reserveForOutput?: number;
    reserveForSafety?: number;
  } = {}
): {
  systemPrompt: number;
  conversationHistory: number;
  currentMessage: number;
  reservedForOutput: number;
  safetyBuffer: number;
  total: number;
} {
  const systemPrompt = options.systemPromptTokens ?? 0;
  const reservedForOutput = options.reserveForOutput ?? Math.floor(contextLimit * 0.25);
  const safetyBuffer = options.reserveForSafety ?? 50;

  const available = contextLimit - systemPrompt - reservedForOutput - safetyBuffer;

  // Split available between history and current message
  // Give more to current message as it's typically more important
  const currentMessage = Math.floor(available * 0.4);
  const conversationHistory = available - currentMessage;

  return {
    systemPrompt,
    conversationHistory,
    currentMessage,
    reservedForOutput,
    safetyBuffer,
    total: contextLimit,
  };
}
