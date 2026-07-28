// Core types for Redis caching in LLM workloads.
// See Chapter 4, "Building Production AI Systems".

/**
 * A cached prompt-response pair.
 */
export interface CacheEntry {
  key: string;
  promptHash: string;
  response: string;
  tokens: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  sizeBytes: number;
}

/**
 * Configuration for the prompt cache.
 */
export interface CacheConfig {
  maxEntries: number;
  maxMemoryBytes: number;
  ttlMs: number;
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
}

/**
 * Result of a cache operation.
 */
export interface CacheResult {
  hit: boolean;
  entry: CacheEntry | null;
  latencyMs: number;
}

/**
 * Statistics for cache performance.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentEntries: number;
  currentMemoryBytes: number;
  hitRate: number;
}

/**
 * Token budget configuration for rate limiting.
 */
export interface TokenBudgetConfig {
  tokensPerWindow: number;
  windowMs: number;
  burstMultiplier: number;
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  tokensRequested: number;
  windowResetMs: number;
  reason?: string;
}

/**
 * Hot key detection entry.
 */
export interface HotKeyEntry {
  key: string;
  count: number;
  lastSeen: number;
  firstSeen: number;
}

/**
 * Hot key detection result.
 */
export interface HotKeyReport {
  hotKeys: HotKeyEntry[];
  threshold: number;
  windowMs: number;
  totalRequests: number;
}

/**
 * Session state for conversation memory.
 */
export interface SessionState {
  sessionId: string;
  tenantId: string;
  messages: ConversationMessage[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  ttlMs: number;
}

/**
 * A single message in a conversation.
 */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokens?: number;
}

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Request to the LLM with caching metadata.
 */
export interface LLMRequest {
  tenantId: string;
  sessionId?: string;
  prompt: string;
  systemPrompt?: string;
  tier: ModelTier;
  maxTokens: number;
  temperature?: number;
}
