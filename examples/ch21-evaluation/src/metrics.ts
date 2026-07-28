// Quality metrics for evaluation.
//
// Implements exact match, semantic similarity, and aggregation.
// These are the building blocks that the judge and harness use.

import type {
  EvalMetrics,
  EvalResult,
  EvalRunSummary,
  CategorySummary,
} from './types.ts';

/**
 * Compute exact match between expected and actual.
 * Normalizes whitespace and case.
 */
export function exactMatch(expected: string, actual: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/\s+/g, ' ');
  return normalize(expected) === normalize(actual);
}

/**
 * Compute semantic similarity score (0-1).
 *
 * In production, this would use embeddings and cosine similarity.
 * Here we simulate with a simple token overlap metric (Jaccard).
 */
export function semanticSimilarity(expected: string, actual: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 0)
    );

  const expectedTokens = tokenize(expected);
  const actualTokens = tokenize(actual);

  if (expectedTokens.size === 0 && actualTokens.size === 0) {
    return 1.0;
  }

  if (expectedTokens.size === 0 || actualTokens.size === 0) {
    return 0.0;
  }

  // Jaccard similarity
  let intersection = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      intersection++;
    }
  }

  const union = expectedTokens.size + actualTokens.size - intersection;
  return intersection / union;
}

/**
 * Compute metrics for a single evaluation result.
 */
export function computeMetrics(
  expected: string,
  actual: string,
  judgeScore: number,
  latencyMs: number,
  judgeRationale?: string
): EvalMetrics {
  return {
    exactMatch: exactMatch(expected, actual),
    semanticScore: semanticSimilarity(expected, actual),
    judgeScore,
    judgeRationale,
    latencyMs,
    tokenCount: actual.split(/\s+/).length,
  };
}

/**
 * Aggregate metrics across an evaluation run.
 */
export function aggregateResults(
  results: EvalResult[],
  runId: string,
  modelVersion: string
): EvalRunSummary {
  if (results.length === 0) {
    return {
      runId,
      modelVersion,
      timestamp: Date.now(),
      totalExamples: 0,
      exactMatchRate: 0,
      averageSemanticScore: 0,
      averageJudgeScore: 0,
      averageLatencyMs: 0,
      passingExamples: 0,
      failingExamples: 0,
    };
  }

  const exactMatches = results.filter((r) => r.metrics.exactMatch).length;
  const semanticSum = results.reduce(
    (sum, r) => sum + r.metrics.semanticScore,
    0
  );
  const judgeSum = results.reduce((sum, r) => sum + r.metrics.judgeScore, 0);
  const latencySum = results.reduce((sum, r) => sum + r.metrics.latencyMs, 0);

  // A result passes if judge score >= 0.7
  const passingThreshold = 0.7;
  const passing = results.filter(
    (r) => r.metrics.judgeScore >= passingThreshold
  ).length;

  // Aggregate by category
  const byCategory: Record<string, CategorySummary> = {};
  const categoryGroups = new Map<string, EvalResult[]>();

  for (const result of results) {
    // Extract category from example metadata if available
    const category = (result as unknown as { category?: string }).category ??
      'uncategorized';
    if (!categoryGroups.has(category)) {
      categoryGroups.set(category, []);
    }
    categoryGroups.get(category)!.push(result);
  }

  for (const [category, catResults] of categoryGroups) {
    const catExactMatches = catResults.filter(
      (r) => r.metrics.exactMatch
    ).length;
    const catJudgeSum = catResults.reduce(
      (sum, r) => sum + r.metrics.judgeScore,
      0
    );

    byCategory[category] = {
      count: catResults.length,
      exactMatchRate: catExactMatches / catResults.length,
      averageJudgeScore: catJudgeSum / catResults.length,
    };
  }

  return {
    runId,
    modelVersion,
    timestamp: Date.now(),
    totalExamples: results.length,
    exactMatchRate: exactMatches / results.length,
    averageSemanticScore: semanticSum / results.length,
    averageJudgeScore: judgeSum / results.length,
    averageLatencyMs: latencySum / results.length,
    passingExamples: passing,
    failingExamples: results.length - passing,
    byCategory:
      Object.keys(byCategory).length > 0 ? byCategory : undefined,
  };
}

/**
 * Compute pass rate from results.
 */
export function computePassRate(
  results: EvalResult[],
  threshold: number = 0.7
): number {
  if (results.length === 0) return 0;
  const passing = results.filter(
    (r) => r.metrics.judgeScore >= threshold
  ).length;
  return passing / results.length;
}

/**
 * Compute percentile of judge scores.
 */
export function computePercentile(
  results: EvalResult[],
  percentile: number
): number {
  if (results.length === 0) return 0;

  const scores = results.map((r) => r.metrics.judgeScore).sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * scores.length) - 1;
  return scores[Math.max(0, index)];
}
