// Core types for evaluation pipelines.
// See Chapter 21, "Building Production AI Systems".

/**
 * An evaluation example: input, expected output, and metadata.
 */
export interface EvalExample {
  id: string;
  input: string;
  expectedOutput: string;
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  metadata?: Record<string, unknown>;
}

/**
 * Result of running a model on an eval example.
 */
export interface EvalResult {
  exampleId: string;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  metrics: EvalMetrics;
  timestamp: number;
  modelVersion: string;
}

/**
 * Metrics computed for a single evaluation result.
 */
export interface EvalMetrics {
  exactMatch: boolean;
  semanticScore: number;       // 0-1 similarity score
  judgeScore: number;          // 0-1 from LLM-as-judge
  judgeRationale?: string;
  latencyMs: number;
  tokenCount: number;
}

/**
 * Aggregated metrics across an eval run.
 */
export interface EvalRunSummary {
  runId: string;
  modelVersion: string;
  timestamp: number;
  totalExamples: number;
  exactMatchRate: number;      // 0-1
  averageSemanticScore: number;
  averageJudgeScore: number;
  averageLatencyMs: number;
  passingExamples: number;
  failingExamples: number;
  byCategory?: Record<string, CategorySummary>;
}

/**
 * Summary metrics for a category of examples.
 */
export interface CategorySummary {
  count: number;
  exactMatchRate: number;
  averageJudgeScore: number;
}

/**
 * Result of comparing two eval runs for regression detection.
 */
export interface RegressionReport {
  baselineRunId: string;
  candidateRunId: string;
  hasRegression: boolean;
  regressionThreshold: number;
  overallDelta: number;        // candidate - baseline score
  significantRegressions: RegressionDetail[];
  improvements: RegressionDetail[];
  statisticalSignificance: StatisticalResult;
}

/**
 * Detail about a specific regression or improvement.
 */
export interface RegressionDetail {
  exampleId: string;
  category?: string;
  baselineScore: number;
  candidateScore: number;
  delta: number;
}

/**
 * Result of a statistical significance test.
 */
export interface StatisticalResult {
  testName: string;
  pValue: number;
  isSignificant: boolean;
  confidenceLevel: number;
  effectSize: number;
}

/**
 * Judge scoring rubric for LLM-as-judge.
 */
export interface JudgeRubric {
  criteria: JudgeCriterion[];
  passingThreshold: number;    // 0-1
}

/**
 * A single criterion in the judge rubric.
 */
export interface JudgeCriterion {
  name: string;
  description: string;
  weight: number;              // Sum of weights should be 1.0
}

/**
 * Human-labeled example for judge calibration.
 */
export interface HumanLabel {
  exampleId: string;
  humanScore: number;          // 0-1
  annotatorId: string;
  timestamp: number;
  rationale?: string;
}

/**
 * Correlation result between judge and human scores.
 */
export interface JudgeCorrelation {
  pearsonR: number;            // -1 to 1
  spearmanRho: number;         // -1 to 1
  meanAbsoluteError: number;
  sampleSize: number;
  isCalibrated: boolean;       // Above threshold for production use
}

/**
 * Configuration for an evaluation harness.
 */
export interface HarnessConfig {
  datasetPath: string;
  modelVersion: string;
  judgeRubric: JudgeRubric;
  regressionThreshold: number; // Max acceptable score drop
  confidenceLevel: number;     // For statistical tests (e.g., 0.95)
  minSampleSize: number;       // Minimum examples for significance
}
