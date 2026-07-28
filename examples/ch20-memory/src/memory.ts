// Combined memory manager.
// Integrates sliding window, summarization, and fact extraction
// into a unified interface for conversation memory management.
//
// See Chapter 20, "Building Production AI Systems".

import type {
  Message,
  Turn,
  KeyFact,
  MemoryConfig,
  MemoryStats,
  TrimResult,
} from './types.ts';
import { countMessageTokens, countMessagesTokens } from './tokenizer.ts';
import { SlidingWindow } from './sliding-window.ts';
import { Summarizer } from './summary.ts';
import type { SummaryResult } from './summary.ts';

/**
 * Memory manager configuration with all options.
 */
export interface MemoryManagerConfig {
  maxTokens: number;
  reserveTokens: number;
  slidingWindowTurns: number;
  summaryTargetTokens: number;
  preserveSystemPrompt: boolean;
  factExtractionEnabled: boolean;
  summaryThreshold: number; // Summarize when turns exceed this
}

/**
 * Default memory manager configuration.
 */
export const DEFAULT_MANAGER_CONFIG: MemoryManagerConfig = {
  maxTokens: 4000,
  reserveTokens: 1000,
  slidingWindowTurns: 10,
  summaryTargetTokens: 200,
  preserveSystemPrompt: true,
  factExtractionEnabled: true,
  summaryThreshold: 8,
};

/**
 * Combined memory manager.
 * Manages conversation history with automatic compression.
 */
export class MemoryManager {
  private config: MemoryManagerConfig;
  private systemPrompt: Message | null;
  private summary: Message | null;
  private turns: Turn[];
  private facts: KeyFact[];
  private turnCounter: number;
  private summarizer: Summarizer;
  private compressionCount: number;

  constructor(config: MemoryManagerConfig = DEFAULT_MANAGER_CONFIG) {
    this.config = config;
    this.systemPrompt = null;
    this.summary = null;
    this.turns = [];
    this.facts = [];
    this.turnCounter = 0;
    this.summarizer = new Summarizer({
      targetTokens: config.summaryTargetTokens,
      preserveRecentTurns: 3,
      extractFacts: config.factExtractionEnabled,
      factCategories: ['name', 'preference', 'goal', 'constraint', 'decision'],
    });
    this.compressionCount = 0;
  }

  /**
   * Set the system prompt.
   */
  setSystemPrompt(content: string): void {
    this.systemPrompt = {
      role: 'system',
      content,
      timestamp: Date.now(),
    };
    this.systemPrompt.tokenCount = countMessageTokens(this.systemPrompt);
  }

  /**
   * Add a user message.
   */
  addUserMessage(
    content: string,
    importance: Turn['importance'] = 'normal'
  ): Turn {
    const message: Message = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    message.tokenCount = countMessageTokens(message);

    const turn: Turn = {
      index: this.turnCounter++,
      user: message,
      assistant: null,
      totalTokens: message.tokenCount,
      importance,
    };

    this.turns.push(turn);
    this.maybeCompress();

    return turn;
  }

  /**
   * Add an assistant response to the current turn.
   */
  addAssistantMessage(content: string): void {
    if (this.turns.length === 0) {
      throw new Error('No turn to add assistant message to');
    }

    const currentTurn = this.turns[this.turns.length - 1];
    if (currentTurn.assistant !== null) {
      throw new Error('Turn already has assistant message');
    }

    const message: Message = {
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    message.tokenCount = countMessageTokens(message);

    currentTurn.assistant = message;
    currentTurn.totalTokens += message.tokenCount;
  }

  /**
   * Maybe compress history if needed.
   */
  private maybeCompress(): void {
    const totalTokens = this.getTotalTokens();
    const budget = this.config.maxTokens - this.config.reserveTokens;

    // Compress if over budget or too many turns
    if (
      totalTokens > budget ||
      this.turns.length > this.config.summaryThreshold
    ) {
      this.compress();
    }
  }

  /**
   * Compress old turns into a summary.
   */
  private compress(): void {
    const budget = this.config.maxTokens - this.config.reserveTokens;
    const overBudget = this.getTotalTokens() > budget;
    const overThreshold = this.turns.length > this.config.summaryThreshold;

    // Determine how many turns to keep
    let keepCount: number;
    if (overBudget) {
      // When over budget, be more aggressive - keep fewer turns
      keepCount = Math.max(2, Math.floor(this.turns.length / 2));
    } else {
      // When just over threshold, keep sliding window amount
      keepCount = Math.min(
        this.config.slidingWindowTurns,
        this.turns.length
      );
    }

    const summarizeCount = this.turns.length - keepCount;

    if (summarizeCount <= 0) {
      // Nothing to summarize, just drop oldest if over budget
      if (overBudget) {
        this.dropOldest();
      }
      return;
    }

    // Get turns to summarize
    const toSummarize = this.turns.slice(0, summarizeCount);
    const toKeep = this.turns.slice(summarizeCount);

    // Generate summary
    const result = this.summarizer.summarize(toSummarize);

    // Merge with existing summary if present
    if (this.summary) {
      const combinedContent =
        this.summary.content + '\n\n' + result.summary.content;
      this.summary = {
        role: 'system',
        content: combinedContent,
        timestamp: Date.now(),
        metadata: { summary: true },
      };
      this.summary.tokenCount = countMessageTokens(this.summary);
    } else {
      this.summary = result.summary;
    }

    // Store extracted facts
    this.facts.push(...result.extractedFacts);

    // Replace turns with kept ones
    this.turns = toKeep;
    this.compressionCount++;

    // If still over budget, drop turns until within budget
    while (this.getTotalTokens() > budget && this.turns.length > 1) {
      this.turns.shift();
    }
  }

  /**
   * Drop the oldest turn.
   */
  private dropOldest(): void {
    if (this.turns.length > 1) {
      this.turns.shift();
    }
  }

  /**
   * Get total tokens in memory.
   */
  getTotalTokens(): number {
    let total = 0;

    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      total += this.systemPrompt.tokenCount ?? 0;
    }

    if (this.summary) {
      total += this.summary.tokenCount ?? 0;
    }

    for (const turn of this.turns) {
      total += turn.totalTokens;
    }

    return total;
  }

  /**
   * Get available token headroom.
   */
  getHeadroom(): number {
    return Math.max(
      0,
      this.config.maxTokens - this.config.reserveTokens - this.getTotalTokens()
    );
  }

  /**
   * Get messages for API call.
   */
  getMessages(): Message[] {
    const messages: Message[] = [];

    // System prompt first
    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      messages.push(this.systemPrompt);
    }

    // Summary of old conversation
    if (this.summary) {
      messages.push(this.summary);
    }

    // Recent turns
    for (const turn of this.turns) {
      messages.push(turn.user);
      if (turn.assistant) {
        messages.push(turn.assistant);
      }
    }

    return messages;
  }

  /**
   * Trim to fit a specific token budget.
   */
  trimToFit(tokenBudget: number): TrimResult {
    const startTurns = this.turns.length;
    let droppedTurns = 0;

    // Calculate available after system prompt
    let available = tokenBudget;
    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      available -= this.systemPrompt.tokenCount ?? 0;
    }

    // Keep summary within budget
    if (this.summary) {
      available -= this.summary.tokenCount ?? 0;
    }

    // Drop turns until within budget
    while (this.turns.length > 1 && this.getTurnTokens() > available) {
      this.turns.shift();
      droppedTurns++;
    }

    return {
      messages: this.getMessages(),
      totalTokens: this.getTotalTokens(),
      droppedTurns,
      summarized: this.summary !== null,
      preservedFacts: [...this.facts],
    };
  }

  /**
   * Get tokens from turns only.
   */
  private getTurnTokens(): number {
    let total = 0;
    for (const turn of this.turns) {
      total += turn.totalTokens;
    }
    return total;
  }

  /**
   * Get memory statistics.
   */
  getStats(): MemoryStats {
    let systemTokens = 0;
    let userTokens = 0;
    let assistantTokens = 0;
    let summaryTokens = 0;

    if (this.systemPrompt) {
      systemTokens = this.systemPrompt.tokenCount ?? 0;
    }

    if (this.summary) {
      summaryTokens = this.summary.tokenCount ?? 0;
    }

    for (const turn of this.turns) {
      userTokens += turn.user.tokenCount ?? 0;
      if (turn.assistant) {
        assistantTokens += turn.assistant.tokenCount ?? 0;
      }
    }

    const totalTokens = systemTokens + summaryTokens + userTokens +
      assistantTokens;

    // Find oldest message age
    let oldestTimestamp = Date.now();
    if (this.turns.length > 0) {
      oldestTimestamp = this.turns[0].user.timestamp;
    }
    const oldestMessageAge = Date.now() - oldestTimestamp;

    // Compression ratio (if we've compressed)
    const compressionRatio = this.compressionCount > 0 && this.summary
      ? (summaryTokens + this.getTurnTokens()) / this.config.maxTokens
      : 1;

    return {
      totalMessages: this.getMessages().length,
      totalTokens,
      systemTokens,
      userTokens,
      assistantTokens,
      summaryTokens,
      factCount: this.facts.length,
      oldestMessageAge,
      compressionRatio,
    };
  }

  /**
   * Get all extracted facts.
   */
  getFacts(): KeyFact[] {
    return [...this.facts];
  }

  /**
   * Check if a specific fact is preserved.
   */
  hasFact(category: string, contentMatch: string): boolean {
    const lowerMatch = contentMatch.toLowerCase();
    return this.facts.some(
      (f) =>
        f.category === category &&
        f.content.toLowerCase().includes(lowerMatch)
    );
  }

  /**
   * Get turn count.
   */
  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Get compression count.
   */
  getCompressionCount(): number {
    return this.compressionCount;
  }

  /**
   * Check if memory has been compressed.
   */
  hasBeenCompressed(): boolean {
    return this.summary !== null;
  }

  /**
   * Get the summary if present.
   */
  getSummary(): Message | null {
    return this.summary;
  }

  /**
   * Clear all memory.
   */
  clear(): void {
    this.summary = null;
    this.turns = [];
    this.facts = [];
    this.turnCounter = 0;
    this.compressionCount = 0;
  }
}

/**
 * Create a memory manager with specified configuration.
 */
export function createMemoryManager(
  maxTokens: number = 4000,
  reserveTokens: number = 1000,
  slidingWindowTurns: number = 5,
  summaryThreshold: number = 4
): MemoryManager {
  return new MemoryManager({
    ...DEFAULT_MANAGER_CONFIG,
    maxTokens,
    reserveTokens,
    slidingWindowTurns,
    summaryThreshold,
  });
}
