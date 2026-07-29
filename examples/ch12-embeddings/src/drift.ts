// Embedding drift detection.
// When embedding models are updated, vectors change. This breaks cached
// embeddings and can silently degrade search quality. Drift detection
// identifies when a model update has changed similarity relationships.

import type { DriftPair, DriftReport } from './types.ts';
import { cosineSimilarity } from './similarity.ts';

/**
 * Configuration for drift detection.
 */
export interface DriftConfig {
  // Threshold for considering a similarity change significant
  deltaThreshold: number;
  // Minimum sample size for statistical validity
  minSampleSize: number;
  // Whether to detect global shift (all similarities change uniformly)
  detectGlobalShift: boolean;
}

const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  deltaThreshold: 0.1,
  minSampleSize: 10,
  detectGlobalShift: true
};

/**
 * Detect drift between two sets of embeddings for the same texts.
 *
 * The key insight: drift matters when it changes relative similarities.
 * If all embeddings shift uniformly, search results stay the same.
 * If some pairs become more similar while others become less similar,
 * rankings change and search quality degrades.
 */
export function detectDrift(
  textsA: string[],
  embeddingsOld: number[][],
  embeddingsNew: number[][],
  modelA: string,
  modelB: string,
  config: Partial<DriftConfig> = {}
): DriftReport {
  const cfg = { ...DEFAULT_DRIFT_CONFIG, ...config };

  if (textsA.length !== embeddingsOld.length ||
      textsA.length !== embeddingsNew.length) {
    throw new Error('Text and embedding arrays must have same length');
  }

  if (textsA.length < cfg.minSampleSize) {
    throw new Error(
      `Sample size ${textsA.length} below minimum ${cfg.minSampleSize}`
    );
  }

  const deltas: number[] = [];
  const affectedPairs: DriftPair[] = [];

  // Compare similarity between all pairs of texts
  for (let i = 0; i < textsA.length; i++) {
    for (let j = i + 1; j < textsA.length; j++) {
      const oldSim = cosineSimilarity(embeddingsOld[i], embeddingsOld[j]);
      const newSim = cosineSimilarity(embeddingsNew[i], embeddingsNew[j]);
      const delta = Math.abs(newSim - oldSim);

      deltas.push(delta);

      if (delta > cfg.deltaThreshold) {
        affectedPairs.push({
          textA: textsA[i],
          textB: textsA[j],
          oldSimilarity: oldSim,
          newSimilarity: newSim,
          delta
        });
      }
    }
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const maxDelta = Math.max(...deltas);

  // Drift is detected if:
  // 1. Any pair exceeds the threshold, OR
  // 2. Average delta is high (global shift with variance)
  const driftDetected = affectedPairs.length > 0 || avgDelta > cfg.deltaThreshold / 2;

  return {
    modelA,
    modelB,
    sampleSize: textsA.length,
    avgCosineDelta: avgDelta,
    maxCosineDelta: maxDelta,
    driftDetected,
    affectedPairs: affectedPairs.sort((a, b) => b.delta - a.delta)
  };
}

/**
 * Measure drift for a single text between two model versions.
 * Returns the cosine distance between old and new embedding.
 */
export function measureSingleTextDrift(
  embeddingOld: number[],
  embeddingNew: number[]
): number {
  // Cosine distance = 1 - cosine similarity
  return 1 - cosineSimilarity(embeddingOld, embeddingNew);
}

/**
 * Check if embeddings need reindexing after a model update.
 *
 * Returns true if drift is severe enough that cached/indexed embeddings
 * should be regenerated.
 */
export function shouldReindex(report: DriftReport): boolean {
  // Reindex if:
  // 1. More than 10% of pairs are affected, OR
  // 2. Max delta exceeds 0.3 (severe shift), OR
  // 3. Average delta exceeds 0.15
  const totalPairs = (report.sampleSize * (report.sampleSize - 1)) / 2;
  const affectedRatio = report.affectedPairs.length / totalPairs;

  return (
    affectedRatio > 0.1 ||
    report.maxCosineDelta > 0.3 ||
    report.avgCosineDelta > 0.15
  );
}

/**
 * Drift monitor for continuous tracking.
 */
export class DriftMonitor {
  private baselineEmbeddings: Map<string, number[]>;
  private baselineModelVersion: string;
  private config: DriftConfig;

  constructor(
    baselineModelVersion: string,
    config: Partial<DriftConfig> = {}
  ) {
    this.baselineEmbeddings = new Map();
    this.baselineModelVersion = baselineModelVersion;
    this.config = { ...DEFAULT_DRIFT_CONFIG, ...config };
  }

  /**
   * Set baseline embedding for a text.
   */
  setBaseline(text: string, embedding: number[]): void {
    this.baselineEmbeddings.set(text, embedding);
  }

  /**
   * Set multiple baselines.
   */
  setBaselines(entries: Array<{ text: string; embedding: number[] }>): void {
    for (const entry of entries) {
      this.setBaseline(entry.text, entry.embedding);
    }
  }

  /**
   * Check a new embedding against baseline.
   * Returns drift distance (0 = no drift, 1 = completely different).
   */
  checkDrift(text: string, newEmbedding: number[]): number | null {
    const baseline = this.baselineEmbeddings.get(text);
    if (!baseline) {
      return null;
    }
    return measureSingleTextDrift(baseline, newEmbedding);
  }

  /**
   * Run full drift analysis against a new model version.
   */
  analyzeModelUpdate(
    newModelVersion: string,
    newEmbeddings: Map<string, number[]>
  ): DriftReport {
    const texts: string[] = [];
    const oldEmbs: number[][] = [];
    const newEmbs: number[][] = [];

    for (const [text, baseline] of this.baselineEmbeddings) {
      const newEmb = newEmbeddings.get(text);
      if (newEmb) {
        texts.push(text);
        oldEmbs.push(baseline);
        newEmbs.push(newEmb);
      }
    }

    if (texts.length < this.config.minSampleSize) {
      throw new Error(
        `Insufficient overlap: ${texts.length} texts, need ${this.config.minSampleSize}`
      );
    }

    return detectDrift(
      texts,
      oldEmbs,
      newEmbs,
      this.baselineModelVersion,
      newModelVersion,
      this.config
    );
  }

  /**
   * Update baseline to new model version after drift is accepted.
   */
  updateBaseline(
    newModelVersion: string,
    newEmbeddings: Map<string, number[]>
  ): void {
    this.baselineModelVersion = newModelVersion;
    for (const [text, embedding] of newEmbeddings) {
      this.baselineEmbeddings.set(text, embedding);
    }
  }

  /**
   * Get current baseline model version.
   */
  getBaselineVersion(): string {
    return this.baselineModelVersion;
  }

  /**
   * Get number of baseline embeddings.
   */
  getBaselineCount(): number {
    return this.baselineEmbeddings.size;
  }
}

/**
 * Create a drift monitor.
 */
export function createDriftMonitor(
  baselineModelVersion: string,
  config?: Partial<DriftConfig>
): DriftMonitor {
  return new DriftMonitor(baselineModelVersion, config);
}
