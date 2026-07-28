// LLM-as-judge simulation.
//
// In production, this would call a model to score outputs.
// Here we simulate judge behavior with deterministic scoring
// based on similarity metrics, for reproducible testing.

import type {
  EvalExample,
  JudgeRubric,
  JudgeCriterion,
  JudgeCorrelation,
  HumanLabel,
} from './types.ts';
import { semanticSimilarity, exactMatch } from './metrics.ts';

/**
 * Default rubric for general-purpose evaluation.
 */
export const DEFAULT_RUBRIC: JudgeRubric = {
  criteria: [
    {
      name: 'correctness',
      description: 'The response is factually correct and answers the question',
      weight: 0.5,
    },
    {
      name: 'completeness',
      description: 'The response fully addresses all parts of the question',
      weight: 0.3,
    },
    {
      name: 'clarity',
      description: 'The response is clear and well-structured',
      weight: 0.2,
    },
  ],
  passingThreshold: 0.7,
};

/**
 * Simulated LLM-as-judge scorer.
 *
 * In production, this would:
 * 1. Format the rubric, example, and output into a prompt
 * 2. Call a model (typically a frontier model for quality)
 * 3. Parse the structured score from the response
 *
 * For testing, we simulate this with deterministic scoring.
 */
export class JudgeScorer {
  private rubric: JudgeRubric;
  private noise: number;

  constructor(rubric?: JudgeRubric, noise?: number) {
    this.rubric = rubric ?? DEFAULT_RUBRIC;
    // Add small noise to simulate model variability
    this.noise = noise ?? 0.05;
  }

  /**
   * Score a model output against an expected output.
   * Returns a score from 0-1 and optional rationale.
   */
  score(
    input: string,
    expected: string,
    actual: string,
    seed?: number
  ): { score: number; rationale: string } {
    // Base score from semantic similarity
    const semantic = semanticSimilarity(expected, actual);

    // Bonus for exact match
    const exact = exactMatch(expected, actual);
    const exactBonus = exact ? 0.2 : 0;

    // Check if expected is contained in actual (common for verbose answers)
    const expectedLower = expected.toLowerCase().trim();
    const actualLower = actual.toLowerCase().trim();
    const containsExpected = actualLower.includes(expectedLower);
    const containsBonus = containsExpected && !exact ? 0.4 : 0;

    // Penalty for being too verbose (more than 5x expected length)
    const lengthRatio = actual.length / Math.max(expected.length, 1);
    const verbosityPenalty = lengthRatio > 5 ? 0.1 : 0;

    // Penalty for being too terse (less than 0.3x expected length)
    const tersePenalty = lengthRatio < 0.3 && !exact ? 0.15 : 0;

    // Calculate weighted score per criterion (simulated)
    // If contains expected, give high base score since answer is correct
    let baseScore: number;
    if (exact) {
      baseScore = 1.0;
    } else if (containsExpected) {
      baseScore = 0.75 + containsBonus * 0.2 - verbosityPenalty;
    } else {
      baseScore = semantic * 0.9 - tersePenalty;
    }

    // Add deterministic noise for realism
    const noiseValue = this.deterministicNoise(input + actual, seed ?? 0);
    baseScore += noiseValue * this.noise;

    // Clamp to [0, 1]
    const finalScore = Math.max(0, Math.min(1, baseScore));

    // Generate rationale
    const rationale = this.generateRationale(
      finalScore,
      exact,
      semantic,
      lengthRatio
    );

    return { score: finalScore, rationale };
  }

  /**
   * Score multiple outputs in batch.
   */
  scoreBatch(
    examples: Array<{ input: string; expected: string; actual: string }>,
    seed?: number
  ): Array<{ score: number; rationale: string }> {
    return examples.map((ex, i) =>
      this.score(ex.input, ex.expected, ex.actual, (seed ?? 0) + i)
    );
  }

  /**
   * Generate a deterministic noise value from a string.
   */
  private deterministicNoise(s: string, seed: number): number {
    let hash = seed;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
    }
    // Map to [-1, 1]
    return (hash / 0x7fffffff) * 2 - 1;
  }

  /**
   * Generate a rationale for the score.
   */
  private generateRationale(
    score: number,
    exact: boolean,
    semantic: number,
    lengthRatio: number
  ): string {
    const parts: string[] = [];

    if (exact) {
      parts.push('The response exactly matches the expected output.');
    } else if (semantic >= 0.8) {
      parts.push('The response is semantically very similar to the expected.');
    } else if (semantic >= 0.5) {
      parts.push('The response partially captures the expected meaning.');
    } else {
      parts.push('The response diverges significantly from the expected.');
    }

    if (lengthRatio > 2) {
      parts.push('The response is overly verbose.');
    } else if (lengthRatio < 0.3) {
      parts.push('The response may be too terse.');
    }

    if (score >= 0.9) {
      parts.push('Overall: Excellent.');
    } else if (score >= 0.7) {
      parts.push('Overall: Acceptable.');
    } else if (score >= 0.5) {
      parts.push('Overall: Needs improvement.');
    } else {
      parts.push('Overall: Failing.');
    }

    return parts.join(' ');
  }

  /**
   * Get the rubric.
   */
  getRubric(): JudgeRubric {
    return this.rubric;
  }

  /**
   * Get passing threshold.
   */
  getPassingThreshold(): number {
    return this.rubric.passingThreshold;
  }
}

/**
 * Compute correlation between judge scores and human labels.
 *
 * This is critical for calibrating whether your judge can be trusted.
 * A judge with low correlation to humans should not gate deployments.
 */
export function computeJudgeCorrelation(
  judgeScores: Map<string, number>,
  humanLabels: HumanLabel[],
  calibrationThreshold: number = 0.7
): JudgeCorrelation {
  // Match judge scores to human labels
  const pairs: Array<{ judge: number; human: number }> = [];

  for (const label of humanLabels) {
    const judgeScore = judgeScores.get(label.exampleId);
    if (judgeScore !== undefined) {
      pairs.push({ judge: judgeScore, human: label.humanScore });
    }
  }

  if (pairs.length < 3) {
    // Not enough data for meaningful correlation
    return {
      pearsonR: 0,
      spearmanRho: 0,
      meanAbsoluteError: 1,
      sampleSize: pairs.length,
      isCalibrated: false,
    };
  }

  // Compute Pearson correlation
  const judgeScoresArr = pairs.map((p) => p.judge);
  const humanScoresArr = pairs.map((p) => p.human);
  const pearsonR = pearsonCorrelation(judgeScoresArr, humanScoresArr);

  // Compute Spearman correlation (rank-based)
  const spearmanRho = spearmanCorrelation(judgeScoresArr, humanScoresArr);

  // Compute mean absolute error
  const mae =
    pairs.reduce((sum, p) => sum + Math.abs(p.judge - p.human), 0) /
    pairs.length;

  return {
    pearsonR,
    spearmanRho,
    meanAbsoluteError: mae,
    sampleSize: pairs.length,
    isCalibrated: pearsonR >= calibrationThreshold,
  };
}

/**
 * Compute Pearson correlation coefficient.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Compute Spearman rank correlation coefficient.
 */
function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  // Convert to ranks
  const rankX = toRanks(x);
  const rankY = toRanks(y);

  // Pearson on ranks gives Spearman
  return pearsonCorrelation(rankX, rankY);
}

/**
 * Convert values to ranks.
 */
function toRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; i++) {
    ranks[indexed[i].index] = i + 1;
  }
  return ranks;
}
