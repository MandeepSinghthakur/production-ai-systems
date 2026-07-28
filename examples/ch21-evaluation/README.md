# Chapter 21 - Evaluation Pipelines

Demonstrates evaluation pipelines for LLM outputs: LLM-as-judge scoring,
regression detection, statistical significance testing, and human-judge
correlation.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all seven steps with 23 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Evaluation is not a single score. It is a pipeline that:

1. Runs a model against a versioned dataset
2. Scores outputs with a judge (human, model, or heuristic)
3. Aggregates metrics across examples and categories
4. Compares against a baseline for regression detection
5. Tests whether differences are statistically significant

A deployment gate that skips any step will eventually let a regression through.

## Layout

```
src/
  types.ts       Core types: EvalResult, RegressionReport, JudgeCorrelation
  dataset.ts     Eval dataset management and sampling
  metrics.ts     Quality metrics: exact match, semantic similarity
  judge.ts       LLM-as-judge simulation and human correlation
  regression.ts  Regression detection with statistical tests
  harness.ts     Orchestration: dataset + model + judge + regression
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Basic metrics (exact match, semantic similarity) |
| 2 | Judge scoring produces reasonable scores |
| 3 | Judge correlates with human labels |
| 4 | Regression detection catches quality drops |
| 5 | Harness produces reproducible results |
| 6 | End-to-end regression detection with harness |
| 7 | Statistical tests (paired t-test, confidence intervals) |

## Model simulation

We simulate model behavior for testing:

| Quality Factor | Behavior |
| --- | --- |
| >= 0.9 | Returns expected output with minor variations |
| 0.6-0.9 | Sometimes degrades responses |
| < 0.6 | Often returns wrong answers |

## Regression detection criteria

A regression is flagged when all three conditions hold:

1. **Delta exceeds threshold** - Candidate average score is lower than
   baseline by more than the configured threshold (default 5%)
2. **Statistical significance** - Paired t-test p-value is below alpha
   (default 0.05)
3. **Sufficient samples** - Enough matched examples to trust the test

## Judge calibration

Before using LLM-as-judge in production:

1. Collect human labels for a sample of outputs
2. Compute correlation between judge and human scores
3. Only deploy if Pearson r >= 0.7 (or your threshold)

The lab demonstrates this with `computeJudgeCorrelation()`.

## Things worth breaking on purpose

- Set `qualityFactor: 0.3` for a model and observe the regression report
  shows many individual regressions.

- Run with `minSampleSize: 100` and observe the quality gate fails due
  to insufficient samples.

- Change the regression threshold to 0.01 (1%) and observe that even
  small variations trigger regression detection.

- Remove the deterministic seed and observe that results vary between
  runs (this is why we use seeds in tests).
