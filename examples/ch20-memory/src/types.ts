// Core types for conversational memory management.
// See Chapter 20, "Building Production AI Systems".

/**
 * A single message in a conversation.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  tokenCount?: number;
  metadata?: MessageMetadata;
}

/**
 * Metadata attached to messages for prioritization and filtering.
 */
export interface MessageMetadata {
  importance?: 'low' | 'normal' | 'high' | 'critical';
  containsFact?: boolean;
  factType?: string;
  summary?: boolean;
  turnIndex?: number;
}

/**
 * A key fact extracted from conversation history.
 * Facts persist across compression cycles.
 */
export interface KeyFact {
  id: string;
  content: string;
  source: 'user' | 'assistant' | 'extracted';
  timestamp: number;
  category: string;
  confidence: number;
}

/**
 * Configuration for memory management.
 */
export interface MemoryConfig {
  maxTokens: number;
  reserveTokens: number; // Space reserved for new assistant response
  summaryTargetTokens: number;
  slidingWindowTurns: number;
  preserveSystemPrompt: boolean;
  factExtractionEnabled: boolean;
}

/**
 * Default configuration - conservative settings.
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxTokens: 4000,
  reserveTokens: 1000,
  summaryTargetTokens: 200,
  slidingWindowTurns: 10,
  preserveSystemPrompt: true,
  factExtractionEnabled: true,
};

/**
 * Result of a memory trim operation.
 */
export interface TrimResult {
  messages: Message[];
  totalTokens: number;
  droppedTurns: number;
  summarized: boolean;
  preservedFacts: KeyFact[];
}

/**
 * Statistics about memory state.
 */
export interface MemoryStats {
  totalMessages: number;
  totalTokens: number;
  systemTokens: number;
  userTokens: number;
  assistantTokens: number;
  summaryTokens: number;
  factCount: number;
  oldestMessageAge: number;
  compressionRatio: number;
}

/**
 * Eviction strategy for buffer management.
 */
export type EvictionStrategy =
  | 'fifo' // First in, first out
  | 'importance' // Evict lowest importance first
  | 'hybrid'; // FIFO within importance tiers

/**
 * Buffer configuration.
 */
export interface BufferConfig {
  maxTokens: number;
  evictionStrategy: EvictionStrategy;
  minRetainedTurns: number;
}

/**
 * A conversation turn (user message + assistant response).
 */
export interface Turn {
  index: number;
  user: Message;
  assistant: Message | null;
  totalTokens: number;
  importance: 'low' | 'normal' | 'high' | 'critical';
}
