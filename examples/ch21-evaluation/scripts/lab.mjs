// Reproduces every numbered step of the Chapter 21 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch21-evaluation)
//   node examples/ch21-evaluation/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { createSampleDataset, EvalDataset } = await import(
  resolve(srcDir, 'dataset.ts')
);
const { JudgeScorer, computeJudgeCorrelation, DEFAULT_RUBRIC } = await import(
  resolve(srcDir, 'judge.ts')
);
const {
  exactMatch,
  semanticSimilarity,
  computeMetrics,
  aggregateResults,
  computePassRate,
} = await import(resolve(srcDir, 'metrics.ts'));
const {
  detectRegressions,
  pairedTTest,
  isSampleSufficient,
  wilsonConfidenceInterval,
} = await import(resolve(srcDir, 'regression.ts'));
const {
  EvalHarness,
  ModelSimulator,
  formatRegressionReport,
} = await import(resolve(srcDir, 'harness.ts'));

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  console.log(`         expected ${expectation}, observed ${actual}`);
}

// ---------------------------------------------------------------------
// Step 1 - Basic metrics work correctly
// ---------------------------------------------------------------------

console.log('\nStep 1 - basic metrics');

// Exact match should normalize whitespace and case
const exact1 = exactMatch('Paris', 'paris');
check(
  'exact match handles case',
  exact1,
  (v) => v === true,
  'true (case-insensitive match)'
);

const exact2 = exactMatch('  hello  world  ', 'hello world');
check(
  'exact match normalizes whitespace',
  exact2,
  (v) => v === true,
  'true (whitespace normalized)'
);

const exact3 = exactMatch('Paris', 'London');
check(
  'exact match detects difference',
  exact3,
  (v) => v === false,
  'false (different strings)'
);

// Semantic similarity should give high score for similar text
const sem1 = semanticSimilarity('The capital is Paris', 'Paris is the capital');
check(
  'semantic similarity high for same content',
  sem1,
  (v) => v > 0.5,
  '> 0.5 (similar content scores high)'
);

const sem2 = semanticSimilarity('cat dog mouse', 'airplane bicycle train');
check(
  'semantic similarity low for different content',
  sem2,
  (v) => v < 0.2,
  '< 0.2 (different content scores low)'
);

// ---------------------------------------------------------------------
// Step 2 - Judge scoring produces reasonable scores
// ---------------------------------------------------------------------

console.log('\nStep 2 - judge scoring');

const judge = new JudgeScorer(DEFAULT_RUBRIC, 0); // No noise for testing

// Perfect match should score high
const score1 = judge.score('What is 2+2?', '4', '4', 1);
check(
  'judge scores exact match high',
  score1.score,
  (v) => v >= 0.8,
  '>= 0.8 (exact match)'
);

// Partial match should score medium
const score2 = judge.score(
  'What is the capital of France?',
  'Paris',
  'The capital of France is Paris.',
  2
);
check(
  'judge scores partial match medium',
  score2.score,
  (v) => v >= 0.5 && v < 0.95,
  '>= 0.5 and < 0.95 (partial match)'
);

// Wrong answer should score low
const score3 = judge.score(
  'What is the capital of France?',
  'Paris',
  'I am not sure.',
  3
);
check(
  'judge scores wrong answer low',
  score3.score,
  (v) => v < 0.5,
  '< 0.5 (wrong answer)'
);

// ---------------------------------------------------------------------
// Step 3 - Judge correlates with human labels
// ---------------------------------------------------------------------

console.log('\nStep 3 - judge-human correlation');

// Create simulated human labels that the judge should correlate with
const humanLabels = [
  { exampleId: 'ex1', humanScore: 0.9, annotatorId: 'human1', timestamp: 1 },
  { exampleId: 'ex2', humanScore: 0.7, annotatorId: 'human1', timestamp: 2 },
  { exampleId: 'ex3', humanScore: 0.3, annotatorId: 'human1', timestamp: 3 },
  { exampleId: 'ex4', humanScore: 0.5, annotatorId: 'human1', timestamp: 4 },
  { exampleId: 'ex5', humanScore: 0.8, annotatorId: 'human1', timestamp: 5 },
];

// Generate judge scores that correlate with human labels
// (In practice, you'd run the judge on the same examples)
const judgeScores = new Map([
  ['ex1', 0.85], // High human -> high judge
  ['ex2', 0.65], // Medium human -> medium judge
  ['ex3', 0.35], // Low human -> low judge
  ['ex4', 0.45], // Medium human -> medium judge
  ['ex5', 0.75], // High human -> high judge
]);

const correlation = computeJudgeCorrelation(judgeScores, humanLabels, 0.7);

check(
  'pearson correlation positive',
  correlation.pearsonR,
  (v) => v > 0.8,
  '> 0.8 (strong positive correlation)'
);

check(
  'judge is calibrated',
  correlation.isCalibrated,
  (v) => v === true,
  'true (correlation above threshold)'
);

// ---------------------------------------------------------------------
// Step 4 - Regression detection catches quality drops
// ---------------------------------------------------------------------

console.log('\nStep 4 - regression detection');

// Create baseline results (good model)
const baselineResults = [
  { exampleId: 'ex1', metrics: { judgeScore: 0.9 } },
  { exampleId: 'ex2', metrics: { judgeScore: 0.85 } },
  { exampleId: 'ex3', metrics: { judgeScore: 0.88 } },
  { exampleId: 'ex4', metrics: { judgeScore: 0.92 } },
  { exampleId: 'ex5', metrics: { judgeScore: 0.87 } },
  { exampleId: 'ex6', metrics: { judgeScore: 0.91 } },
  { exampleId: 'ex7', metrics: { judgeScore: 0.86 } },
  { exampleId: 'ex8', metrics: { judgeScore: 0.89 } },
  { exampleId: 'ex9', metrics: { judgeScore: 0.84 } },
  { exampleId: 'ex10', metrics: { judgeScore: 0.90 } },
];

// Candidate results (degraded model - noticeable drop)
const degradedResults = [
  { exampleId: 'ex1', metrics: { judgeScore: 0.65 } },
  { exampleId: 'ex2', metrics: { judgeScore: 0.60 } },
  { exampleId: 'ex3', metrics: { judgeScore: 0.68 } },
  { exampleId: 'ex4', metrics: { judgeScore: 0.62 } },
  { exampleId: 'ex5', metrics: { judgeScore: 0.67 } },
  { exampleId: 'ex6', metrics: { judgeScore: 0.61 } },
  { exampleId: 'ex7', metrics: { judgeScore: 0.66 } },
  { exampleId: 'ex8', metrics: { judgeScore: 0.64 } },
  { exampleId: 'ex9', metrics: { judgeScore: 0.59 } },
  { exampleId: 'ex10', metrics: { judgeScore: 0.70 } },
];

const regression = detectRegressions(baselineResults, degradedResults, {
  regressionThreshold: 0.05,
  confidenceLevel: 0.95,
});

check(
  'regression detected for degraded model',
  regression.hasRegression,
  (v) => v === true,
  'true (significant quality drop)'
);

check(
  'overall delta is negative',
  regression.overallDelta,
  (v) => v < -0.15,
  '< -0.15 (candidate worse than baseline)'
);

check(
  'statistical test is significant',
  regression.statisticalSignificance.isSignificant,
  (v) => v === true,
  'true (p-value below alpha)'
);

// No regression for similar model
const similarResults = [
  { exampleId: 'ex1', metrics: { judgeScore: 0.88 } },
  { exampleId: 'ex2', metrics: { judgeScore: 0.87 } },
  { exampleId: 'ex3', metrics: { judgeScore: 0.86 } },
  { exampleId: 'ex4', metrics: { judgeScore: 0.90 } },
  { exampleId: 'ex5', metrics: { judgeScore: 0.89 } },
  { exampleId: 'ex6', metrics: { judgeScore: 0.93 } },
  { exampleId: 'ex7', metrics: { judgeScore: 0.84 } },
  { exampleId: 'ex8', metrics: { judgeScore: 0.91 } },
  { exampleId: 'ex9', metrics: { judgeScore: 0.82 } },
  { exampleId: 'ex10', metrics: { judgeScore: 0.88 } },
];

const noRegression = detectRegressions(baselineResults, similarResults, {
  regressionThreshold: 0.05,
  confidenceLevel: 0.95,
});

check(
  'no regression for similar model',
  noRegression.hasRegression,
  (v) => v === false,
  'false (scores within threshold)'
);

// ---------------------------------------------------------------------
// Step 5 - Harness produces reproducible results
// ---------------------------------------------------------------------

console.log('\nStep 5 - harness reproducibility');

const dataset = createSampleDataset();
const harness = new EvalHarness({ regressionThreshold: 0.05 });

// Run twice with same seed - should get identical results
const model1 = new ModelSimulator('v1.0', 0.95, 12345);
const model2 = new ModelSimulator('v1.0', 0.95, 12345);

const run1 = harness.run(dataset, model1, 'run1');
const run2 = harness.run(dataset, model2, 'run2');

// Check that scores are identical
const scoresMatch = run1.results.every((r, i) =>
  Math.abs(r.metrics.judgeScore - run2.results[i].metrics.judgeScore) < 0.001
);

check(
  'harness produces reproducible scores',
  scoresMatch,
  (v) => v === true,
  'true (same seed gives same results)'
);

check(
  'harness computes summary correctly',
  run1.summary.totalExamples,
  (v) => v === dataset.size(),
  `${dataset.size()} (all examples evaluated)`
);

// ---------------------------------------------------------------------
// Step 6 - End-to-end regression detection with harness
// ---------------------------------------------------------------------

console.log('\nStep 6 - end-to-end regression detection');

// Run baseline with good model
const baselineModel = new ModelSimulator('v1.0', 0.95, 100);
const baselineRun = harness.run(dataset, baselineModel, 'baseline');

// Run candidate with degraded model
const degradedModel = new ModelSimulator('v2.0-degraded', 0.5, 100);
const { regression: e2eRegression } = harness.runWithRegression(
  dataset,
  degradedModel,
  baselineRun.results
);

check(
  'end-to-end catches degraded model',
  e2eRegression.hasRegression,
  (v) => v === true,
  'true (degraded model caught)'
);

// Run candidate with improved model
const improvedModel = new ModelSimulator('v2.0-improved', 0.98, 100);
const { regression: e2eNoRegression } = harness.runWithRegression(
  dataset,
  improvedModel,
  baselineRun.results
);

check(
  'end-to-end passes improved model',
  e2eNoRegression.hasRegression,
  (v) => v === false,
  'false (improved model passes)'
);

// ---------------------------------------------------------------------
// Step 7 - Statistical tests
// ---------------------------------------------------------------------

console.log('\nStep 7 - statistical tests');

// Paired t-test on clearly different samples
const sample1 = [0.9, 0.85, 0.88, 0.92, 0.87, 0.91, 0.86, 0.89, 0.84, 0.90];
const sample2 = [0.65, 0.60, 0.68, 0.62, 0.67, 0.61, 0.66, 0.64, 0.59, 0.70];

const tTestResult = pairedTTest(sample1, sample2, 0.95);

check(
  'paired t-test detects significant difference',
  tTestResult.isSignificant,
  (v) => v === true,
  'true (p < 0.05)'
);

check(
  'p-value is very small',
  tTestResult.pValue,
  (v) => v < 0.01,
  '< 0.01 (highly significant)'
);

// Sample sufficiency check
check(
  'sample size check works',
  isSampleSufficient(5, 20),
  (v) => v === false,
  'false (5 < 20 minimum)'
);

check(
  'sample size check accepts enough',
  isSampleSufficient(25, 20),
  (v) => v === true,
  'true (25 >= 20 minimum)'
);

// Wilson confidence interval
const ci = wilsonConfidenceInterval(7, 10, 0.95);
check(
  'confidence interval bounds are reasonable',
  ci.lower > 0.3 && ci.upper < 1.0 && ci.lower < 0.7 && ci.upper > 0.7,
  (v) => v === true,
  'true (CI contains 0.7 with reasonable bounds)'
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
