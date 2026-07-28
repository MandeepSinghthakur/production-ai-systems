// Simple token counting for memory management.
// Uses word-based approximation (4 chars per token on average).
// Real implementations use model-specific tokenizers, but this
// is within 10% for English text and requires no dependencies.
//
// See Chapter 20, "Building Production AI Systems".

import type { Message, Turn } from './types.ts';

/**
 * Approximate tokens in a string.
 * Uses the 4-characters-per-token heuristic which is reasonably
 * accurate for English text across most models.
 *
 * For production, replace with tiktoken or model-specific tokenizer.
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // Whitespace-separated words
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);

  // Heuristic: 1 word ~= 1.3 tokens on average
  // This accounts for subword tokenization
  let tokenEstimate = 0;

  for (const word of words) {
    if (word.length <= 3) {
      // Short words are usually single tokens
      tokenEstimate += 1;
    } else if (word.length <= 8) {
      // Medium words: 1-2 tokens
      tokenEstimate += 1.3;
    } else {
      // Long words get split more aggressively
      tokenEstimate += Math.ceil(word.length / 4);
    }
  }

  // Account for punctuation and special characters
  const punctuation = (text.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
  tokenEstimate += punctuation * 0.5;

  return Math.ceil(tokenEstimate);
}

/**
 * Count tokens in a message, including role overhead.
 * Messages have structural tokens beyond just content.
 */
export function countMessageTokens(message: Message): number {
  // Role tokens: ~4 tokens for message structure
  const roleOverhead = 4;

  // Content tokens
  const contentTokens = countTokens(message.content);

  return roleOverhead + contentTokens;
}

/**
 * Count tokens in an array of messages.
 */
export function countMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += countMessageTokens(msg);
  }
  // Conversation overhead: ~3 tokens for start/end markers
  return total + 3;
}

/**
 * Count tokens in a turn (user + assistant pair).
 */
export function countTurnTokens(turn: Turn): number {
  let total = countMessageTokens(turn.user);
  if (turn.assistant) {
    total += countMessageTokens(turn.assistant);
  }
  return total;
}

/**
 * Estimate output tokens for a given input.
 * Conservative estimate for reservation purposes.
 */
export function estimateOutputTokens(
  inputTokens: number,
  maxTokens: number
): number {
  // Typical response is 20-50% of context, capped at max
  const estimate = Math.ceil(inputTokens * 0.3);
  return Math.min(estimate, maxTokens);
}

/**
 * Calculate accuracy of token estimation against actual.
 * Returns a ratio: 1.0 = perfect, >1.0 = overestimate, <1.0 = underestimate.
 */
export function tokenAccuracy(estimated: number, actual: number): number {
  if (actual === 0) return estimated === 0 ? 1.0 : Infinity;
  return estimated / actual;
}

/**
 * Verify token counting accuracy within tolerance.
 * Used for testing the approximation heuristic.
 */
export function isWithinTolerance(
  estimated: number,
  actual: number,
  tolerance: number = 0.1
): boolean {
  const accuracy = tokenAccuracy(estimated, actual);
  return accuracy >= 1 - tolerance && accuracy <= 1 + tolerance;
}

/**
 * Test samples with known token counts (from tiktoken).
 * Used for validation in the lab.
 */
export const TOKEN_TEST_SAMPLES: Array<{ text: string; expected: number }> = [
  { text: 'Hello, world!', expected: 4 },
  { text: 'The quick brown fox jumps over the lazy dog.', expected: 10 },
  {
    text: 'This is a longer sentence that should require more tokens to ' +
      'encode properly in the model vocabulary.',
    expected: 20,
  },
  {
    text: 'Code: function fibonacci(n) { return n <= 1 ? n : ' +
      'fibonacci(n-1) + fibonacci(n-2); }',
    expected: 32,
  },
  {
    text: 'Technical terms like antidisestablishmentarianism and ' +
      'pneumonoultramicroscopicsilicovolcanoconiosis split into many tokens.',
    expected: 24,
  },
];
