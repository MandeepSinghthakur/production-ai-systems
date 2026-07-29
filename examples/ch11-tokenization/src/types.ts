// Core types for tokenization and context window management.
// See Chapter 11, "Building Production AI Systems".

/**
 * A single token produced by a tokenizer.
 */
export interface Token {
  id: number;
  text: string;
  byteStart: number;
  byteEnd: number;
}

/**
 * Result of tokenization.
 */
export interface TokenizeResult {
  tokens: Token[];
  tokenCount: number;
  byteLength: number;
  truncated: boolean;
}

/**
 * Token count estimate with confidence bounds.
 */
export interface TokenEstimate {
  estimate: number;
  lowerBound: number;
  upperBound: number;
  method: 'exact' | 'word-ratio' | 'char-ratio' | 'hybrid';
}

/**
 * Configuration for context window management.
 */
export interface ContextConfig {
  maxTokens: number;
  reservedForOutput: number;
  reservedForSystem: number;
}

/**
 * A message in a conversation for context management.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  tokens?: number;
  priority?: number;
}

/**
 * Result of context window fitting.
 */
export interface ContextFitResult {
  messages: Message[];
  totalTokens: number;
  availableForOutput: number;
  droppedCount: number;
  droppedTokens: number;
}

/**
 * Truncation strategy options.
 */
export type TruncationStrategy =
  | 'head'      // Keep beginning, truncate end
  | 'tail'      // Keep end, truncate beginning
  | 'middle'    // Keep beginning and end, truncate middle
  | 'sentence'; // Truncate at sentence boundaries

/**
 * Result of truncation operation.
 */
export interface TruncationResult {
  text: string;
  originalTokens: number;
  truncatedTokens: number;
  strategy: TruncationStrategy;
  truncated: boolean;
}

/**
 * Token budget allocation for a request.
 */
export interface TokenBudget {
  systemPrompt: number;
  conversationHistory: number;
  currentMessage: number;
  reservedForOutput: number;
  total: number;
}

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Context window sizes by model tier (in tokens).
 * These are representative values, not vendor-specific.
 */
export interface ModelContextLimits {
  tier: ModelTier;
  contextWindow: number;
  maxOutputTokens: number;
}

/**
 * Token economics for cost calculation.
 */
export interface TokenPricing {
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k: number;
}
