// Simple BPE-style tokenizer simulation.
//
// This models the behavior of production tokenizers without requiring
// external dependencies. Real tokenizers use trained BPE vocabularies;
// this uses a simplified rule-based approach that produces similar
// token counts for English text.
//
// The key insight: tokens are NOT words. A word like "tokenization"
// might become ["token", "ization"] or ["tok", "en", "ization"]
// depending on the vocabulary. Whitespace and punctuation are tokens.

import type { Token, TokenizeResult } from './types.ts';

// Simplified vocabulary that mimics BPE behavior.
// Real BPE has 50k-100k entries learned from training data.
const COMMON_SUBWORDS = new Set([
  'the', 'and', 'ing', 'ion', 'tion', 'ation', 'ment', 'ness',
  'able', 'ible', 'ful', 'less', 'ous', 'ive', 'ly', 'er', 'est',
  'un', 're', 'pre', 'dis', 'mis', 'over', 'under', 'out', 'sub',
  'ed', 'es', 's', 'al', 'en', 'an', 'or', 'ar', 'is', 'it',
]);

// Characters that typically become their own token
const PUNCTUATION = /[.,!?;:'"()\[\]{}<>\/\\@#$%^&*+=\-_|`~]/;
const WHITESPACE = /\s/;
const DIGIT = /\d/;

export class SimpleTokenizer {
  private nextId: number;
  private vocab: Map<string, number>;
  private reverseVocab: Map<number, string>;

  constructor() {
    this.nextId = 0;
    this.vocab = new Map();
    this.reverseVocab = new Map();
  }

  /**
   * Tokenize text into tokens.
   * Models BPE behavior: splits on whitespace, then applies subword
   * tokenization to each word.
   */
  tokenize(text: string, maxTokens?: number): TokenizeResult {
    const tokens: Token[] = [];
    let pos = 0;

    while (pos < text.length) {
      // Check token limit
      if (maxTokens !== undefined && tokens.length >= maxTokens) {
        return {
          tokens,
          tokenCount: tokens.length,
          byteLength: Buffer.byteLength(text, 'utf8'),
          truncated: true,
        };
      }

      const char = text[pos];

      // Whitespace is typically its own token
      if (WHITESPACE.test(char)) {
        const start = pos;
        while (pos < text.length && WHITESPACE.test(text[pos])) {
          pos++;
        }
        tokens.push(this.makeToken(text.slice(start, pos), start, pos));
        continue;
      }

      // Punctuation is typically its own token
      if (PUNCTUATION.test(char)) {
        tokens.push(this.makeToken(char, pos, pos + 1));
        pos++;
        continue;
      }

      // Numbers often tokenize as sequences of 1-3 digits
      if (DIGIT.test(char)) {
        const start = pos;
        while (pos < text.length && DIGIT.test(text[pos])) {
          pos++;
        }
        const numStr = text.slice(start, pos);
        // Split long numbers into chunks (models how BPE handles numbers)
        for (let i = 0; i < numStr.length; i += 3) {
          const chunk = numStr.slice(i, Math.min(i + 3, numStr.length));
          tokens.push(this.makeToken(chunk, start + i, start + i + chunk.length));
        }
        continue;
      }

      // Word: extract and apply subword tokenization
      const start = pos;
      while (
        pos < text.length &&
        !WHITESPACE.test(text[pos]) &&
        !PUNCTUATION.test(text[pos])
      ) {
        pos++;
      }

      const word = text.slice(start, pos);
      const subTokens = this.tokenizeWord(word, start);
      tokens.push(...subTokens);
    }

    return {
      tokens,
      tokenCount: tokens.length,
      byteLength: Buffer.byteLength(text, 'utf8'),
      truncated: false,
    };
  }

  /**
   * Apply subword tokenization to a single word.
   * Models BPE: tries to match longest subwords first.
   */
  private tokenizeWord(word: string, byteStart: number): Token[] {
    if (word.length === 0) return [];
    if (word.length <= 2) {
      return [this.makeToken(word, byteStart, byteStart + word.length)];
    }

    const tokens: Token[] = [];
    let remaining = word.toLowerCase();
    let offset = 0;

    while (remaining.length > 0) {
      let matched = false;

      // Try to match longest common subword
      for (let len = Math.min(remaining.length, 6); len >= 2; len--) {
        const prefix = remaining.slice(0, len);
        if (COMMON_SUBWORDS.has(prefix)) {
          const original = word.slice(offset, offset + len);
          tokens.push(
            this.makeToken(original, byteStart + offset, byteStart + offset + len)
          );
          remaining = remaining.slice(len);
          offset += len;
          matched = true;
          break;
        }
      }

      // No subword match - take 2-4 characters as a token
      if (!matched) {
        const chunkSize = Math.min(
          remaining.length,
          remaining.length <= 4 ? remaining.length : 3
        );
        const original = word.slice(offset, offset + chunkSize);
        tokens.push(
          this.makeToken(
            original,
            byteStart + offset,
            byteStart + offset + chunkSize
          )
        );
        remaining = remaining.slice(chunkSize);
        offset += chunkSize;
      }
    }

    return tokens;
  }

  /**
   * Create a token, assigning an ID from the vocabulary.
   */
  private makeToken(text: string, byteStart: number, byteEnd: number): Token {
    let id = this.vocab.get(text);
    if (id === undefined) {
      id = this.nextId++;
      this.vocab.set(text, id);
      this.reverseVocab.set(id, text);
    }
    return { id, text, byteStart, byteEnd };
  }

  /**
   * Decode tokens back to text.
   */
  decode(tokens: Token[]): string {
    return tokens.map((t) => t.text).join('');
  }

  /**
   * Get vocabulary size.
   */
  vocabSize(): number {
    return this.vocab.size;
  }
}

/**
 * Production tokenizer that wraps the simple tokenizer.
 * In real systems, this would use tiktoken, sentencepiece, or similar.
 */
export class ProductionTokenizer {
  private tokenizer: SimpleTokenizer;

  constructor() {
    this.tokenizer = new SimpleTokenizer();
  }

  /**
   * Count tokens in text without returning the full token list.
   * More efficient than tokenize() when you only need the count.
   */
  countTokens(text: string): number {
    return this.tokenizer.tokenize(text).tokenCount;
  }

  /**
   * Tokenize text with optional truncation.
   */
  tokenize(text: string, maxTokens?: number): TokenizeResult {
    return this.tokenizer.tokenize(text, maxTokens);
  }

  /**
   * Decode tokens back to text.
   */
  decode(tokens: Token[]): string {
    return this.tokenizer.decode(tokens);
  }

  /**
   * Truncate text to fit within token limit.
   */
  truncateToTokens(text: string, maxTokens: number): string {
    const result = this.tokenize(text, maxTokens);
    return this.decode(result.tokens);
  }
}
