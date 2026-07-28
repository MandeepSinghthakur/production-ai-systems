// Sliding window memory management.
// Keeps the last N turns and drops the oldest when the window is full.
// Simple, predictable, but loses context from early in the conversation.
//
// See Chapter 20, "Building Production AI Systems".

import type { Message, Turn, TrimResult, KeyFact } from './types.ts';
import { countMessageTokens, countTurnTokens } from './tokenizer.ts';

/**
 * Configuration for sliding window.
 */
export interface SlidingWindowConfig {
  maxTurns: number;
  maxTokens: number;
  preserveSystemPrompt: boolean;
}

/**
 * Sliding window memory manager.
 * Maintains a fixed-size window of recent conversation turns.
 */
export class SlidingWindow {
  private config: SlidingWindowConfig;
  private systemPrompt: Message | null;
  private turns: Turn[];
  private turnCounter: number;

  constructor(config: SlidingWindowConfig) {
    this.config = config;
    this.systemPrompt = null;
    this.turns = [];
    this.turnCounter = 0;
  }

  /**
   * Set the system prompt (preserved across trims if configured).
   */
  setSystemPrompt(content: string): void {
    this.systemPrompt = {
      role: 'system',
      content,
      timestamp: Date.now(),
      tokenCount: countMessageTokens({
        role: 'system',
        content,
        timestamp: Date.now(),
      }),
    };
  }

  /**
   * Add a user message, creating a new turn.
   */
  addUserMessage(content: string, importance?: Turn['importance']): Turn {
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
      importance: importance ?? 'normal',
    };

    this.turns.push(turn);
    this.enforceWindow();

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
      throw new Error('Turn already has an assistant message');
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
   * Enforce the sliding window constraints.
   * Removes oldest turns until within limits.
   */
  private enforceWindow(): void {
    // Enforce turn limit
    while (this.turns.length > this.config.maxTurns) {
      this.turns.shift();
    }

    // Enforce token limit
    let totalTokens = this.getTotalTokens();
    while (totalTokens > this.config.maxTokens && this.turns.length > 1) {
      this.turns.shift();
      totalTokens = this.getTotalTokens();
    }
  }

  /**
   * Get total tokens in current window.
   */
  getTotalTokens(): number {
    let total = 0;

    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      total += this.systemPrompt.tokenCount ?? 0;
    }

    for (const turn of this.turns) {
      total += turn.totalTokens;
    }

    return total;
  }

  /**
   * Get messages for API call.
   */
  getMessages(): Message[] {
    const messages: Message[] = [];

    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      messages.push(this.systemPrompt);
    }

    for (const turn of this.turns) {
      messages.push(turn.user);
      if (turn.assistant) {
        messages.push(turn.assistant);
      }
    }

    return messages;
  }

  /**
   * Trim to fit within a token budget.
   * Returns the trimmed result with statistics.
   */
  trimToFit(tokenBudget: number): TrimResult {
    const startTurns = this.turns.length;
    let droppedTurns = 0;

    // Reserve space for system prompt
    let availableBudget = tokenBudget;
    if (this.systemPrompt && this.config.preserveSystemPrompt) {
      availableBudget -= this.systemPrompt.tokenCount ?? 0;
    }

    // Drop oldest turns until within budget
    while (this.turns.length > 0) {
      const currentTokens = this.turns.reduce(
        (sum, t) => sum + t.totalTokens,
        0
      );

      if (currentTokens <= availableBudget) {
        break;
      }

      this.turns.shift();
      droppedTurns++;
    }

    return {
      messages: this.getMessages(),
      totalTokens: this.getTotalTokens(),
      droppedTurns,
      summarized: false,
      preservedFacts: [],
    };
  }

  /**
   * Get current turn count.
   */
  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Get turns for inspection.
   */
  getTurns(): Turn[] {
    return [...this.turns];
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.turns = [];
    this.turnCounter = 0;
  }

  /**
   * Get the oldest turn in the window.
   */
  getOldestTurn(): Turn | null {
    return this.turns.length > 0 ? this.turns[0] : null;
  }

  /**
   * Get the most recent turn.
   */
  getLatestTurn(): Turn | null {
    return this.turns.length > 0 ? this.turns[this.turns.length - 1] : null;
  }
}

/**
 * Create a sliding window with default configuration.
 */
export function createSlidingWindow(
  maxTurns: number = 10,
  maxTokens: number = 4000
): SlidingWindow {
  return new SlidingWindow({
    maxTurns,
    maxTokens,
    preserveSystemPrompt: true,
  });
}
