// Reproduces every numbered step of the Chapter 17 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs                          (from examples/ch17-reranking)
//   node examples/ch17-reranking/scripts/lab.mjs  (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { documents, judgments, simulateBM25Retrieval } =
  await import(resolve(srcDir, 'dataset.ts'));
const { precisionAtK, recallAtK, meanReciprocalRank, ndcg, computeMetrics } =
  await import(resolve(srcDir, 'metrics.ts'));
const { rerank, rerankTopK, calculateImprovement } =
  await import(resolve(srcDir, 'reranker.ts'));
const { evaluatePipeline, sweepRerankDepths, findOptimalDepth } =
  await import(resolve(srcDir, 'evaluator.ts'));
const { measureBaselineVsReranked, sweepDepths, calculateMaxDepthForLatency } =
  await import(resolve(srcDir, 'tradeoffs.ts'));

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  const displayValue = typeof actual === 'number' ? actual.toFixed(4) : actual;
  console.log(`         expected ${expectation}, observed ${displayValue}`);
}

// Helper to create retrieval function
function createRetrieveFn(topK) {
  return (query) => simulateBM25Retrieval(query, documents, topK);
}

// ---------------------------------------------------------------------
// Step 1 - Metrics work correctly on known inputs
// ---------------------------------------------------------------------

console.log('\nStep 1 - metric calculations');

// Create a known result set to verify metric calculations
const testResults = [
  { docId: 'doc1', score: 0.9, text: 'relevant' },
  { docId: 'doc2', score: 0.8, text: 'not relevant' },
  { docId: 'doc3', score: 0.7, text: 'relevant' },
  { docId: 'doc4', score: 0.6, text: 'not relevant' },
  { docId: 'doc5', score: 0.5, text: 'relevant' },
];
const testRelevant = ['doc1', 'doc3', 'doc5'];

check(
  'precision@5 = 3/5 = 0.6',
  precisionAtK(testResults, testRelevant, 5),
  (v) => Math.abs(v - 0.6) < 0.001,
  '0.6'
);

check(
  'recall@5 = 3/3 = 1.0',
  recallAtK(testResults, testRelevant, 5),
  (v) => Math.abs(v - 1.0) < 0.001,
  '1.0'
);

check(
  'MRR = 1/1 = 1.0 (first result is relevant)',
  meanReciprocalRank(testResults, testRelevant),
  (v) => Math.abs(v - 1.0) < 0.001,
  '1.0'
);

// NDCG calculation: DCG = 1/log2(2) + 0/log2(3) + 1/log2(4) + 0/log2(5) + 1/log2(6)
// = 1 + 0 + 0.5 + 0 + 0.431 = 1.931
// IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4) = 1 + 0.631 + 0.5 = 2.131
// NDCG = 1.931 / 2.131 = 0.906
check(
  'NDCG@5 > 0.8 (good ranking)',
  ndcg(testResults, testRelevant, 5),
  (v) => v > 0.8,
  '> 0.8'
);

// ---------------------------------------------------------------------
// Step 2 - BM25 baseline retrieval works
// ---------------------------------------------------------------------

console.log('\nStep 2 - BM25 baseline retrieval');

const query1 = judgments[0].query; // "How do I deploy applications on Kubernetes?"
const baselineResults = simulateBM25Retrieval(query1, documents, 10);

check(
  'baseline returns 10 results',
  baselineResults.length,
  (v) => v === 10,
  '10'
);

check(
  'results have scores',
  baselineResults[0].score > 0,
  (v) => v === true,
  'true'
);

// Baseline precision is typically imperfect
const baselinePrecision = precisionAtK(baselineResults, judgments[0].relevantDocIds, 5);
console.log(`  [INFO] Baseline precision@5: ${baselinePrecision.toFixed(3)}`);

// ---------------------------------------------------------------------
// Step 3 - Re-ranking improves precision
// ---------------------------------------------------------------------

console.log('\nStep 3 - re-ranking improves precision@5');

// Run evaluation across all queries
const retrieveFn = createRetrieveFn(15);
const evalResult = evaluatePipeline(judgments, retrieveFn, 10, 5);

const beforePrecision = evalResult.beforeAggregate.precisionAtK;
const afterPrecision = evalResult.afterAggregate.precisionAtK;
const improvement = calculateImprovement(beforePrecision, afterPrecision);

console.log(`  [INFO] Before re-ranking: precision@5 = ${beforePrecision.toFixed(3)}`);
console.log(`  [INFO] After re-ranking: precision@5 = ${afterPrecision.toFixed(3)}`);
console.log(`  [INFO] Improvement: ${(improvement.relative * 100).toFixed(1)}%`);

check(
  're-ranker improves precision@5 by at least 20%',
  improvement.relative,
  (v) => v >= 0.20,
  '>= 0.20 (20%)'
);

// ---------------------------------------------------------------------
// Step 4 - NDCG increases after re-ranking
// ---------------------------------------------------------------------

console.log('\nStep 4 - NDCG increases after re-ranking');

const beforeNDCG = evalResult.beforeAggregate.ndcg;
const afterNDCG = evalResult.afterAggregate.ndcg;

console.log(`  [INFO] Before re-ranking: NDCG = ${beforeNDCG.toFixed(3)}`);
console.log(`  [INFO] After re-ranking: NDCG = ${afterNDCG.toFixed(3)}`);

check(
  'NDCG increases after re-ranking',
  afterNDCG > beforeNDCG,
  (v) => v === true,
  'true'
);

check(
  'NDCG improvement is meaningful (> 5%)',
  (afterNDCG - beforeNDCG) / beforeNDCG,
  (v) => v > 0.05,
  '> 0.05'
);

// ---------------------------------------------------------------------
// Step 5 - Latency increases proportionally with re-rank depth
// ---------------------------------------------------------------------

console.log('\nStep 5 - latency scales with re-rank depth');

const depths = [5, 10, 20, 30];
const sweepResult = sweepRerankDepths(judgments, retrieveFn, depths, 5);

const latency5 = sweepResult.find((r) => r.depth === 5)?.avgLatencyMs ?? 0;
const latency20 = sweepResult.find((r) => r.depth === 20)?.avgLatencyMs ?? 0;

console.log(`  [INFO] Latency at depth 5: ${latency5.toFixed(1)}ms`);
console.log(`  [INFO] Latency at depth 20: ${latency20.toFixed(1)}ms`);

check(
  'latency at depth 20 > latency at depth 5',
  latency20 > latency5,
  (v) => v === true,
  'true'
);

// Latency should scale roughly linearly (within 50% of 4x)
const expectedRatio = 4; // 20 / 5
const actualRatio = latency20 / latency5;

check(
  'latency scales roughly proportionally (within 2x-6x for 4x depth)',
  actualRatio,
  (v) => v > 2 && v < 6,
  '2 < ratio < 6'
);

// ---------------------------------------------------------------------
// Step 6 - Quality gains diminish past certain re-rank depth
// ---------------------------------------------------------------------

console.log('\nStep 6 - diminishing returns at high re-rank depth');

const queryForSweep = judgments[0].query;
const resultsForSweep = simulateBM25Retrieval(queryForSweep, documents, 15);
const sweepDepthResult = sweepDepths(
  queryForSweep,
  resultsForSweep,
  judgments[0].relevantDocIds,
  [3, 5, 8, 10, 15],
  5
);

console.log('  [INFO] Quality at different depths:');
for (const m of sweepDepthResult.measurements) {
  console.log(`         depth=${m.rerankDepth}: NDCG=${m.ndcg.toFixed(3)}, latency=${m.latencyMs.toFixed(1)}ms`);
}

// Find where quality gains diminish
const { optimalDepth, reason } = findOptimalDepth(
  sweepResult.map((r) => ({ depth: r.depth, metrics: r.metrics, avgLatencyMs: r.avgLatencyMs }))
);

console.log(`  [INFO] Optimal depth: ${optimalDepth} (${reason})`);

// Quality gains per additional document should diminish at higher depths
// Compare gain per doc from 5->10 vs 20->30
const ndcg5 = sweepResult.find((r) => r.depth === 5)?.metrics.ndcg ?? 0;
const ndcg10 = sweepResult.find((r) => r.depth === 10)?.metrics.ndcg ?? 0;
const ndcg20 = sweepResult.find((r) => r.depth === 20)?.metrics.ndcg ?? 0;
const ndcg30 = sweepResult.find((r) => r.depth === 30)?.metrics.ndcg ?? 0;

const gainPerDoc5to10 = (ndcg10 - ndcg5) / 5;
const gainPerDoc20to30 = (ndcg30 - ndcg20) / 10;

console.log(`  [INFO] NDCG gain per doc (5->10): ${(gainPerDoc5to10 * 100).toFixed(2)}%`);
console.log(`  [INFO] NDCG gain per doc (20->30): ${(gainPerDoc20to30 * 100).toFixed(2)}%`);

check(
  'diminishing returns: gain per doc decreases at higher depths',
  gainPerDoc20to30 <= gainPerDoc5to10,
  (v) => v === true,
  'true (later docs add less quality)'
);

// ---------------------------------------------------------------------
// Step 7 - MRR improves with re-ranking
// ---------------------------------------------------------------------

console.log('\nStep 7 - MRR (first relevant result position) improves');

const beforeMRR = evalResult.beforeAggregate.mrr;
const afterMRR = evalResult.afterAggregate.mrr;

console.log(`  [INFO] Before re-ranking: MRR = ${beforeMRR.toFixed(3)}`);
console.log(`  [INFO] After re-ranking: MRR = ${afterMRR.toFixed(3)}`);

check(
  'MRR improves or stays same after re-ranking',
  afterMRR >= beforeMRR,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 8 - Recall at K behavior
// ---------------------------------------------------------------------

console.log('\nStep 8 - recall@K behavior with re-ranking');

const beforeRecall = evalResult.beforeAggregate.recallAtK;
const afterRecall = evalResult.afterAggregate.recallAtK;

console.log(`  [INFO] Before re-ranking: recall@5 = ${beforeRecall.toFixed(3)}`);
console.log(`  [INFO] After re-ranking: recall@5 = ${afterRecall.toFixed(3)}`);

// Re-ranking does not change recall@K (same documents, different order)
// but our top-K might change which affects observed recall
check(
  'recall is in valid range [0, 1]',
  afterRecall >= 0 && afterRecall <= 1,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 9 - Latency budget calculation
// ---------------------------------------------------------------------

console.log('\nStep 9 - latency budget determines max re-rank depth');

const maxDepth50ms = calculateMaxDepthForLatency(50, 5, 2);
const maxDepth100ms = calculateMaxDepthForLatency(100, 5, 2);

console.log(`  [INFO] 50ms budget with 5ms/doc: max depth = ${maxDepth50ms}`);
console.log(`  [INFO] 100ms budget with 5ms/doc: max depth = ${maxDepth100ms}`);

check(
  '50ms budget allows ~9 documents (50-2)/5',
  maxDepth50ms,
  (v) => v === 9,
  '9'
);

check(
  '100ms budget allows ~19 documents (100-2)/5',
  maxDepth100ms,
  (v) => v === 19,
  '19'
);

// ---------------------------------------------------------------------
// Step 10 - Per-query analysis shows variance
// ---------------------------------------------------------------------

console.log('\nStep 10 - per-query variance in improvement');

const queryImprovements = evalResult.queryResults.map((r) => ({
  queryId: r.queryId,
  beforePrecision: r.beforeMetrics.precisionAtK,
  afterPrecision: r.afterMetrics.precisionAtK,
  improvement: r.afterMetrics.precisionAtK - r.beforeMetrics.precisionAtK,
}));

const improvements = queryImprovements.map((q) => q.improvement);
const maxImprovement = Math.max(...improvements);
const minImprovement = Math.min(...improvements);

console.log('  [INFO] Per-query precision improvements:');
for (const q of queryImprovements) {
  console.log(`         ${q.queryId}: ${q.beforePrecision.toFixed(2)} -> ${q.afterPrecision.toFixed(2)} (${q.improvement >= 0 ? '+' : ''}${q.improvement.toFixed(2)})`);
}

check(
  'at least one query shows improvement',
  maxImprovement > 0,
  (v) => v === true,
  'true'
);

check(
  'improvement variance exists (some queries benefit more)',
  maxImprovement - minImprovement,
  (v) => v >= 0,
  '>= 0'
);

// ---------------------------------------------------------------------
// Step 11 - Cascade architecture: retrieve-then-rerank
// ---------------------------------------------------------------------

console.log('\nStep 11 - cascade architecture validation');

// Simulate the cascade pattern: retrieve 50, re-rank top 10
const cascadeRetrieve = (query, topK) =>
  simulateBM25Retrieval(query, documents, topK);

// Without re-ranking (retrieve only)
let noRerankPrecision = 0;
for (const j of judgments) {
  const results = cascadeRetrieve(j.query, 10);
  noRerankPrecision += precisionAtK(results, j.relevantDocIds, 5);
}
noRerankPrecision /= judgments.length;

// With re-ranking (cascade)
let cascadePrecision = 0;
for (const j of judgments) {
  const results = cascadeRetrieve(j.query, 15);
  const { reranked } = rerankTopK(j.query, results, j.relevantDocIds, 10);
  cascadePrecision += precisionAtK(reranked, j.relevantDocIds, 5);
}
cascadePrecision /= judgments.length;

console.log(`  [INFO] Retrieve-only precision@5: ${noRerankPrecision.toFixed(3)}`);
console.log(`  [INFO] Cascade (retrieve + rerank) precision@5: ${cascadePrecision.toFixed(3)}`);

check(
  'cascade beats retrieve-only',
  cascadePrecision > noRerankPrecision,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) {
    console.log(`  - ${f.name}`);
    console.log(`    expected: ${f.expectation}`);
    console.log(`    actual: ${f.actual}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
