// Reproduces every numbered step of the Chapter 23 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch23-cost-control)
//   node examples/ch23-cost-control/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { TIER_COST_MULTIPLIER } = await import(resolve(srcDir, 'types.ts'));
const { BudgetManager } = await import(resolve(srcDir, 'budget.ts'));
const { BudgetForecaster } = await import(resolve(srcDir, 'forecaster.ts'));
const { CostAllocator } = await import(resolve(srcDir, 'allocator.ts'));
const {
  simulateSequential,
  simulateConcurrent,
  simulateMixedTiers,
  simulateSpendingOverTime,
} = await import(resolve(srcDir, 'simulator.ts'));

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
// Step 1 - Hard budget enforcement
// ---------------------------------------------------------------------

console.log('\nStep 1 - hard budget enforcement');

const budgetHard = new BudgetManager(TIER_COST_MULTIPLIER);
budgetHard.registerTenant({
  id: 'tenant-a',
  tokenLimit: 10_000,
  capType: 'hard',
});

// Send requests until rejected. Each request estimates 2000 tokens.
// With 10,000 limit, we should get 5 accepted and then rejections.
const hardResult = simulateSequential(budgetHard, {
  tenant: 'tenant-a',
  count: 10,
  estimatedTokens: 2000,
  actualTokens: 1800, // Actual is less than estimate (common case)
});

check(
  'requests rejected when budget exhausted',
  hardResult.rejectedRequests,
  (v) => v > 0,
  '> 0 (some requests rejected after budget exhausted)'
);

check(
  'headroom never goes negative',
  budgetHard.headroom('tenant-a'),
  (v) => v >= 0,
  '>= 0 (reserve-then-reconcile bounds overshoot)'
);

// ---------------------------------------------------------------------
// Step 2 - Soft budget alerts
// ---------------------------------------------------------------------

console.log('\nStep 2 - soft budget alerts');

const budgetSoft = new BudgetManager(TIER_COST_MULTIPLIER);
budgetSoft.registerTenant({
  id: 'tenant-b',
  tokenLimit: 10_000,
  capType: 'soft',
});

// Send more requests than budget allows. Soft cap should accept all.
const softResult = simulateSequential(budgetSoft, {
  tenant: 'tenant-b',
  count: 10,
  estimatedTokens: 2000,
  actualTokens: 2000,
});

check(
  'soft cap accepts all requests',
  softResult.rejectedRequests,
  (v) => v === 0,
  '0 (soft cap allows over-budget requests)'
);

check(
  'over-budget flag is set',
  budgetSoft.isOverBudget('tenant-b'),
  (v) => v === true,
  'true (flag set when spending exceeds limit)'
);

// ---------------------------------------------------------------------
// Step 3 - Reserve-then-reconcile accuracy
// ---------------------------------------------------------------------

console.log('\nStep 3 - reserve-then-reconcile accuracy');

const budgetReconcile = new BudgetManager(TIER_COST_MULTIPLIER);
budgetReconcile.registerTenant({
  id: 'tenant-c',
  tokenLimit: 100_000,
  capType: 'hard',
});

// Reserve with pessimistic estimate, settle with actual (lower)
const reservation = budgetReconcile.reserve('tenant-c', 5000, 'mid');
const beforeSettle = budgetReconcile.getAccount('tenant-c');
const reservedBefore = beforeSettle?.reservedTokens ?? 0;

const settlement = budgetReconcile.settle(reservation.reservationId, 3000);
const afterSettle = budgetReconcile.getAccount('tenant-c');

check(
  'settled amount matches actual',
  afterSettle?.spentTokens,
  (v) => v === 3000,
  '3000 (actual tokens recorded)'
);

check(
  'reserved amount released correctly',
  afterSettle?.reservedTokens,
  (v) => v === 0,
  '0 (reservation fully released)'
);

// ---------------------------------------------------------------------
// Step 4 - Concurrent request overshoot bound
// ---------------------------------------------------------------------

console.log('\nStep 4 - concurrent request overshoot bound');

const budgetConcurrent = new BudgetManager(TIER_COST_MULTIPLIER);
budgetConcurrent.registerTenant({
  id: 'tenant-d',
  tokenLimit: 100_000,
  capType: 'hard',
});

// Simulate concurrent requests: all reserve before any settle
// Each reserves 1000, but actually uses only 500
const concurrentResult = simulateConcurrent(budgetConcurrent, {
  tenant: 'tenant-d',
  count: 20,
  estimatedTokens: 1000,
  actualTokens: 500,
  concurrency: 20, // All 20 in flight at once
});

// Max reserved should be bounded by concurrency * estimate
check(
  'total reserved bounded by concurrency * max',
  concurrentResult.maxConcurrentReserved,
  (v) => v <= 20 * 1000,
  '<= 20000 (bounded by concurrency * per-request max)'
);

// Actual spend should be much lower than reserved
check(
  'actual spend lower than reserved',
  concurrentResult.totalActual < concurrentResult.totalReserved,
  (v) => v === true,
  'true (actual often less than pessimistic estimate)'
);

// ---------------------------------------------------------------------
// Step 5 - Budget forecasting
// ---------------------------------------------------------------------

console.log('\nStep 5 - budget forecasting');

const forecaster = new BudgetForecaster({
  windowMs: 60_000, // 60 second window
  urgencyThresholdSeconds: 300, // Alert if < 5 min remaining
});

// Simulate spending: 1000 tokens every 10 seconds over 60 seconds
// That's 6 events * 1000 = 6000 tokens in 60 seconds = 100 tokens/sec
const startTime = Date.now() - 60_000; // Start 60 seconds ago
simulateSpendingOverTime(
  forecaster,
  'tenant-e',
  'chat',
  'mid',
  1000,
  6,
  10_000,
  startTime
);

const burnRate = forecaster.getBurnRate('tenant-e');

// With 6000 tokens in 60 seconds, burn rate should be 100/sec
check(
  'burn rate calculation correct',
  burnRate,
  (v) => v >= 90 && v <= 110, // Allow some tolerance
  '~100 tokens/sec (6000 tokens / 60 seconds)'
);

// Forecast: if we have 50,000 tokens remaining at 100/sec, ~500 seconds
const forecast = forecaster.forecast('tenant-e', 50_000, 100_000);

check(
  'forecast is reasonable given burn rate',
  forecast.secondsUntilExhaustion,
  (v) => v !== null && v > 0 && v < 1000,
  '~500 seconds (50,000 remaining / 100 per sec)'
);

// Urgency check: 500 seconds > 300 threshold, so not urgent
check(
  'urgency alert triggers when appropriate',
  forecast.isUrgent,
  (v) => v === false,
  'false (500s > 300s threshold, not yet urgent)'
);

// ---------------------------------------------------------------------
// Step 6 - Multi-tier cost tracking
// ---------------------------------------------------------------------

console.log('\nStep 6 - multi-tier cost tracking');

const allocator = new CostAllocator(TIER_COST_MULTIPLIER);

// Same token count across tiers
simulateMixedTiers(allocator, 'tenant-f', 'analysis', [
  { tier: 'frontier', tokens: 1000 },
  { tier: 'mid', tokens: 1000 },
  { tier: 'small', tokens: 1000 },
]);

const attribution = allocator.getAttribution();

// Frontier should cost more than mid, mid more than small
check(
  'frontier costs more per token than mid',
  attribution.byTier.frontier.costUnits > attribution.byTier.mid.costUnits,
  (v) => v === true,
  'true (frontier multiplier > mid multiplier)'
);

check(
  'tier attribution is correct',
  attribution.byTier.frontier.tokens === 1000 &&
    attribution.byTier.mid.tokens === 1000 &&
    attribution.byTier.small.tokens === 1000,
  (v) => v === true,
  'true (each tier has 1000 tokens)'
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
