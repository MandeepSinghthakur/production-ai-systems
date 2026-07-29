// Context window management for production systems.
//
// The core problem: conversations grow without bound, but context windows
// have hard limits. You must decide what to keep and what to drop.
//
// The key insight: not all messages are equal. System prompts are
// mandatory. Recent messages matter more than old ones. Some messages
// carry critical context that cannot be dropped without losing coherence.

import { ProductionTokenizer } from './tokenizer.ts';
import type { Message, ContextFitResult, ContextConfig } from './types.ts';

const DEFAULT_CONFIG: ContextConfig = {
  maxTokens: 8192,
  reservedForOutput: 2048,
  reservedForSystem: 500,
};

/**
 * Context window manager that fits messages within token limits.
 */
export class ContextWindowManager {
  private tokenizer: ProductionTokenizer;
  private config: ContextConfig;

  constructor(config: Partial<ContextConfig> = {}) {
    this.tokenizer = new ProductionTokenizer();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fit messages within the context window.
   * Priority: system > recent user/assistant > older messages.
   */
  fitMessages(messages: Message[]): ContextFitResult {
    const availableForMessages =
      this.config.maxTokens -
      this.config.reservedForOutput -
      this.config.reservedForSystem;

    // First pass: count tokens for each message
    const messagesWithTokens = messages.map((m) => ({
      ...m,
      tokens: m.tokens ?? this.tokenizer.countTokens(m.content),
    }));

    // Separate system messages (always included) from conversation
    const systemMessages = messagesWithTokens.filter((m) => m.role === 'system');
    const conversationMessages = messagesWithTokens.filter(
      (m) => m.role !== 'system'
    );

    // System messages use reserved space
    const systemTokens = systemMessages.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
    if (systemTokens > this.config.reservedForSystem) {
      console.warn(
        `System messages (${systemTokens} tokens) exceed reserved space ` +
          `(${this.config.reservedForSystem} tokens)`
      );
    }

    // Available for conversation after system messages
    const conversationBudget = availableForMessages - systemTokens;

    // Fit conversation messages, prioritizing recent ones
    const { fitted, dropped } = this.fitConversation(
      conversationMessages,
      conversationBudget
    );

    const result: Message[] = [...systemMessages, ...fitted];
    const totalTokens = result.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
    const droppedTokens = dropped.reduce((sum, m) => sum + (m.tokens ?? 0), 0);

    return {
      messages: result,
      totalTokens,
      availableForOutput: this.config.maxTokens - totalTokens,
      droppedCount: dropped.length,
      droppedTokens,
    };
  }

  /**
   * Fit conversation messages within budget, keeping recent ones.
   */
  private fitConversation(
    messages: Message[],
    budget: number
  ): { fitted: Message[]; dropped: Message[] } {
    // Work backwards from most recent
    const reversed = [...messages].reverse();
    const fitted: Message[] = [];
    const dropped: Message[] = [];
    let usedTokens = 0;

    for (const message of reversed) {
      const tokens = message.tokens ?? 0;

      // Check if priority message (must include if possible)
      const hasPriority = message.priority !== undefined && message.priority > 0;

      if (usedTokens + tokens <= budget) {
        fitted.unshift(message); // Add to front to restore order
        usedTokens += tokens;
      } else if (hasPriority && usedTokens + tokens <= budget * 1.1) {
        // Allow slight overflow for priority messages
        fitted.unshift(message);
        usedTokens += tokens;
      } else {
        dropped.unshift(message);
      }
    }

    return { fitted, dropped };
  }

  /**
   * Get the maximum input tokens available.
   */
  getAvailableInputTokens(): number {
    return this.config.maxTokens - this.config.reservedForOutput;
  }

  /**
   * Check if a message fits in available space.
   */
  willFit(currentTokens: number, newMessageTokens: number): boolean {
    const available = this.getAvailableInputTokens();
    return currentTokens + newMessageTokens <= available;
  }

  /**
   * Calculate how many tokens are available for a response.
   */
  getOutputBudget(inputTokens: number): number {
    const maxOutput = this.config.reservedForOutput;
    const actualAvailable = this.config.maxTokens - inputTokens;
    return Math.min(maxOutput, actualAvailable);
  }
}

/**
 * Sliding window context manager for long conversations.
 * Keeps N most recent turns plus system context.
 */
export class SlidingWindowManager {
  private tokenizer: ProductionTokenizer;
  private maxTurns: number;
  private maxTokens: number;

  constructor(maxTurns: number = 10, maxTokens: number = 4096) {
    this.tokenizer = new ProductionTokenizer();
    this.maxTurns = maxTurns;
    this.maxTokens = maxTokens;
  }

  /**
   * Apply sliding window to conversation.
   * A "turn" is a user message plus its assistant response.
   */
  applyWindow(messages: Message[]): Message[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Group messages into turns (user followed by assistant)
    // Work backwards to keep the most recent turns
    const turns: Message[][] = [];
    let currentTurn: Message[] = [];

    // Work forwards to group turns correctly
    for (const message of conversationMessages) {
      if (message.role === 'user') {
        // User message starts a new turn
        if (currentTurn.length > 0) {
          turns.push(currentTurn);
        }
        currentTurn = [message];
      } else {
        // Assistant message belongs to current turn
        currentTurn.push(message);
      }
    }
    // Don't forget the last turn
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    // Keep only the last N turns
    const keptTurns = turns.slice(-this.maxTurns);
    let lastTurnMessages = keptTurns.flat();

    // Check token limit
    let totalTokens = 0;
    for (const m of lastTurnMessages) {
      totalTokens += m.tokens ?? this.tokenizer.countTokens(m.content);
    }

    // If still over limit, remove oldest turns
    while (totalTokens > this.maxTokens && keptTurns.length > 1) {
      const removedTurn = keptTurns.shift();
      if (removedTurn) {
        for (const m of removedTurn) {
          totalTokens -= m.tokens ?? this.tokenizer.countTokens(m.content);
        }
      }
      lastTurnMessages = keptTurns.flat();
    }

    return [...systemMessages, ...lastTurnMessages];
  }

  /**
   * Get the number of messages in the window.
   */
  getWindowSize(): number {
    return this.maxTurns * 2; // user + assistant per turn
  }
}

/**
 * Summary-based context manager.
 * Summarizes old messages to compress context while preserving information.
 */
export class SummaryContextManager {
  private tokenizer: ProductionTokenizer;
  private summaryThreshold: number;
  private summaryTargetRatio: number;

  constructor(summaryThreshold: number = 2000, summaryTargetRatio: number = 0.2) {
    this.tokenizer = new ProductionTokenizer();
    this.summaryThreshold = summaryThreshold;
    this.summaryTargetRatio = summaryTargetRatio;
  }

  /**
   * Prepare context, summarizing old messages if needed.
   * Returns messages with a summary message replacing old conversation.
   */
  prepareContext(
    messages: Message[],
    summarize: (text: string, targetTokens: number) => string
  ): Message[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Count total conversation tokens
    let totalTokens = 0;
    for (const m of conversationMessages) {
      totalTokens += m.tokens ?? this.tokenizer.countTokens(m.content);
    }

    // If under threshold, return as-is
    if (totalTokens <= this.summaryThreshold) {
      return messages;
    }

    // Split into old (to summarize) and recent (to keep)
    const recentCount = Math.floor(conversationMessages.length * 0.3);
    const oldMessages = conversationMessages.slice(0, -recentCount);
    const recentMessages = conversationMessages.slice(-recentCount);

    // Create summary of old messages
    const oldText = oldMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    const oldTokens = this.tokenizer.countTokens(oldText);
    const targetSummaryTokens = Math.floor(oldTokens * this.summaryTargetRatio);

    const summaryText = summarize(oldText, targetSummaryTokens);
    const summaryMessage: Message = {
      role: 'system',
      content: `[Summary of earlier conversation]\n${summaryText}`,
      tokens: this.tokenizer.countTokens(summaryText),
    };

    return [...systemMessages, summaryMessage, ...recentMessages];
  }
}

/**
 * Priority-based context manager.
 * Keeps messages based on explicit priority scores.
 */
export class PriorityContextManager {
  private tokenizer: ProductionTokenizer;
  private maxTokens: number;

  constructor(maxTokens: number = 4096) {
    this.tokenizer = new ProductionTokenizer();
    this.maxTokens = maxTokens;
  }

  /**
   * Select messages by priority until budget exhausted.
   */
  selectByPriority(messages: Message[]): Message[] {
    // Add token counts and track original index
    const withTokens = messages.map((m, idx) => ({
      ...m,
      tokens: m.tokens ?? this.tokenizer.countTokens(m.content),
      originalIndex: idx,
    }));

    // Sort by priority (high to low), keeping system first
    const sorted = [...withTokens].sort((a, b) => {
      // System messages always first
      if (a.role === 'system' && b.role !== 'system') return -1;
      if (b.role === 'system' && a.role !== 'system') return 1;

      // Then by priority
      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      return bPriority - aPriority;
    });

    // Select until budget exhausted
    const selectedIndices = new Set<number>();
    let usedTokens = 0;

    for (const message of sorted) {
      if (usedTokens + (message.tokens ?? 0) <= this.maxTokens) {
        selectedIndices.add(message.originalIndex);
        usedTokens += message.tokens ?? 0;
      }
    }

    // Return messages in original order
    return messages.filter((_, i) => selectedIndices.has(i));
  }
}
