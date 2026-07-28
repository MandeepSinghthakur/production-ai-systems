// Token buffer with configurable eviction strategies.
// Manages conversation history within a fixed token budget.
// Different eviction strategies trade off recency vs importance.
//
// See Chapter 20, "Building Production AI Systems".

import type {
  Message,
  Turn,
  BufferConfig,
  EvictionStrategy,
  TrimResult,
  KeyFact,
} from './types.ts';
import { countMessageTokens, countTurnTokens } from './tokenizer.ts';

/**
 * Default buffer configuration.
 */
export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxTokens: 4000,
  evictionStrategy: 'hybrid',
  minRetainedTurns: 2,
};

/**
 * Token buffer with eviction support.
 */
export class TokenBuffer {
  private config: BufferConfig;
  private systemPrompt: Message | null;
  private turns: Turn[];
  private turnCounter: number;

  constructor(config: BufferConfig = DEFAULT_BUFFER_CONFIG) {
    this.config = config;
    this.systemPrompt = null;
    this.turns = [];
    this.turnCounter = 0;
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
   * Add a turn to the buffer.
   */
  addTurn(
    userContent: string,
    assistantContent: string | null,
    importance: Turn['importance'] = 'normal'
  ): Turn {
    const userMsg: Message = {
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };
    userMsg.tokenCount = countMessageTokens(userMsg);

    let assistantMsg: Message | null = null;
    if (assistantContent !== null) {
      assistantMsg = {
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      };
      assistantMsg.tokenCount = countMessageTokens(assistantMsg);
    }

    const turn: Turn = {
      index: this.turnCounter++,
      user: userMsg,
      assistant: assistantMsg,
      totalTokens:
        userMsg.tokenCount + (assistantMsg?.tokenCount ?? 0),
      importance,
    };

    this.turns.push(turn);
    this.evictIfNeeded();

    return turn;
  }

  /**
   * Evict turns until within token budget.
   */
  private evictIfNeeded(): void {
    while (this.getTotalTokens() > this.config.maxTokens) {
      if (this.turns.length <= this.config.minRetainedTurns) {
        // Cannot evict below minimum
        break;
      }

      const evictIndex = this.selectEvictionTarget();
      if (evictIndex === -1) {
        break;
      }

      this.turns.splice(evictIndex, 1);
    }
  }

  /**
   * Select the turn to evict based on strategy.
   */
  private selectEvictionTarget(): number {
    if (this.turns.length <= this.config.minRetainedTurns) {
      return -1;
    }

    switch (this.config.evictionStrategy) {
      case 'fifo':
        return this.selectFifoTarget();

      case 'importance':
        return this.selectImportanceTarget();

      case 'hybrid':
        return this.selectHybridTarget();

      default:
        return this.selectFifoTarget();
    }
  }

  /**
   * FIFO: evict oldest turn (excluding minimum retained).
   */
  private selectFifoTarget(): number {
    // Don't evict the most recent turns
    const maxIndex = this.turns.length - this.config.minRetainedTurns;
    return maxIndex > 0 ? 0 : -1;
  }

  /**
   * Importance: evict lowest importance turn.
   */
  private selectImportanceTarget(): number {
    const importanceOrder: Turn['importance'][] = [
      'low',
      'normal',
      'high',
      'critical',
    ];

    // Don't consider recent turns for eviction
    const eligibleCount = this.turns.length - this.config.minRetainedTurns;
    if (eligibleCount <= 0) {
      return -1;
    }

    // Find lowest importance among eligible turns
    let lowestIndex = -1;
    let lowestImportance = importanceOrder.length;

    for (let i = 0; i < eligibleCount; i++) {
      const turn = this.turns[i];
      const importanceLevel = importanceOrder.indexOf(turn.importance);

      if (importanceLevel < lowestImportance) {
        lowestImportance = importanceLevel;
        lowestIndex = i;
      }
    }

    return lowestIndex;
  }

  /**
   * Hybrid: FIFO within importance tiers.
   * Evicts oldest low-importance first, then normal, etc.
   */
  private selectHybridTarget(): number {
    const importanceOrder: Turn['importance'][] = [
      'low',
      'normal',
      'high',
      'critical',
    ];

    const eligibleCount = this.turns.length - this.config.minRetainedTurns;
    if (eligibleCount <= 0) {
      return -1;
    }

    // For each importance tier (lowest first), find oldest
    for (const importance of importanceOrder) {
      for (let i = 0; i < eligibleCount; i++) {
        if (this.turns[i].importance === importance) {
          return i;
        }
      }
    }

    // Fallback to FIFO
    return 0;
  }

  /**
   * Get total tokens in buffer.
   */
  getTotalTokens(): number {
    let total = this.systemPrompt?.tokenCount ?? 0;

    for (const turn of this.turns) {
      total += turn.totalTokens;
    }

    return total;
  }

  /**
   * Get available token headroom.
   */
  getHeadroom(): number {
    return Math.max(0, this.config.maxTokens - this.getTotalTokens());
  }

  /**
   * Get messages for API call.
   */
  getMessages(): Message[] {
    const messages: Message[] = [];

    if (this.systemPrompt) {
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
   * Trim to fit a specific budget.
   */
  trimToFit(tokenBudget: number): TrimResult {
    const startTurns = this.turns.length;
    let droppedTurns = 0;

    // Reserve space for system prompt
    let available = tokenBudget;
    if (this.systemPrompt) {
      available -= this.systemPrompt.tokenCount ?? 0;
    }

    // Evict until within budget
    while (
      this.turns.length > this.config.minRetainedTurns &&
      this.getTurnTokens() > available
    ) {
      const target = this.selectEvictionTarget();
      if (target === -1) break;

      this.turns.splice(target, 1);
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
   * Get tokens from turns only (excluding system prompt).
   */
  private getTurnTokens(): number {
    let total = 0;
    for (const turn of this.turns) {
      total += turn.totalTokens;
    }
    return total;
  }

  /**
   * Get turn count.
   */
  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Get all turns.
   */
  getTurns(): Turn[] {
    return [...this.turns];
  }

  /**
   * Check if buffer is at capacity.
   */
  isAtCapacity(): boolean {
    return this.getTotalTokens() >= this.config.maxTokens;
  }

  /**
   * Get eviction statistics.
   */
  getEvictionStats(): {
    strategy: EvictionStrategy;
    turnCount: number;
    tokenCount: number;
    headroom: number;
    atCapacity: boolean;
  } {
    return {
      strategy: this.config.evictionStrategy,
      turnCount: this.turns.length,
      tokenCount: this.getTotalTokens(),
      headroom: this.getHeadroom(),
      atCapacity: this.isAtCapacity(),
    };
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.turns = [];
    this.turnCounter = 0;
  }
}

/**
 * Create a buffer with specified strategy.
 */
export function createBuffer(
  maxTokens: number,
  strategy: EvictionStrategy = 'hybrid'
): TokenBuffer {
  return new TokenBuffer({
    maxTokens,
    evictionStrategy: strategy,
    minRetainedTurns: 2,
  });
}
