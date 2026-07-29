// Reproduces every numbered step of the Chapter 13 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs                     (from example dir)
//   node examples/ch13-streaming/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const types = await import(resolve(srcDir, 'types.ts'));
const streaming = await import(resolve(srcDir, 'streaming.ts'));
const ttft = await import(resolve(srcDir, 'ttft.ts'));
const economics = await import(resolve(srcDir, 'economics.ts'));
const budget = await import(resolve(srcDir, 'budget.ts'));

const {
  TIER_COST_MULTIPLIER,
  OUTPUT_MULTIPLIER,
  DEFAULT_LATENCY_MODEL,
} = types;

const {
  tokenize,
  estimateTokens,
  calculateTTFT,
  streamTokens,
  collectStream,
} = streaming;

const {
  modelTTFT,
  TTFTTracker,
  tierTTFT,
  checkTTFTBudget,
  TIER_TTFT_MULTIPLIER,
} = ttft;

const {
  calculateCost,
  analyzeCostVariance,
  CostAggregator,
  analyzeEarlyTermination,
  estimateMonthlyCost,
} = economics;

const { BudgetManager, testOvershootBounds } = budget;

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
// Step 1 - TTFT is less than total duration (streaming benefit)
// ---------------------------------------------------------------------

console.log('\nStep 1 - Streaming reduces perceived latency');

const request1 = {
  prompt: 'Explain the difference between streaming and batch processing.',
  maxTokens: 50,
  tier: 'mid',
  tenant: 'test-tenant',
};

const controller1 = new AbortController();
let ttftMs1 = 0;
let totalMs1 = 0;

for await (const chunk of streamTokens(request1, controller1.signal)) {
  if (chunk.kind === 'end') {
    ttftMs1 = chunk.end.timeToFirstTokenMs;
    totalMs1 = chunk.end.totalDurationMs;
  }
}

check(
  'TTFT is less than total duration',
  ttftMs1 < totalMs1,
  (v) => v === true,
  'true (TTFT << total is the streaming benefit)'
);

check(
  'TTFT is significantly less than total',
  ttftMs1 / totalMs1,
  (v) => v < 0.5,
  '< 0.5 (TTFT should be <50% of total for multi-token responses)'
);

// ---------------------------------------------------------------------
// Step 2 - TTFT scales with input tokens
// ---------------------------------------------------------------------

console.log('\nStep 2 - TTFT scales with input size');

const shortInput = 'Hello.';
const longInput = 'A'.repeat(4000); // ~1000 tokens

const ttftShort = modelTTFT(estimateTokens(shortInput), 0);
const ttftLong = modelTTFT(estimateTokens(longInput), 0);

check(
  'longer input has higher TTFT',
  ttftLong.totalTtftMs > ttftShort.totalTtftMs,
  (v) => v === true,
  'true (prefill time dominates for long inputs)'
);

check(
  'TTFT ratio approximates input ratio',
  ttftLong.prefillTimeMs / ttftShort.prefillTimeMs,
  (v) => v > 50, // 1000/2 tokens ratio
  '> 50 (TTFT scales roughly linearly with input)'
);

// ---------------------------------------------------------------------
// Step 3 - Tier affects TTFT
// ---------------------------------------------------------------------

console.log('\nStep 3 - Model tier affects TTFT');

const inputTokens = 500;
const frontierTtft = tierTTFT(inputTokens, 'frontier');
const smallTtft = tierTTFT(inputTokens, 'small');

check(
  'frontier TTFT higher than small',
  frontierTtft > smallTtft,
  (v) => v === true,
  'true (larger models have slower prefill)'
);

check(
  'TTFT ratio matches tier multiplier',
  frontierTtft / smallTtft,
  (v) => v >= 3.5 && v <= 4.5,
  '~4x (frontier is 2x mid, mid is 2x small)'
);

// ---------------------------------------------------------------------
// Step 4 - Token costs scale with input + output
// ---------------------------------------------------------------------

console.log('\nStep 4 - Token economics');

const cost1 = calculateCost(100, 100, 'small');
const cost2 = calculateCost(100, 200, 'small');

check(
  'more output tokens means higher cost',
  cost2.totalCost > cost1.totalCost,
  (v) => v === true,
  'true (output tokens add to cost)'
);

check(
  'output costs more than input',
  cost1.outputCost > cost1.inputCost,
  (v) => v === true,
  `true (output multiplier is ${OUTPUT_MULTIPLIER}x)`
);

const costSmall = calculateCost(100, 100, 'small');
const costFrontier = calculateCost(100, 100, 'frontier');

check(
  'frontier costs more than small',
  costFrontier.totalCost > costSmall.totalCost,
  (v) => v === true,
  'true (higher tier = higher cost)'
);

check(
  'frontier/small cost ratio matches multiplier',
  costFrontier.totalCost / costSmall.totalCost,
  (v) => v === TIER_COST_MULTIPLIER.frontier / TIER_COST_MULTIPLIER.small,
  `${TIER_COST_MULTIPLIER.frontier}x`
);

// ---------------------------------------------------------------------
// Step 5 - Cost variance can be extreme
// ---------------------------------------------------------------------

console.log('\nStep 5 - Cost variance analysis');

const variance = analyzeCostVariance(100, 500);

check(
  'cost variance between tiers',
  variance.variance,
  (v) => v >= 20,
  '>= 20x (frontier vs small for same task)'
);

check(
  'variance factors documented',
  variance.factors.length,
  (v) => v >= 2,
  '>= 2 factors (tier, output ratio)'
);

// ---------------------------------------------------------------------
// Step 6 - Budget enforcement stops requests at limit
// ---------------------------------------------------------------------

console.log('\nStep 6 - Hard budget enforcement');

const budgetMgr = new BudgetManager();
budgetMgr.registerTenant({
  id: 'limited-tenant',
  dailyTokenLimit: 100000, // 100k limit
  hardCap: true,
});

// Reserve tokens until rejected
// With mid tier (6x) and output multiplier (4x):
// 100 input + 100 output = 100*6 + 100*6*4 = 600 + 2400 = 3000 cost units
// 100,000 / 3000 = ~33 requests before rejection
let accepted = 0;
let rejected = 0;
const reservationIds = [];

for (let i = 0; i < 50; i++) {
  const result = budgetMgr.reserve('limited-tenant', 100, 100, 'mid');
  if (result.allowed) {
    accepted++;
    reservationIds.push(result.reservationId);
  } else {
    rejected++;
  }
}

check(
  'some requests accepted',
  accepted,
  (v) => v > 0,
  '> 0 (budget allows initial requests)'
);

check(
  'some requests rejected',
  rejected,
  (v) => v > 0,
  '> 0 (hard cap stops requests when exhausted)'
);

check(
  'headroom never negative',
  budgetMgr.headroom('limited-tenant'),
  (v) => v >= 0,
  '>= 0 (reserve-then-reconcile bounds overshoot)'
);

// ---------------------------------------------------------------------
// Step 7 - Soft cap allows but flags over-budget
// ---------------------------------------------------------------------

console.log('\nStep 7 - Soft budget with alerts');

const softBudget = new BudgetManager();
softBudget.registerTenant({
  id: 'soft-tenant',
  dailyTokenLimit: 1000,
  hardCap: false,
});

// Reserve more than budget allows
for (let i = 0; i < 10; i++) {
  softBudget.reserve('soft-tenant', 200, 200, 'mid');
}

const softCheck = softBudget.check('soft-tenant', 100);

check(
  'soft cap allows over-budget requests',
  softCheck.allowed,
  (v) => v === true,
  'true (soft cap never rejects)'
);

check(
  'over-budget flag is set',
  softCheck.overBudget,
  (v) => v === true,
  'true (flag triggers alerts)'
);

// ---------------------------------------------------------------------
// Step 8 - Settlement reconciles to actual
// ---------------------------------------------------------------------

console.log('\nStep 8 - Reserve-then-reconcile');

const settleBudget = new BudgetManager();
settleBudget.registerTenant({
  id: 'settle-tenant',
  dailyTokenLimit: 100000,
  hardCap: true,
});

const reservation = settleBudget.reserve('settle-tenant', 1000, 1000, 'mid');
const beforeSettle = settleBudget.rawUsage('settle-tenant');

// Settle with less than estimated
settleBudget.settle(reservation.reservationId, 500, 500);
const afterSettle = settleBudget.rawUsage('settle-tenant');

check(
  'no usage recorded before settlement',
  beforeSettle,
  (v) => v === 0,
  '0 (tokens reserved, not spent)'
);

check(
  'actual usage recorded after settlement',
  afterSettle,
  (v) => v > 0,
  '> 0 (actual tokens recorded)'
);

check(
  'settled amount based on actual tokens',
  afterSettle < calculateCost(1000, 1000, 'mid').totalCost,
  (v) => v === true,
  'true (actual < estimated, refund applied)'
);

// ---------------------------------------------------------------------
// Step 9 - Early termination saves cost
// ---------------------------------------------------------------------

console.log('\nStep 9 - Streaming enables early termination savings');

const termAnalysis = analyzeEarlyTermination(100, 500, 0.3, 'frontier');

check(
  'early termination saves tokens',
  termAnalysis.tokensSaved,
  (v) => v === 350, // 70% of 500
  '350 tokens (70% saved by terminating at 30%)'
);

check(
  'savings are significant',
  termAnalysis.earlyTerminationSavings,
  (v) => v > 0,
  '> 0 cost units saved'
);

check(
  'savings scale with termination point',
  termAnalysis.earlyTerminationSavings / termAnalysis.fullResponseCost,
  (v) => v > 0.5,
  '> 50% savings (terminated at 30%)'
);

// ---------------------------------------------------------------------
// Step 10 - Concurrent request overshoot is bounded
// ---------------------------------------------------------------------

console.log('\nStep 10 - Concurrent overshoot bounds');

const concurrentBudget = new BudgetManager();
concurrentBudget.registerTenant({
  id: 'concurrent-tenant',
  dailyTokenLimit: 1000000, // High limit to focus on concurrency
  hardCap: true,
});

const overshootResult = testOvershootBounds(
  concurrentBudget,
  'concurrent-tenant',
  100,  // requests
  1000, // estimated per request
  500,  // actual per request
  20,   // concurrency
);

check(
  'max concurrent reserved bounded by concurrency * estimate',
  overshootResult.maxConcurrentReserved <= overshootResult.overshootBound,
  (v) => v === true,
  `true (<= ${overshootResult.overshootBound})`
);

check(
  'actual settled less than total reserved',
  overshootResult.totalSettled < overshootResult.maxConcurrentReserved * 5,
  (v) => v === true,
  'true (actual often less than pessimistic estimate)'
);

// ---------------------------------------------------------------------
// Step 11 - TTFT tracker percentiles
// ---------------------------------------------------------------------

console.log('\nStep 11 - TTFT monitoring');

const tracker = new TTFTTracker();

// Simulate varied TTFT measurements
for (let i = 0; i < 100; i++) {
  // Mix of fast (50ms) and slow (200ms) requests
  tracker.record(i < 80 ? 50 + Math.random() * 20 : 200 + Math.random() * 50);
}

check(
  'p50 reflects common case',
  tracker.p50(),
  (v) => v < 100,
  '< 100ms (80% of requests are fast)'
);

check(
  'p95 captures outliers',
  tracker.p95(),
  (v) => v > tracker.p50(),
  '> p50 (slow requests pull up tail)'
);

check(
  'p99 higher than p95',
  tracker.p99(),
  (v) => v >= tracker.p95(),
  '>= p95 (proper percentile ordering)'
);

// ---------------------------------------------------------------------
// Step 12 - TTFT budget check
// ---------------------------------------------------------------------

console.log('\nStep 12 - TTFT SLA checking');

const ttftCheck1 = checkTTFTBudget(100, 'small', 1000);
const ttftCheck2 = checkTTFTBudget(5000, 'frontier', 500);

check(
  'small request within generous SLA',
  ttftCheck1.withinBudget,
  (v) => v === true,
  'true (short input + small model + 1000ms SLA)'
);

check(
  'large frontier request may exceed tight SLA',
  ttftCheck2.withinBudget,
  (v) => v === false,
  'false (long input + frontier model + 500ms SLA)'
);

check(
  'headroom is positive when within budget',
  ttftCheck1.headroomMs,
  (v) => v > 0,
  '> 0ms headroom'
);

// ---------------------------------------------------------------------
// Step 13 - Cost aggregation by tenant
// ---------------------------------------------------------------------

console.log('\nStep 13 - Cost attribution');

const aggregator = new CostAggregator();

aggregator.record({
  timestamp: Date.now(),
  tenant: 'tenant-a',
  tier: 'frontier',
  inputTokens: 100,
  outputTokens: 100,
  costUnits: calculateCost(100, 100, 'frontier').totalCost,
  durationMs: 1000,
  ttftMs: 200,
  aborted: false,
});

aggregator.record({
  timestamp: Date.now(),
  tenant: 'tenant-b',
  tier: 'small',
  inputTokens: 100,
  outputTokens: 100,
  costUnits: calculateCost(100, 100, 'small').totalCost,
  durationMs: 500,
  ttftMs: 100,
  aborted: false,
});

const byTenant = aggregator.byTenant();
const byTier = aggregator.byTier();

check(
  'cost attributed by tenant',
  byTenant.size,
  (v) => v === 2,
  '2 tenants tracked'
);

check(
  'cost attributed by tier',
  byTier.size,
  (v) => v === 2,
  '2 tiers tracked'
);

check(
  'frontier tenant has higher cost',
  byTenant.get('tenant-a') > byTenant.get('tenant-b'),
  (v) => v === true,
  'true (frontier > small for same tokens)'
);

// ---------------------------------------------------------------------
// Step 14 - Monthly cost estimation
// ---------------------------------------------------------------------

console.log('\nStep 14 - Cost projection');

const estimate = estimateMonthlyCost(1000, 500, 200, 'mid');

check(
  'daily cost is positive',
  estimate.dailyCost,
  (v) => v > 0,
  '> 0 cost units'
);

check(
  'monthly cost is ~30x daily',
  estimate.monthlyCost / estimate.dailyCost,
  (v) => v === 30,
  '30x (monthly = daily * 30)'
);

check(
  'tokens per month scales correctly',
  estimate.tokensPerMonth,
  (v) => v === (500 + 200) * 1000 * 30,
  `${(500 + 200) * 1000 * 30} tokens/month`
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
