// Evaluation harness orchestration.
//
// Coordinates dataset, model simulation, judge, metrics, and
// regression detection into a complete evaluation pipeline.

import type {
  EvalExample,
  EvalResult,
  EvalRunSummary,
  RegressionReport,
  HarnessConfig,
  JudgeRubric,
} from './types.ts';
import { EvalDataset } from './dataset.ts';
import { JudgeScorer, DEFAULT_RUBRIC } from './judge.ts';
import { computeMetrics, aggregateResults } from './metrics.ts';
import { detectRegressions } from './regression.ts';

/**
 * Model simulator for testing.
 *
 * In production, this would call a real model endpoint.
 * For testing, we simulate responses with controlled quality.
 */
export class ModelSimulator {
  private version: string;
  private qualityFactor: number;
  private seed: number;

  constructor(version: string, qualityFactor?: number, seed?: number) {
    this.version = version;
    // Quality factor: 1.0 = good model, 0.5 = degraded model
    this.qualityFactor = qualityFactor ?? 1.0;
    this.seed = seed ?? 42;
  }

  /**
   * Simulate a model response.
   *
   * For a good model, returns the expected output with minor variations.
   * For a degraded model, introduces errors proportional to quality factor.
   */
  generate(
    input: string,
    expected: string,
    exampleIndex: number
  ): { output: string; latencyMs: number } {
    const rng = this.deterministicRandom(
      input + expected + exampleIndex + this.seed
    );

    // Simulate latency (100-500ms)
    const latencyMs = 100 + Math.floor(rng() * 400);

    // High quality: return expected with minor variations
    if (this.qualityFactor >= 0.9) {
      const output = this.maybeAddVariation(expected, rng);
      return { output, latencyMs };
    }

    // Medium quality: sometimes return partial or wrong answer
    if (this.qualityFactor >= 0.6) {
      if (rng() < this.qualityFactor) {
        return { output: expected, latencyMs };
      } else {
        return { output: this.degradeResponse(expected, rng), latencyMs };
      }
    }

    // Low quality: always wrong (quality < 0.6)
    // Use qualityFactor to decide between degraded vs completely wrong
    if (rng() < this.qualityFactor * 1.5) {
      // Degraded but not completely wrong
      return { output: this.degradeResponse(expected, rng), latencyMs };
    } else {
      // Completely wrong
      return {
        output: this.generateWrongAnswer(input, expected, rng),
        latencyMs,
      };
    }
  }

  /**
   * Get model version.
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * Deterministic random number generator.
   */
  private deterministicRandom(seed: string): () => number {
    let state = 0;
    for (let i = 0; i < seed.length; i++) {
      state = (state * 31 + seed.charCodeAt(i)) & 0x7fffffff;
    }
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  /**
   * Add minor variation to response (case, punctuation).
   */
  private maybeAddVariation(text: string, rng: () => number): string {
    if (rng() < 0.3) {
      // Sometimes add a period
      return text.endsWith('.') ? text : text + '.';
    }
    if (rng() < 0.2) {
      // Sometimes change case
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return text;
  }

  /**
   * Degrade a response (truncate, add noise).
   */
  private degradeResponse(expected: string, rng: () => number): string {
    // Sometimes truncate
    if (rng() < 0.4) {
      const cutPoint = Math.floor(expected.length * (0.5 + rng() * 0.3));
      return expected.slice(0, cutPoint) + '...';
    }
    // Sometimes add filler
    if (rng() < 0.3) {
      return 'I think ' + expected.toLowerCase();
    }
    // Sometimes give incomplete answer
    return expected.split(/\s+/).slice(0, -1).join(' ');
  }

  /**
   * Generate a wrong answer.
   */
  private generateWrongAnswer(
    input: string,
    expected: string,
    rng: () => number
  ): string {
    const wrongAnswers = [
      'I am not sure about that.',
      'The answer is unclear.',
      'This requires more context.',
      'Let me think about that.',
      'I cannot determine the answer.',
    ];
    return wrongAnswers[Math.floor(rng() * wrongAnswers.length)];
  }
}

/**
 * The main evaluation harness.
 */
export class EvalHarness {
  private judge: JudgeScorer;
  private regressionThreshold: number;
  private confidenceLevel: number;
  private minSampleSize: number;

  constructor(config?: Partial<HarnessConfig>) {
    this.judge = new JudgeScorer(config?.judgeRubric);
    this.regressionThreshold = config?.regressionThreshold ?? 0.05;
    this.confidenceLevel = config?.confidenceLevel ?? 0.95;
    this.minSampleSize = config?.minSampleSize ?? 20;
  }

  /**
   * Run evaluation on a dataset with a model.
   */
  run(
    dataset: EvalDataset,
    model: ModelSimulator,
    runId?: string
  ): { results: EvalResult[]; summary: EvalRunSummary } {
    const results: EvalResult[] = [];
    const examples = dataset.getAllExamples();
    const actualRunId = runId ?? `run_${Date.now()}`;

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];

      // Generate model response
      const { output, latencyMs } = model.generate(
        example.input,
        example.expectedOutput,
        i
      );

      // Score with judge
      const { score, rationale } = this.judge.score(
        example.input,
        example.expectedOutput,
        output,
        i
      );

      // Compute metrics
      const metrics = computeMetrics(
        example.expectedOutput,
        output,
        score,
        latencyMs,
        rationale
      );

      results.push({
        exampleId: example.id,
        input: example.input,
        expectedOutput: example.expectedOutput,
        actualOutput: output,
        metrics,
        timestamp: Date.now(),
        modelVersion: model.getVersion(),
      });
    }

    const summary = aggregateResults(results, actualRunId, model.getVersion());
    return { results, summary };
  }

  /**
   * Run evaluation and compare against a baseline for regression detection.
   */
  runWithRegression(
    dataset: EvalDataset,
    candidateModel: ModelSimulator,
    baselineResults: EvalResult[]
  ): {
    results: EvalResult[];
    summary: EvalRunSummary;
    regression: RegressionReport;
  } {
    const { results, summary } = this.run(
      dataset,
      candidateModel,
      `candidate_${Date.now()}`
    );

    const regression = detectRegressions(baselineResults, results, {
      regressionThreshold: this.regressionThreshold,
      confidenceLevel: this.confidenceLevel,
    });

    return { results, summary, regression };
  }

  /**
   * Check if results pass quality gate.
   */
  passesQualityGate(
    summary: EvalRunSummary,
    minimumPassRate?: number
  ): { passes: boolean; reason: string } {
    const threshold = minimumPassRate ?? this.judge.getPassingThreshold();

    if (summary.totalExamples < this.minSampleSize) {
      return {
        passes: false,
        reason: `Insufficient samples: ${summary.totalExamples} < ${this.minSampleSize}`,
      };
    }

    const passRate = summary.passingExamples / summary.totalExamples;
    if (passRate < threshold) {
      return {
        passes: false,
        reason: `Pass rate ${(passRate * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`,
      };
    }

    return { passes: true, reason: 'All quality gates passed' };
  }

  /**
   * Get regression threshold.
   */
  getRegressionThreshold(): number {
    return this.regressionThreshold;
  }

  /**
   * Get minimum sample size.
   */
  getMinSampleSize(): number {
    return this.minSampleSize;
  }
}

/**
 * Format a regression report for display.
 */
export function formatRegressionReport(report: RegressionReport): string {
  const lines: string[] = [];

  lines.push('=== Regression Report ===');
  lines.push(`Overall delta: ${(report.overallDelta * 100).toFixed(2)}%`);
  lines.push(`Threshold: ${(report.regressionThreshold * 100).toFixed(2)}%`);
  lines.push(`Has regression: ${report.hasRegression}`);
  lines.push('');

  lines.push('Statistical significance:');
  lines.push(`  Test: ${report.statisticalSignificance.testName}`);
  lines.push(`  p-value: ${report.statisticalSignificance.pValue.toFixed(4)}`);
  lines.push(
    `  Significant: ${report.statisticalSignificance.isSignificant}`
  );
  lines.push(
    `  Effect size: ${report.statisticalSignificance.effectSize.toFixed(3)}`
  );
  lines.push('');

  if (report.significantRegressions.length > 0) {
    lines.push(`Regressions (${report.significantRegressions.length}):`);
    for (const reg of report.significantRegressions.slice(0, 5)) {
      lines.push(
        `  ${reg.exampleId}: ${(reg.baselineScore * 100).toFixed(1)}% -> ` +
          `${(reg.candidateScore * 100).toFixed(1)}% ` +
          `(${(reg.delta * 100).toFixed(1)}%)`
      );
    }
    if (report.significantRegressions.length > 5) {
      lines.push(`  ... and ${report.significantRegressions.length - 5} more`);
    }
    lines.push('');
  }

  if (report.improvements.length > 0) {
    lines.push(`Improvements (${report.improvements.length}):`);
    for (const imp of report.improvements.slice(0, 5)) {
      lines.push(
        `  ${imp.exampleId}: ${(imp.baselineScore * 100).toFixed(1)}% -> ` +
          `${(imp.candidateScore * 100).toFixed(1)}% ` +
          `(+${(imp.delta * 100).toFixed(1)}%)`
      );
    }
    if (report.improvements.length > 5) {
      lines.push(`  ... and ${report.improvements.length - 5} more`);
    }
  }

  return lines.join('\n');
}
