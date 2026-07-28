// Reproduces every numbered step of the Chapter 31 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch31-multi-tenant)
//   node examples/ch31-multi-tenant/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const {
  DEFAULT_QUOTAS,
  DEFAULT_CUSTOMIZATION,
  TIER_COST_MULTIPLIER,
} = await import(resolve(srcDir, 'types.ts'));

const { TenantRegistry } = await import(resolve(srcDir, 'tenant.ts'));
const { IsolatedDataStore, RequestRouter } = await import(
  resolve(srcDir, 'isolation.ts')
);
const { QuotaManager, NoisyNeighborDetector } = await import(
  resolve(srcDir, 'quota.ts')
);
const { UsageMeter, UsageAggregator } = await import(
  resolve(srcDir, 'metering.ts')
);
const { BillingEngine, CostAllocator } = await import(
  resolve(srcDir, 'billing.ts')
);

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
// Step 1 - Tenant creation and configuration
// ---------------------------------------------------------------------

console.log('\nStep 1 - tenant creation and configuration');

const registry = new TenantRegistry(DEFAULT_QUOTAS, DEFAULT_CUSTOMIZATION);

const tenantA = registry.createTenant('Acme Corp', 'shared', {
  tokensPerDay: 50_000,
  requestsPerSecond: 5,
});

const tenantB = registry.createTenant('Beta Inc', 'dedicated', {
  tokensPerDay: 100_000,
  requestsPerSecond: 20,
});

check(
  'tenants created with unique IDs',
  tenantA.id !== tenantB.id,
  (v) => v === true,
  'true (unique IDs)'
);

check(
  'tenant quotas applied correctly',
  tenantA.quotas.tokensPerDay,
  (v) => v === 50_000,
  '50000 (custom quota)'
);

check(
  'default customization inherited',
  tenantA.customization.defaultTier,
  (v) => v === 'mid',
  'mid (default tier)'
);

// ---------------------------------------------------------------------
// Step 2 - Data isolation verification
// ---------------------------------------------------------------------

console.log('\nStep 2 - data isolation verification');

const dataStore = new IsolatedDataStore();

// Store data for each tenant
const docA = dataStore.store(tenantA.id, 'document', 'Secret Acme data');
const docB = dataStore.store(tenantB.id, 'document', 'Secret Beta data');

// Attempt cross-tenant access
const crossAccessA = dataStore.retrieve(tenantA.id, docB.id);
const crossAccessB = dataStore.retrieve(tenantB.id, docA.id);

check(
  'tenant A cannot access tenant B data',
  crossAccessA,
  (v) => v === null,
  'null (access denied)'
);

check(
  'tenant B cannot access tenant A data',
  crossAccessB,
  (v) => v === null,
  'null (access denied)'
);

// Verify own data is accessible
const ownAccessA = dataStore.retrieve(tenantA.id, docA.id);
const ownAccessB = dataStore.retrieve(tenantB.id, docB.id);

check(
  'tenant A can access own data',
  ownAccessA?.content,
  (v) => v === 'Secret Acme data',
  'Secret Acme data'
);

check(
  'tenant B can access own data',
  ownAccessB?.content,
  (v) => v === 'Secret Beta data',
  'Secret Beta data'
);

// Run formal isolation verification
const isolationResults = dataStore.verifyIsolation(tenantA.id, tenantB.id);
const allIsolated = isolationResults.every((r) => r.isolated);

check(
  'formal isolation verification passes',
  allIsolated,
  (v) => v === true,
  'true (all isolation checks pass)'
);

// ---------------------------------------------------------------------
// Step 3 - Quota enforcement per tenant
// ---------------------------------------------------------------------

console.log('\nStep 3 - quota enforcement per tenant');

const quotaManager = new QuotaManager();

// Simulate requests until rate limit hit
let rateLimitHitA = false;
let requestsBeforeLimit = 0;

for (let i = 0; i < 20; i++) {
  const result = quotaManager.checkQuotas(tenantA, 1000);
  if (!result.allowed && result.reason?.includes('rate_limit')) {
    rateLimitHitA = true;
    break;
  }
  quotaManager.reserve(tenantA.id, `req-${i}`);
  requestsBeforeLimit++;
}

check(
  'rate limit enforced for tenant A',
  rateLimitHitA,
  (v) => v === true,
  'true (rate limit triggered)'
);

check(
  'rate limit matches quota',
  requestsBeforeLimit,
  (v) => v === tenantA.quotas.requestsPerSecond,
  `${tenantA.quotas.requestsPerSecond} (requestsPerSecond)`
);

// Tenant B should have different limit
quotaManager.clear();
let requestsB = 0;
for (let i = 0; i < 25; i++) {
  const result = quotaManager.checkQuotas(tenantB, 1000);
  if (!result.allowed && result.reason?.includes('rate_limit')) {
    break;
  }
  quotaManager.reserve(tenantB.id, `req-b-${i}`);
  requestsB++;
}

check(
  'tenant B has higher rate limit',
  requestsB > requestsBeforeLimit,
  (v) => v === true,
  'true (tenant B quota > tenant A quota)'
);

// ---------------------------------------------------------------------
// Step 4 - Usage metering accuracy
// ---------------------------------------------------------------------

console.log('\nStep 4 - usage metering accuracy');

const meter = new UsageMeter(TIER_COST_MULTIPLIER);

// Record usage for tenant A
meter.record(tenantA.id, 'req-1', 'mid', 500, 200, 1500);
meter.record(tenantA.id, 'req-2', 'mid', 600, 300, 2000);
meter.record(tenantA.id, 'req-3', 'frontier', 1000, 500, 5000);

// Record usage for tenant B
meter.record(tenantB.id, 'req-4', 'mid', 800, 400, 3000);

// Check tenant A metering
const recordsA = meter.getRecords(tenantA.id);
const totalTokensA = recordsA.reduce(
  (sum, r) => sum + r.inputTokens + r.outputTokens,
  0
);

check(
  'usage records created for each request',
  recordsA.length,
  (v) => v === 3,
  '3 (three requests recorded)'
);

check(
  'token counts accurate',
  totalTokensA,
  (v) => v === 500 + 200 + 600 + 300 + 1000 + 500,
  '3100 (sum of all tokens)'
);

// Check tier breakdown
const tierBreakdownA = meter.getTierBreakdown(tenantA.id);

check(
  'mid tier tokens tracked correctly',
  tierBreakdownA.mid.tokens,
  (v) => v === 500 + 200 + 600 + 300,
  '1600 (mid tier total)'
);

check(
  'frontier tier tokens tracked correctly',
  tierBreakdownA.frontier.tokens,
  (v) => v === 1000 + 500,
  '1500 (frontier tier total)'
);

// Verify isolation in metering
const recordsB = meter.getRecords(tenantB.id);

check(
  'metering isolated between tenants',
  recordsB.length,
  (v) => v === 1,
  '1 (only tenant B records)'
);

// ---------------------------------------------------------------------
// Step 5 - Noisy neighbor detection and throttling
// ---------------------------------------------------------------------

console.log('\nStep 5 - noisy neighbor detection');

const noisyDetector = new NoisyNeighborDetector({
  windowMs: 60_000,
  throttleDurationMs: 5_000,
  threshold: 80,
});

// Simulate heavy usage from tenant A (noisy neighbor)
// Each call adds to resource score
const totalTenants = 2;
for (let i = 0; i < 100; i++) {
  noisyDetector.recordUsage(tenantA.id, 10, totalTenants);
}

const isAThrottled = noisyDetector.isThrottled(tenantA.id);
const scoreA = noisyDetector.getScore(tenantA.id);

check(
  'noisy neighbor detected',
  isAThrottled,
  (v) => v === true,
  'true (tenant A throttled for excessive resource use)'
);

check(
  'resource score exceeds threshold',
  scoreA,
  (v) => v >= 80,
  '>= 80 (threshold for throttling)'
);

// Verify tenant B is not affected
const isBThrottled = noisyDetector.isThrottled(tenantB.id);

check(
  'non-noisy tenant not throttled',
  isBThrottled,
  (v) => v === false,
  'false (tenant B unaffected)'
);

// Light usage should not trigger throttling
const tenantC = registry.createTenant('Calm LLC', 'shared');
for (let i = 0; i < 10; i++) {
  noisyDetector.recordUsage(tenantC.id, 1, 3);
}

const isCThrottled = noisyDetector.isThrottled(tenantC.id);

check(
  'light usage does not trigger throttling',
  isCThrottled,
  (v) => v === false,
  'false (normal usage is fine)'
);

// ---------------------------------------------------------------------
// Step 6 - Tenant configuration applied to requests
// ---------------------------------------------------------------------

console.log('\nStep 6 - tenant configuration applied');

// Update tenant to restrict model tiers
registry.updateCustomization(tenantA.id, {
  allowedTiers: ['mid', 'small'],
});

const canUseFrontier = registry.isTierAllowed(tenantA.id, 'frontier');
const canUseMid = registry.isTierAllowed(tenantA.id, 'mid');

check(
  'frontier tier correctly restricted',
  canUseFrontier,
  (v) => v === false,
  'false (frontier not in allowedTiers)'
);

check(
  'mid tier correctly allowed',
  canUseMid,
  (v) => v === true,
  'true (mid in allowedTiers)'
);

// Test tool restrictions
registry.updateCustomization(tenantA.id, {
  allowedTools: ['search', 'calculator'],
});

const canUseSearch = registry.isToolAllowed(tenantA.id, 'search');
const canUseFileSystem = registry.isToolAllowed(tenantA.id, 'filesystem');

check(
  'allowed tool correctly permitted',
  canUseSearch,
  (v) => v === true,
  'true (search in allowedTools)'
);

check(
  'restricted tool correctly denied',
  canUseFileSystem,
  (v) => v === false,
  'false (filesystem not in allowedTools)'
);

// ---------------------------------------------------------------------
// Step 7 - Billing and cost attribution
// ---------------------------------------------------------------------

console.log('\nStep 7 - billing and cost attribution');

const billing = new BillingEngine(TIER_COST_MULTIPLIER);

// Generate usage summary
const now = Date.now();
const periodStart = now - 86400_000; // 24 hours ago
const summaryA = meter.summarize(tenantA.id, periodStart, now);

// Generate invoice
const invoiceA = billing.generateInvoice(tenantA, summaryA);

check(
  'invoice generated with line items',
  invoiceA.lineItems.length,
  (v) => v > 0,
  '> 0 (line items for each tier with usage)'
);

check(
  'invoice total matches usage',
  invoiceA.total,
  (v) => v === meter.computeCost(summaryA),
  `${meter.computeCost(summaryA)} (matches computed cost)`
);

// Verify tier-based pricing
const midItem = invoiceA.lineItems.find((i) => i.tier === 'mid');
const frontierItem = invoiceA.lineItems.find((i) => i.tier === 'frontier');

// Frontier should cost more per token
const midCostPerToken = midItem
  ? midItem.costUnits / midItem.tokens
  : 0;
const frontierCostPerToken = frontierItem
  ? frontierItem.costUnits / frontierItem.tokens
  : 0;

check(
  'frontier costs more than mid per token',
  frontierCostPerToken > midCostPerToken,
  (v) => v === true,
  'true (tier-based pricing applied)'
);

// Test invoice workflow
billing.sendInvoice(invoiceA.id);
const sentInvoice = billing.getInvoice(invoiceA.id);

check(
  'invoice status updated to sent',
  sentInvoice?.status,
  (v) => v === 'sent',
  'sent'
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
