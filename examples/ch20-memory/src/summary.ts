// Conversation summarization for memory compression.
// Compresses old history into a summary while preserving key facts.
// The summarizer itself would use an LLM in production; here we
// simulate the behavior deterministically for testing.
//
// See Chapter 20, "Building Production AI Systems".

import type { Message, KeyFact, Turn } from './types.ts';
import { countTokens, countMessageTokens } from './tokenizer.ts';

/**
 * Configuration for the summarizer.
 */
export interface SummarizerConfig {
  targetTokens: number;
  preserveRecentTurns: number;
  extractFacts: boolean;
  factCategories: string[];
}

/**
 * Default summarizer configuration.
 */
export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  targetTokens: 200,
  preserveRecentTurns: 3,
  extractFacts: true,
  factCategories: ['name', 'preference', 'goal', 'constraint', 'decision'],
};

/**
 * Result of a summarization operation.
 */
export interface SummaryResult {
  summary: Message;
  extractedFacts: KeyFact[];
  originalTokens: number;
  summaryTokens: number;
  compressionRatio: number;
  droppedTurns: number;
}

/**
 * Conversation summarizer.
 * In production, this calls an LLM. Here we simulate deterministically.
 */
export class Summarizer {
  private config: SummarizerConfig;
  private factCounter: number;

  constructor(config: SummarizerConfig = DEFAULT_SUMMARIZER_CONFIG) {
    this.config = config;
    this.factCounter = 0;
  }

  /**
   * Summarize a sequence of turns into a compressed form.
   * Returns the summary message and extracted facts.
   */
  summarize(turns: Turn[]): SummaryResult {
    if (turns.length === 0) {
      return {
        summary: {
          role: 'system',
          content: '',
          timestamp: Date.now(),
          metadata: { summary: true },
        },
        extractedFacts: [],
        originalTokens: 0,
        summaryTokens: 0,
        compressionRatio: 1,
        droppedTurns: 0,
      };
    }

    // Calculate original token count
    let originalTokens = 0;
    for (const turn of turns) {
      originalTokens += turn.totalTokens;
    }

    // Extract key facts before summarizing
    const extractedFacts = this.config.extractFacts
      ? this.extractFacts(turns)
      : [];

    // Generate summary content
    const summaryContent = this.generateSummary(turns, extractedFacts);

    const summary: Message = {
      role: 'system',
      content: summaryContent,
      timestamp: Date.now(),
      metadata: { summary: true },
    };
    summary.tokenCount = countMessageTokens(summary);

    const summaryTokens = summary.tokenCount;
    const compressionRatio =
      originalTokens > 0 ? originalTokens / summaryTokens : 1;

    return {
      summary,
      extractedFacts,
      originalTokens,
      summaryTokens,
      compressionRatio,
      droppedTurns: turns.length,
    };
  }

  /**
   * Extract key facts from turns.
   * In production, this uses an LLM. Here we use pattern matching.
   */
  extractFacts(turns: Turn[]): KeyFact[] {
    const facts: KeyFact[] = [];

    for (const turn of turns) {
      // Extract from user messages
      const userFacts = this.extractFactsFromContent(
        turn.user.content,
        'user',
        turn.user.timestamp
      );
      facts.push(...userFacts);

      // Extract from assistant messages
      if (turn.assistant) {
        const assistantFacts = this.extractFactsFromContent(
          turn.assistant.content,
          'assistant',
          turn.assistant.timestamp
        );
        facts.push(...assistantFacts);
      }
    }

    return facts;
  }

  /**
   * Extract facts from content using pattern matching.
   * Production implementations use LLM extraction.
   */
  private extractFactsFromContent(
    content: string,
    source: 'user' | 'assistant',
    timestamp: number
  ): KeyFact[] {
    const facts: KeyFact[] = [];
    const lowerContent = content.toLowerCase();

    // Name patterns
    const nameMatch = content.match(
      /(?:my name is|I'm|I am|call me)\s+([A-Z][a-z]+)/i
    );
    if (nameMatch) {
      facts.push({
        id: `fact_${++this.factCounter}`,
        content: `User's name is ${nameMatch[1]}`,
        source,
        timestamp,
        category: 'name',
        confidence: 0.9,
      });
    }

    // Preference patterns
    const prefPatterns = [
      /(?:I prefer|I like|I want|I need)\s+(.{10,50})/i,
      /(?:my favorite|my preferred)\s+(.{10,50})/i,
    ];
    for (const pattern of prefPatterns) {
      const match = content.match(pattern);
      if (match) {
        facts.push({
          id: `fact_${++this.factCounter}`,
          content: match[0].trim(),
          source,
          timestamp,
          category: 'preference',
          confidence: 0.7,
        });
      }
    }

    // Goal patterns
    const goalPatterns = [
      /(?:I'm trying to|I want to|my goal is to|I need to)\s+(.{10,80})/i,
      /(?:help me|can you help)\s+(.{10,80})/i,
    ];
    for (const pattern of goalPatterns) {
      const match = content.match(pattern);
      if (match) {
        facts.push({
          id: `fact_${++this.factCounter}`,
          content: match[0].trim(),
          source,
          timestamp,
          category: 'goal',
          confidence: 0.8,
        });
      }
    }

    // Constraint patterns
    if (
      lowerContent.includes('must') ||
      lowerContent.includes('cannot') ||
      lowerContent.includes("can't") ||
      lowerContent.includes('required')
    ) {
      const constraintMatch = content.match(
        /(?:must|cannot|can't|required)[^.!?]{5,50}[.!?]/i
      );
      if (constraintMatch) {
        facts.push({
          id: `fact_${++this.factCounter}`,
          content: constraintMatch[0].trim(),
          source,
          timestamp,
          category: 'constraint',
          confidence: 0.75,
        });
      }
    }

    // Decision patterns
    if (
      lowerContent.includes('decided') ||
      lowerContent.includes('agreed') ||
      lowerContent.includes('confirmed')
    ) {
      const decisionMatch = content.match(
        /(?:decided|agreed|confirmed)[^.!?]{5,80}[.!?]/i
      );
      if (decisionMatch) {
        facts.push({
          id: `fact_${++this.factCounter}`,
          content: decisionMatch[0].trim(),
          source,
          timestamp,
          category: 'decision',
          confidence: 0.85,
        });
      }
    }

    return facts;
  }

  /**
   * Generate summary text from turns and facts.
   * Production implementations use LLM summarization.
   */
  private generateSummary(turns: Turn[], facts: KeyFact[]): string {
    const parts: string[] = [];

    // Add conversation context
    parts.push(`[Previous conversation: ${turns.length} turns]`);

    // Add extracted facts if any
    if (facts.length > 0) {
      parts.push('Key facts:');
      for (const fact of facts) {
        parts.push(`- ${fact.content}`);
      }
    }

    // Add topic summary
    const topics = this.extractTopics(turns);
    if (topics.length > 0) {
      parts.push(`Topics discussed: ${topics.join(', ')}`);
    }

    // Add last assistant response summary
    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.assistant) {
      const assistantSummary = this.truncateToLength(
        lastTurn.assistant.content,
        100
      );
      parts.push(`Last response: ${assistantSummary}`);
    }

    return parts.join('\n');
  }

  /**
   * Extract main topics from turns.
   */
  private extractTopics(turns: Turn[]): string[] {
    const topics = new Set<string>();

    // Simple keyword extraction
    const keywords = [
      'help',
      'problem',
      'question',
      'issue',
      'project',
      'task',
      'code',
      'error',
      'bug',
      'feature',
      'design',
      'data',
      'file',
      'system',
    ];

    for (const turn of turns) {
      const content = turn.user.content.toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          topics.add(keyword);
        }
      }
    }

    return Array.from(topics).slice(0, 5);
  }

  /**
   * Truncate text to approximate length.
   */
  private truncateToLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Check if a summary contains a specific fact.
   */
  containsFact(summary: string, fact: KeyFact): boolean {
    const normalizedSummary = summary.toLowerCase();
    const normalizedFact = fact.content.toLowerCase();

    // Check for direct inclusion
    if (normalizedSummary.includes(normalizedFact)) {
      return true;
    }

    // Check for key terms (simple word overlap)
    const factWords = normalizedFact.split(/\s+/).filter((w) => w.length > 3);
    const matchedWords = factWords.filter((w) =>
      normalizedSummary.includes(w)
    );

    // Consider matched if >50% of significant words present
    return matchedWords.length >= factWords.length * 0.5;
  }
}

/**
 * Create a summarizer with default configuration.
 */
export function createSummarizer(
  targetTokens: number = 200
): Summarizer {
  return new Summarizer({
    ...DEFAULT_SUMMARIZER_CONFIG,
    targetTokens,
  });
}
