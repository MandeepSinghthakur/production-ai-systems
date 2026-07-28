// Latency vs quality tradeoff measurement.
// Demonstrates that re-ranking improves quality but costs latency,
// and that quality gains diminish past certain re-rank depths.

import type { RetrievalResult, LatencyMeasurement } from './types.ts';
import type { RelevanceJudgment } from './types.ts';
import { precisionAtK, ndcg } from './metrics.ts';
import { rerankTopK } from './reranker.ts';

/**
 * Measure latency and quality at a specific re-rank depth.
 */
export function measureAtDepth(
  query: string,
  results: RetrievalResult[],
  relevantDocIds: string[],
  rerankDepth: number,
  latencyPerDocMs: number
): LatencyMeasurement {
  const { reranked, latencyMs } = rerankTopK(
    query,
    results,
    relevantDocIds,
    rerankDepth,
    { latencyPerDocMs }
  );

  return {
    rerankDepth,
    latencyMs,
    precisionAt5: precisionAtK(reranked, relevantDocIds, 5),
    ndcg: ndcg(reranked, relevantDocIds, 5),
  };
}

/**
 * Measure quality degradation when skipping re-ranking entirely.
 */
export function measureBaselineVsReranked(
  query: string,
  results: RetrievalResult[],
  relevantDocIds: string[],
  rerankDepth: number
): { baseline: LatencyMeasurement; reranked: LatencyMeasurement } {
  // Baseline: no re-ranking (depth 0 simulated)
  const baseline: LatencyMeasurement = {
    rerankDepth: 0,
    latencyMs: 0,
    precisionAt5: precisionAtK(results, relevantDocIds, 5),
    ndcg: ndcg(results, relevantDocIds, 5),
  };

  // Re-ranked
  const reranked = measureAtDepth(
    query,
    results,
    relevantDocIds,
    rerankDepth,
    5 // default latency per doc
  );

  return { baseline, reranked };
}

/**
 * Sweep across multiple depths to find where gains diminish.
 * Returns measurements and identifies the "knee" in the curve.
 */
export function sweepDepths(
  query: string,
  results: RetrievalResult[],
  relevantDocIds: string[],
  depths: number[],
  latencyPerDocMs: number
): {
  measurements: LatencyMeasurement[];
  diminishingReturnsAt: number | null;
} {
  const measurements: LatencyMeasurement[] = [];

  for (const depth of depths) {
    measurements.push(
      measureAtDepth(query, results, relevantDocIds, depth, latencyPerDocMs)
    );
  }

  // Find where quality gains drop below 2% per additional 5 documents
  let diminishingReturnsAt: number | null = null;
  for (let i = 1; i < measurements.length; i++) {
    const prev = measurements[i - 1];
    const curr = measurements[i];
    const depthDelta = curr.rerankDepth - prev.rerankDepth;
    const ndcgImprovement = curr.ndcg - prev.ndcg;
    const improvementRate = depthDelta > 0 ? ndcgImprovement / depthDelta : 0;

    // Diminishing returns when improvement is less than 1% per document
    if (improvementRate < 0.01 && diminishingReturnsAt === null) {
      diminishingReturnsAt = prev.rerankDepth;
    }
  }

  return { measurements, diminishingReturnsAt };
}

/**
 * Calculate latency budget to determine maximum re-rank depth.
 * Given a target latency, returns how many documents can be re-ranked.
 */
export function calculateMaxDepthForLatency(
  targetLatencyMs: number,
  latencyPerDocMs: number,
  overheadMs: number = 2
): number {
  const available = targetLatencyMs - overheadMs;
  if (available <= 0) return 0;
  return Math.floor(available / latencyPerDocMs);
}

/**
 * Simulate cascaded retrieval: fast retrieval of N docs, re-rank top M.
 * Returns quality and total latency.
 */
export function simulateCascade(
  judgments: RelevanceJudgment[],
  retrieveFn: (query: string, topK: number) => RetrievalResult[],
  retrieveN: number,
  rerankM: number,
  retrievalLatencyMs: number,
  rerankLatencyPerDocMs: number
): {
  avgPrecisionAt5: number;
  avgNdcg: number;
  avgLatencyMs: number;
} {
  let totalPrecision = 0;
  let totalNdcg = 0;
  let totalLatency = 0;

  for (const judgment of judgments) {
    // Fast retrieval
    const retrievalStart = performance.now();
    const results = retrieveFn(judgment.query, retrieveN);
    const retrievalLatency = performance.now() - retrievalStart + retrievalLatencyMs;

    // Re-rank top M
    const { reranked, latencyMs: rerankLatency } = rerankTopK(
      judgment.query,
      results,
      judgment.relevantDocIds,
      rerankM,
      { latencyPerDocMs: rerankLatencyPerDocMs }
    );

    totalPrecision += precisionAtK(reranked, judgment.relevantDocIds, 5);
    totalNdcg += ndcg(reranked, judgment.relevantDocIds, 5);
    totalLatency += retrievalLatency + rerankLatency;
  }

  const n = judgments.length;
  return {
    avgPrecisionAt5: totalPrecision / n,
    avgNdcg: totalNdcg / n,
    avgLatencyMs: totalLatency / n,
  };
}
