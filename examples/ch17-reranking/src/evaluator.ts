// Evaluation harness for retrieval and re-ranking pipelines.
// Runs queries against a corpus with ground-truth relevance judgments
// and computes aggregate metrics.

import type {
  Document,
  RelevanceJudgment,
  RetrievalResult,
  EvalMetrics,
} from './types.ts';
import { computeMetrics, aggregateMetrics } from './metrics.ts';
import { rerankTopK } from './reranker.ts';

export interface EvaluationResult {
  queryId: string;
  query: string;
  beforeMetrics: EvalMetrics;
  afterMetrics: EvalMetrics;
  latencyMs: number;
}

export interface AggregateEvaluation {
  beforeAggregate: EvalMetrics;
  afterAggregate: EvalMetrics;
  queryResults: EvaluationResult[];
  totalLatencyMs: number;
  avgLatencyMs: number;
}

/**
 * Run evaluation across all queries in the judgment set.
 *
 * For each query:
 * 1. Run initial retrieval (provided by retrieveFn)
 * 2. Compute metrics before re-ranking
 * 3. Apply re-ranking
 * 4. Compute metrics after re-ranking
 */
export function evaluatePipeline(
  judgments: RelevanceJudgment[],
  retrieveFn: (query: string) => RetrievalResult[],
  rerankDepth: number,
  k: number
): AggregateEvaluation {
  const queryResults: EvaluationResult[] = [];
  let totalLatencyMs = 0;

  for (const judgment of judgments) {
    // Step 1: Initial retrieval
    const initialResults = retrieveFn(judgment.query);

    // Step 2: Metrics before re-ranking
    const beforeMetrics = computeMetrics(
      initialResults,
      judgment.relevantDocIds,
      k
    );

    // Step 3: Re-rank top documents
    const { reranked, latencyMs } = rerankTopK(
      judgment.query,
      initialResults,
      judgment.relevantDocIds,
      rerankDepth
    );

    // Step 4: Metrics after re-ranking
    const afterMetrics = computeMetrics(
      reranked,
      judgment.relevantDocIds,
      k
    );

    queryResults.push({
      queryId: judgment.queryId,
      query: judgment.query,
      beforeMetrics,
      afterMetrics,
      latencyMs,
    });

    totalLatencyMs += latencyMs;
  }

  // Aggregate across all queries
  const beforeAggregate = aggregateMetrics(
    queryResults.map((r) => r.beforeMetrics)
  );
  const afterAggregate = aggregateMetrics(
    queryResults.map((r) => r.afterMetrics)
  );

  return {
    beforeAggregate,
    afterAggregate,
    queryResults,
    totalLatencyMs,
    avgLatencyMs: totalLatencyMs / queryResults.length,
  };
}

/**
 * Compare metrics at different re-rank depths to find the sweet spot.
 * Returns measurements at each depth for analysis.
 */
export function sweepRerankDepths(
  judgments: RelevanceJudgment[],
  retrieveFn: (query: string) => RetrievalResult[],
  depths: number[],
  k: number
): { depth: number; metrics: EvalMetrics; avgLatencyMs: number }[] {
  const results: { depth: number; metrics: EvalMetrics; avgLatencyMs: number }[] = [];

  for (const depth of depths) {
    const evalResult = evaluatePipeline(judgments, retrieveFn, depth, k);
    results.push({
      depth,
      metrics: evalResult.afterAggregate,
      avgLatencyMs: evalResult.avgLatencyMs,
    });
  }

  return results;
}

/**
 * Find the optimal re-rank depth that balances quality and latency.
 * Returns the depth where quality gains start to diminish.
 */
export function findOptimalDepth(
  sweepResults: { depth: number; metrics: EvalMetrics; avgLatencyMs: number }[]
): { optimalDepth: number; reason: string } {
  if (sweepResults.length < 2) {
    return { optimalDepth: sweepResults[0]?.depth ?? 10, reason: 'insufficient data' };
  }

  // Look for diminishing returns: where the NDCG improvement per
  // additional depth drops below a threshold
  const threshold = 0.005; // 0.5% NDCG improvement per additional depth

  for (let i = 1; i < sweepResults.length; i++) {
    const prev = sweepResults[i - 1];
    const curr = sweepResults[i];
    const depthDelta = curr.depth - prev.depth;
    const ndcgImprovement = curr.metrics.ndcg - prev.metrics.ndcg;
    const improvementPerDepth = ndcgImprovement / depthDelta;

    if (improvementPerDepth < threshold) {
      return {
        optimalDepth: prev.depth,
        reason: `NDCG improvement dropped to ${(improvementPerDepth * 100).toFixed(2)}% per additional document`,
      };
    }
  }

  // If no diminishing returns found, use the maximum depth
  return {
    optimalDepth: sweepResults[sweepResults.length - 1].depth,
    reason: 'quality still improving at maximum depth',
  };
}
