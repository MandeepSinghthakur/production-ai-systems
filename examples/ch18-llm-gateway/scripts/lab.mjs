// Reproduces every numbered step of the Chapter 18 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs
//
// Starts the mock provider and gateway itself; nothing else required.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const GW = 'http://localhost:8080';
const PROV = 'http://localhost:8081';

const children = [];
function start(script) {
  const c = spawn('node', [script], { stdio: 'ignore' });
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

function load(args) {
  return new Promise((resolve) => {
    const c = spawn('node', ['src/load.ts', ...args], { stdio: 'ignore' });
    c.on('exit', resolve);
  });
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
for (const port of [8080, 8081]) {
  try {
    await fetch(`http://localhost:${port}/stats`, {
      signal: AbortSignal.timeout(300),
    });
    console.error(
      `port ${port} is already in use — stop the running server first:\n` +
        `  pkill -f 'src/gateway.ts'; pkill -f 'mock-provider/server.ts'`,
    );
    process.exit(1);
  } catch {
    // Nothing listening. This is what we want.
  }
}

start('src/mock-provider/server.ts');
start('src/gateway.ts');
await sleep(1500);

console.log('\nStep 1 - baseline');
await fetch(`${GW}/reset`);
await post(`${PROV}/fault`, { latencyMs: 0, errorRate: 0 });
await load(['--rps', '20', '--duration', '10s']);
let m = await get(`${GW}/metrics`);
check('amplification at rest', m.amplification, (v) => v <= 1.05, '<= 1.05');
check(
  'time_to_first_token p50 (ms)',
  m.time_to_first_token.p50,
  (v) => v < 100,
  '< 100',
);

console.log('\nStep 2 - brownout with naive retry config');
await fetch(`${GW}/reset`);
await post(`${GW}/admin/config`, { retryBudgetRatio: 1.0, maxAttempts: 3 });
await post(`${PROV}/fault`, { latencyMs: 12000, errorRate: 0 });
await load(['--rps', '10', '--duration', '20s']);
m = await get(`${GW}/metrics`);
check('amplification under storm', m.amplification, (v) => v >= 1.8, '>= 1.8');
check(
  'provider error rate stayed zero',
  m.stream_interrupted ?? 0,
  (v) => v === 0,
  '0 (a brownout is latency, not errors)',
);
check('breaker state', m.breaker, (v) => v === 'closed', 'closed (never trips on errors alone)');

console.log('\nStep 3 - latency-aware breaker enabled');
await fetch(`${GW}/reset`);
await post(`${GW}/admin/config`, {
  breaker: { enabled: true, slowCallMs: 3000, minSamples: 20, openForMs: 10000 },
});
await load(['--rps', '10', '--duration', '20s']);
m = await get(`${GW}/metrics`);
check('amplification after shedding', m.amplification, (v) => v <= 1.1, '<= 1.1');
check('requests shed', m.rejected_breaker ?? 0, (v) => v > 50, '> 50');
check('breaker state', m.breaker, (v) => v !== 'closed', 'open or half-open');

console.log('\nStep 4 - accounting survives client disconnect');
await fetch(`${GW}/reset`);
await post(`${GW}/admin/config`, {
  breaker: { enabled: false },
  retryBudgetRatio: 0.1,
});
await post(`${PROV}/fault`, { latencyMs: 0, errorRate: 0 });
await load(['--rps', '5', '--duration', '8s', '--abort-after', '0.15s']);
const led = await get(`${GW}/ledger`);
check('ledger rows for aborted streams', led.totalRecords, (v) => v > 20, '> 20');
check(
  'all rows flagged estimated',
  led.estimatedRecords === led.totalRecords,
  (v) => v === true,
  'true (trailing usage frame never arrived)',
);
check(
  'tokens billed despite disconnect',
  led.byTenant.acme?.out ?? 0,
  (v) => v > 0,
  '> 0 (the provider generated them)',
);

console.log('\nStep 5 - hard budget cap bounds overshoot');
await fetch(`${GW}/reset`);
await load(['--rps', '10', '--duration', '8s', '--tenant', 'externalco']);
m = await get(`${GW}/metrics`);
check('requests rejected on budget', m.rejected_budget ?? 0, (v) => v > 10, '> 10');
check(
  'headroom never went negative',
  m.budget_headroom,
  (v) => v >= 0,
  '>= 0 (reserve-then-reconcile)',
);

// ---------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
shutdown();
process.exit(failed.length === 0 ? 0 : 1);
