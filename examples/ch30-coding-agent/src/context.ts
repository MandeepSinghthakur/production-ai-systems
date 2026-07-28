// Codebase context management for coding agents.
// Manages which files are included in the context window.

import type { CodeContext, ContextFile } from './types.ts';

/**
 * ContextManager handles codebase context for the agent.
 *
 * Key responsibilities:
 * - Track token budget
 * - Prioritize relevant files
 * - Truncate when necessary
 * - Maintain coherent context
 */
export class ContextManager {
  private budgetTokens: number;
  private usedTokens: number;
  private files: Map<string, ContextFile>;
  private relevanceScores: Map<string, number>;

  constructor(budgetTokens: number) {
    this.budgetTokens = budgetTokens;
    this.usedTokens = 0;
    this.files = new Map();
    this.relevanceScores = new Map();
  }

  /**
   * Add a file to the context.
   * Returns whether the file was included (may be excluded if over budget).
   */
  addFile(path: string, content: string, relevanceScore: number): boolean {
    const tokenCount = this.estimateTokens(content);

    // Check if we have budget
    if (this.usedTokens + tokenCount > this.budgetTokens) {
      // Store but mark as not included
      this.files.set(path, {
        path,
        content,
        relevanceScore,
        tokenCount,
        included: false,
      });
      return false;
    }

    // Include the file
    this.files.set(path, {
      path,
      content,
      relevanceScore,
      tokenCount,
      included: true,
    });
    this.usedTokens += tokenCount;
    this.relevanceScores.set(path, relevanceScore);
    return true;
  }

  /**
   * Get the current context for the agent.
   */
  getContext(): CodeContext {
    const relevantFiles = Array.from(this.files.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const truncated = relevantFiles.some((f) => !f.included);

    return {
      relevantFiles,
      totalTokens: this.usedTokens,
      budgetTokens: this.budgetTokens,
      truncated,
    };
  }

  /**
   * Get only the included files' content.
   */
  getIncludedContent(): string {
    const included = Array.from(this.files.values())
      .filter((f) => f.included)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return included
      .map((f) => `// File: ${f.path}\n${f.content}`)
      .join('\n\n');
  }

  /**
   * Optimize context by evicting low-relevance files.
   * Returns number of files evicted.
   */
  optimizeContext(): number {
    const allFiles = Array.from(this.files.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    let evicted = 0;
    let currentTokens = 0;

    for (const file of allFiles) {
      if (currentTokens + file.tokenCount <= this.budgetTokens) {
        if (!file.included) {
          file.included = true;
        }
        currentTokens += file.tokenCount;
      } else {
        if (file.included) {
          file.included = false;
          evicted++;
        }
      }
    }

    this.usedTokens = currentTokens;
    return evicted;
  }

  /**
   * Prioritize files matching a query.
   * Boosts relevance scores for matching files.
   */
  prioritizeByQuery(query: string): void {
    const queryTerms = this.tokenize(query.toLowerCase());

    for (const [path, file] of this.files) {
      const pathTerms = this.tokenize(path.toLowerCase());
      const contentTerms = this.tokenize(file.content.toLowerCase());

      let boost = 0;

      // Path match is high value
      for (const term of queryTerms) {
        if (pathTerms.some((p) => p.includes(term))) {
          boost += 0.3;
        }
        if (contentTerms.some((c) => c.includes(term))) {
          boost += 0.1;
        }
      }

      // Update relevance score
      const newScore = Math.min(1.0, file.relevanceScore + boost);
      file.relevanceScore = newScore;
      this.relevanceScores.set(path, newScore);
    }

    // Re-optimize after changing scores
    this.optimizeContext();
  }

  /**
   * Get token budget status.
   */
  getBudgetStatus(): {
    used: number;
    budget: number;
    remaining: number;
    percentUsed: number;
  } {
    return {
      used: this.usedTokens,
      budget: this.budgetTokens,
      remaining: this.budgetTokens - this.usedTokens,
      percentUsed: (this.usedTokens / this.budgetTokens) * 100,
    };
  }

  /**
   * Check if a file is included in context.
   */
  isFileIncluded(path: string): boolean {
    const file = this.files.get(path);
    return file?.included ?? false;
  }

  /**
   * Remove a file from context.
   */
  removeFile(path: string): boolean {
    const file = this.files.get(path);
    if (!file) return false;

    if (file.included) {
      this.usedTokens -= file.tokenCount;
    }
    this.files.delete(path);
    this.relevanceScores.delete(path);
    return true;
  }

  /**
   * Clear all context.
   */
  clear(): void {
    this.files.clear();
    this.relevanceScores.clear();
    this.usedTokens = 0;
  }

  /**
   * Set a new token budget.
   */
  setBudget(tokens: number): void {
    this.budgetTokens = tokens;
    this.optimizeContext();
  }

  /**
   * Estimate token count for text.
   * Rough approximation: ~4 characters per token.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Simple tokenization for relevance scoring.
   */
  private tokenize(text: string): string[] {
    return text.split(/[\s\-_./\\]+/).filter((t) => t.length > 2);
  }
}

/**
 * Compute relevance score for a file based on query.
 */
export function computeRelevance(
  filePath: string,
  content: string,
  query: string
): number {
  let score = 0;
  const queryLower = query.toLowerCase();
  const pathLower = filePath.toLowerCase();
  const contentLower = content.toLowerCase();

  // Exact path match
  if (pathLower.includes(queryLower)) {
    score += 0.5;
  }

  // File extension relevance
  const ext = filePath.split('.').pop()?.toLowerCase();
  const codeExtensions = ['ts', 'js', 'py', 'tsx', 'jsx', 'mjs'];
  if (ext && codeExtensions.includes(ext)) {
    score += 0.1;
  }

  // Content contains query terms
  const terms = queryLower.split(/\s+/);
  for (const term of terms) {
    if (term.length > 2 && contentLower.includes(term)) {
      score += 0.1;
    }
  }

  // Function or class definition match
  const functionPattern = new RegExp(
    `(function|class|const|let|var)\\s+${query}`,
    'i'
  );
  if (functionPattern.test(content)) {
    score += 0.3;
  }

  return Math.min(1.0, score);
}

/**
 * Build context from a list of files, prioritizing by relevance.
 */
export function buildContext(
  files: Array<{ path: string; content: string }>,
  query: string,
  budgetTokens: number
): CodeContext {
  const manager = new ContextManager(budgetTokens);

  // Compute relevance and add files
  const withRelevance = files.map((f) => ({
    ...f,
    relevance: computeRelevance(f.path, f.content, query),
  }));

  // Sort by relevance (highest first)
  withRelevance.sort((a, b) => b.relevance - a.relevance);

  // Add files until budget exhausted
  for (const file of withRelevance) {
    manager.addFile(file.path, file.content, file.relevance);
  }

  return manager.getContext();
}

/**
 * Summarize a file for reduced token usage.
 * Extracts function signatures and class definitions.
 */
export function summarizeFile(content: string): string {
  const lines = content.split('\n');
  const summary: string[] = [];

  let inMultilineComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track multiline comments
    if (trimmed.includes('/*')) inMultilineComment = true;
    if (trimmed.includes('*/')) {
      inMultilineComment = false;
      continue;
    }
    if (inMultilineComment) continue;

    // Skip single-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Include imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      summary.push(line);
      continue;
    }

    // Include function/class/interface definitions
    if (
      trimmed.match(/^(export\s+)?(async\s+)?function\s+\w+/) ||
      trimmed.match(/^(export\s+)?class\s+\w+/) ||
      trimmed.match(/^(export\s+)?interface\s+\w+/) ||
      trimmed.match(/^(export\s+)?type\s+\w+/) ||
      trimmed.match(/^def\s+\w+/) ||
      trimmed.match(/^class\s+\w+/)
    ) {
      summary.push(line);
    }
  }

  return summary.join('\n');
}
