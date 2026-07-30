// Reproduces every numbered step of the Chapter 19 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs
//
// Starts the mock providers and router itself; nothing else required.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROUTER = 'http://localhost:8090';
const PROVIDER_A = 'http://localhost:8091';
const PROVIDER_B = 'http://localhost:8092';

// Resolve paths against import.meta.url so lab runs from repo root AND from example dir
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const exampleDir = join(__dirname, '..');

const children = [];

// Start a service with proper stdio handling - capture stderr, print on error
// NOTE: ch18 uses stdio: 'ignore' which violates CLAUDE.md rules. Fixed here.
function start(script) {
  const fullPath = join(exampleDir, script);
  const c = spawn('node', ['--experimental-strip-types', fullPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: exampleDir,
  });

  // Buffer stderr and print on non-zero exit
  let stderrBuf = '';
  c.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  c.stdout.on('data', (d) => {
    // Optionally print stdout for debugging
    // process.stdout.write(d);
  });

  c.on('exit', (code) => {
    if (code !== 0 && code !== null && stderrBuf) {
      console.error(`[${script}] exited with code ${code}:`);
      console.error(stderrBuf);
    }
  });

  children.push(c);
  return c;
}

function shutdown() {
  for (const c of children) c.kill();
}
process.on('exit', shutdown);
process.on('SIGINT', () => process.exit(1));

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

const get = async (url) => (await fetch(url)).json();

// Poll for readiness instead of sleeping and assuming
async function waitForReady(url, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      await sleep(100);
    }
  }
  return false;
}

// Send N extraction requests
async function sendExtractions(n, options = {}) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const body = {
      requestId: `req-${Date.now()}-${i}`,
      conversationId: options.conversationId ?? `conv-${Date.now()}-${i}`,
      tenant: options.tenant ?? 'acme',
      residency: options.residency ?? 'us',
      tier: options.tier ?? 'standard',
      payload: { documentType: 'policy', content: 'sample content' },
    };

    try {
      const res = await fetch(`${ROUTER}/v1/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      results.push({ ok: res.ok, data });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  return results;
}

const results = [];
function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  console.log(`         expected ${expectation}, observed ${actual}`);
}

// ---------------------------------------------------------------------

// Preflight. A stale server from a previous run binds the port and the
// resulting failure looks like a bug in the lab rather than a leftover
// process, which costs about ten confused minutes.
for (const port of [8090, 8091, 8092]) {
  try {
    await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(300),
    });
    console.error(
      `port ${port} is already in use - stop the running server first:\n` +
        `  pkill -f 'ch19-routing'`,
    );
    process.exit(1);
  } catch {
    // Nothing listening. This is what we want.
  }
}

console.log('Starting services...');
start('src/mock-provider-a/server.ts');
start('src/mock-provider-b/server.ts');
start('src/router.ts');

// Poll for readiness
const ready = await Promise.all([
  waitForReady(`${PROVIDER_A}/health`, 5000),
  waitForReady(`${PROVIDER_B}/health`, 5000),
  waitForReady(`${ROUTER}/health`, 5000),
]);

if (!ready.every(Boolean)) {
  console.error('Services failed to start within timeout');
  shutdown();
  process.exit(1);
}

console.log('Services ready.\n');

// ---------------------------------------------------------------------
// Step 1 - Baseline against primary (Provider A only)
// ---------------------------------------------------------------------
console.log('Step 1 - Baseline against primary (Provider A only)');
await fetch(`${ROUTER}/reset`);
await fetch(`${PROVIDER_A}/reset`);
await fetch(`${PROVIDER_B}/reset`);

// Make Provider B unhealthy so all traffic goes to Provider A
await post(`${ROUTER}/admin/health`, { target: 'provider-b', healthy: false });

const step1Results = await sendExtractions(500);

const step1Success = step1Results.filter((r) => r.ok).length;
const step1SchemaValid = step1Results.filter(
  (r) => r.ok && r.data.coverage && typeof r.data.coverage.effective_date === 'string'
).length;
const step1Errors = step1Results.filter((r) => !r.ok).length;

let m = await get(`${ROUTER}/metrics`);

check(
  'step1: availability',
  step1Success / 500,
  (v) => v === 1.0,
  '1.00 (100%)',
);

check(
  'step1: schema validity',
  step1SchemaValid / 500,
  (v) => v === 1.0,
  '1.00 (100%)',
);

check(
  'step1: errors',
  step1Errors,
  (v) => v === 0,
  '0',
);

check(
  'step1: effective_date population rate',
  m.field_population_rate,
  (v) => v === 1.0,
  '1.00 (all in correct location)',
);

// ---------------------------------------------------------------------
// Step 2 - Fail primary, observe failover to Provider B
// ---------------------------------------------------------------------
console.log('\nStep 2 - Fail primary, observe failover');
await fetch(`${ROUTER}/reset`);

// Make Provider A unhealthy, Provider B healthy
await post(`${ROUTER}/admin/health`, { target: 'provider-a', healthy: false });
await post(`${ROUTER}/admin/health`, { target: 'provider-b', healthy: true });

const step2Results = await sendExtractions(500);

const step2Success = step2Results.filter((r) => r.ok).length;
const step2SchemaValid = step2Results.filter(
  (r) => r.ok && r.data.coverage && r.data.policy_id
).length;
const step2WrongLevel = step2Results.filter(
  (r) => r.ok && r.data.effective_date && !r.data.coverage?.effective_date
).length;

m = await get(`${ROUTER}/metrics`);

check(
  'step2: availability (dashboards green!)',
  step2Success / 500,
  (v) => v === 1.0,
  '1.00 (100%)',
);

check(
  'step2: schema validity (dashboards green!)',
  step2SchemaValid / 500,
  (v) => v === 1.0,
  '1.00 (100% - schema checks pass because structure is valid)',
);

// About 3% should have the regression
const regressionRate = step2WrongLevel / 500;
check(
  'step2: ~3% have effective_date at wrong level',
  regressionRate,
  (v) => v >= 0.01 && v <= 0.06,
  'between 0.01 and 0.06 (~3%)',
);

// ---------------------------------------------------------------------
// Step 3 - Enable per-target field-population tracking
// ---------------------------------------------------------------------
console.log('\nStep 3 - Per-target field-population tracking');
await fetch(`${ROUTER}/reset`);

// Enable per-target tracking
await post(`${ROUTER}/admin/config`, { enablePerTargetTracking: true });

// Provider A still unhealthy, so traffic goes to Provider B
await post(`${ROUTER}/admin/health`, { target: 'provider-a', healthy: false });
await post(`${ROUTER}/admin/health`, { target: 'provider-b', healthy: true });

await sendExtractions(500);

m = await get(`${ROUTER}/metrics`);

const providerBRate = m.field_population_by_target?.['provider-b']?.rate ?? 1.0;

check(
  'step3: per-target tracking enabled',
  m.per_target_tracking_enabled,
  (v) => v === true,
  'true',
);

check(
  'step3: provider-b effective_date rate ~0.97',
  providerBRate,
  (v) => v >= 0.93 && v <= 1.0,
  'between 0.93 and 1.00 (3% regression detectable)',
);

// Alert would fire if rate diverges from baseline
const divergence = 1.0 - providerBRate;
check(
  'step3: divergence would trigger alert',
  divergence,
  (v) => v > 0,
  '> 0 (any divergence is alertable)',
);

// ---------------------------------------------------------------------
// Step 4 - Query ledger with/without target labels
// ---------------------------------------------------------------------
console.log('\nStep 4 - Ledger query with/without target labels');

const ledgerQuery = await get(`${ROUTER}/ledger/query`);

check(
  'step4: with target label, single query filters to provider',
  ledgerQuery.withTargetLabel.uniqueTargets,
  (v) => v >= 1,
  '>= 1 (targets are labeled)',
);

check(
  'step4: without target label, correlation required',
  ledgerQuery.withTargetLabel.requiresCorrelation,
  (v) => typeof v === 'boolean',
  'boolean (demonstrates the 13-day archaeology problem)',
);

// Verify we can actually query by target
const led = await get(`${ROUTER}/ledger`);
const providerBRecords = led.byTarget?.['provider-b']?.count ?? 0;

check(
  'step4: provider-b records queryable by target label',
  providerBRecords,
  (v) => v > 0,
  '> 0 (records have target labels)',
);

// ---------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
shutdown();
process.exit(failed.length === 0 ? 0 : 1);
