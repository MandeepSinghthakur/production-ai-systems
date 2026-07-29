// Reproduces every numbered step of the Chapter 3 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch03-load-balancing)
//   node examples/ch03-load-balancing/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { LoadBalancer } = await import(resolve(srcDir, 'balancer.ts'));
const { HealthChecker } = await import(resolve(srcDir, 'health.ts'));
const { StickySessionManager } = await import(resolve(srcDir, 'sticky.ts'));
const { ConnectionRebalancer } = await import(resolve(srcDir, 'rebalance.ts'));

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
// Step 1 - Round-robin distributes evenly
// ---------------------------------------------------------------------

console.log('\nStep 1 - round-robin distributes evenly');

const rrBalancer = new LoadBalancer({ algorithm: 'round-robin' });
rrBalancer.addBackend('backend-1', 'http://localhost:8001');
rrBalancer.addBackend('backend-2', 'http://localhost:8002');
rrBalancer.addBackend('backend-3', 'http://localhost:8003');

const rrCounts = { 'backend-1': 0, 'backend-2': 0, 'backend-3': 0 };
for (let i = 0; i < 300; i++) {
  const result = rrBalancer.select();
  if (result.backend) {
    rrCounts[result.backend.id]++;
  }
}

check(
  'round-robin backend-1 count',
  rrCounts['backend-1'],
  (v) => v === 100,
  '100 (exactly 1/3 of 300)'
);

check(
  'round-robin backend-2 count',
  rrCounts['backend-2'],
  (v) => v === 100,
  '100 (exactly 1/3 of 300)'
);

check(
  'round-robin backend-3 count',
  rrCounts['backend-3'],
  (v) => v === 100,
  '100 (exactly 1/3 of 300)'
);

// ---------------------------------------------------------------------
// Step 2 - Weighted round-robin respects weights
// ---------------------------------------------------------------------

console.log('\nStep 2 - weighted round-robin respects weights');

const wrrBalancer = new LoadBalancer({ algorithm: 'weighted-round-robin' });
wrrBalancer.addBackend('backend-1', 'http://localhost:8001', 5);
wrrBalancer.addBackend('backend-2', 'http://localhost:8002', 3);
wrrBalancer.addBackend('backend-3', 'http://localhost:8003', 2);

const wrrCounts = { 'backend-1': 0, 'backend-2': 0, 'backend-3': 0 };
for (let i = 0; i < 1000; i++) {
  const result = wrrBalancer.select();
  if (result.backend) {
    wrrCounts[result.backend.id]++;
  }
}

// Weights are 5:3:2, so ratios should be approximately 50%, 30%, 20%
const totalWrr = wrrCounts['backend-1'] + wrrCounts['backend-2'] + wrrCounts['backend-3'];
const ratio1 = wrrCounts['backend-1'] / totalWrr;
const ratio2 = wrrCounts['backend-2'] / totalWrr;
const ratio3 = wrrCounts['backend-3'] / totalWrr;

check(
  'weighted backend-1 ratio ~50%',
  ratio1,
  (v) => v >= 0.45 && v <= 0.55,
  'between 0.45 and 0.55 (weight 5/10)'
);

check(
  'weighted backend-2 ratio ~30%',
  ratio2,
  (v) => v >= 0.25 && v <= 0.35,
  'between 0.25 and 0.35 (weight 3/10)'
);

check(
  'weighted backend-3 ratio ~20%',
  ratio3,
  (v) => v >= 0.15 && v <= 0.25,
  'between 0.15 and 0.25 (weight 2/10)'
);

// ---------------------------------------------------------------------
// Step 3 - Least-connections handles variable latency
// ---------------------------------------------------------------------

console.log('\nStep 3 - least-connections handles variable latency');

const lcBalancer = new LoadBalancer({ algorithm: 'least-connections' });
lcBalancer.addBackend('fast', 'http://localhost:8001');
lcBalancer.addBackend('slow', 'http://localhost:8002');

// Simulate: fast backend completes quickly, slow backend is still busy
// Start 10 connections on each
for (let i = 0; i < 10; i++) {
  const r1 = lcBalancer.select();
  lcBalancer.recordConnectionStart(r1.backend.id);
  const r2 = lcBalancer.select();
  lcBalancer.recordConnectionStart(r2.backend.id);
}

// Fast backend completes 8 connections
for (let i = 0; i < 8; i++) {
  lcBalancer.recordConnectionEnd('fast', 100);
}

// Slow backend completes only 2 connections
for (let i = 0; i < 2; i++) {
  lcBalancer.recordConnectionEnd('slow', 5000);
}

// Now fast has 2 active, slow has 8 active
const fastBackend = lcBalancer.getBackends().find((b) => b.id === 'fast');
const slowBackend = lcBalancer.getBackends().find((b) => b.id === 'slow');

check(
  'fast backend active connections',
  fastBackend.activeConnections,
  (v) => v === 2,
  '2 (started 10, completed 8)'
);

check(
  'slow backend active connections',
  slowBackend.activeConnections,
  (v) => v === 8,
  '8 (started 10, completed 2)'
);

// Next 10 selections should all go to fast
const lcSelections = [];
for (let i = 0; i < 10; i++) {
  const result = lcBalancer.select();
  lcSelections.push(result.backend.id);
  lcBalancer.recordConnectionStart(result.backend.id);
}

const fastSelections = lcSelections.filter((id) => id === 'fast').length;

check(
  'least-connections prefers fast backend',
  fastSelections,
  (v) => v >= 8,
  '>= 8 (fast has fewer connections)'
);

// ---------------------------------------------------------------------
// Step 4 - Health checks detect slow backends
// ---------------------------------------------------------------------

console.log('\nStep 4 - health checks detect slow backends');

const healthChecker = new HealthChecker({
  unhealthyThreshold: 3,
  healthyThreshold: 2,
  slowThresholdMs: 2000,
});

const testBackend = {
  id: 'test-backend',
  address: 'http://localhost:8001',
  weight: 1,
  healthy: true,
  activeConnections: 0,
  totalRequests: 0,
  totalLatencyMs: 0,
  lastHealthCheck: Date.now(),
  consecutiveFailures: 0,
};

healthChecker.register(testBackend);

// Simulate healthy checks
healthChecker.simulateCheck('test-backend', 100, true);
healthChecker.simulateCheck('test-backend', 150, true);

check(
  'backend healthy after good checks',
  healthChecker.isHealthy('test-backend'),
  (v) => v === true,
  'true (consecutive successes)'
);

// Simulate slow checks (still successful but slow)
healthChecker.simulateCheck('test-backend', 3000, true);
healthChecker.simulateCheck('test-backend', 4000, true);

check(
  'backend marked slow after slow responses',
  healthChecker.isSlow('test-backend'),
  (v) => v === true,
  'true (latency > slowThresholdMs)'
);

// Backend is still healthy (not failed, just slow)
check(
  'slow backend still considered healthy',
  healthChecker.isHealthy('test-backend'),
  (v) => v === true,
  'true (slow != unhealthy)'
);

// Simulate failures until unhealthy
healthChecker.simulateCheck('test-backend', 0, false);
healthChecker.simulateCheck('test-backend', 0, false);
healthChecker.simulateCheck('test-backend', 0, false);

check(
  'backend unhealthy after failures',
  healthChecker.isHealthy('test-backend'),
  (v) => v === false,
  'false (3 consecutive failures)'
);

// Recover with healthy checks
healthChecker.simulateCheck('test-backend', 100, true);
healthChecker.simulateCheck('test-backend', 100, true);

check(
  'backend recovers after healthy checks',
  healthChecker.isHealthy('test-backend'),
  (v) => v === true,
  'true (2 consecutive successes)'
);

// ---------------------------------------------------------------------
// Step 5 - Sticky sessions maintain affinity
// ---------------------------------------------------------------------

console.log('\nStep 5 - sticky sessions maintain affinity');

const stickyManager = new StickySessionManager({ ttlMs: 5000 });

const backends = [
  { id: 'backend-1', address: 'http://localhost:8001', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
  { id: 'backend-2', address: 'http://localhost:8002', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
];

backends.forEach((b) => stickyManager.registerBackend(b));

// Create sticky session for tenant-1
const tenant1Key = stickyManager.generateKey('tenant-1');
stickyManager.create(tenant1Key, backends[0]);

// Lookup should return the same backend
const lookup1 = stickyManager.lookup(tenant1Key);

check(
  'sticky session hit on same tenant',
  lookup1.hit,
  (v) => v === true,
  'true (session exists)'
);

check(
  'sticky session returns correct backend',
  lookup1.backend?.id,
  (v) => v === 'backend-1',
  'backend-1 (original assignment)'
);

// Different tenant should not have session
const tenant2Key = stickyManager.generateKey('tenant-2');
const lookup2 = stickyManager.lookup(tenant2Key);

check(
  'no sticky session for new tenant',
  lookup2.hit,
  (v) => v === false,
  'false (no session created yet)'
);

// Mark backend-1 as unhealthy
backends[0].healthy = false;
const lookup3 = stickyManager.lookup(tenant1Key);

check(
  'sticky session signals fallback for unhealthy backend',
  lookup3.fallback,
  (v) => v === true,
  'true (backend is unhealthy)'
);

// Session count
check(
  'session count is 1',
  stickyManager.getSessionCount(),
  (v) => v === 1,
  '1 (only tenant-1 has session)'
);

// ---------------------------------------------------------------------
// Step 6 - Rebalancing preserves in-flight requests
// ---------------------------------------------------------------------

console.log('\nStep 6 - rebalancing preserves in-flight requests');

const rebalancer = new ConnectionRebalancer({
  imbalanceThreshold: 0.2,
  maxMigrationsPerCycle: 5,
});

// Register backends
const rebalanceBackends = [
  { id: 'backend-1', address: 'http://localhost:8001', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
  { id: 'backend-2', address: 'http://localhost:8002', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
];
rebalanceBackends.forEach((b) => rebalancer.registerBackend(b));

// Create imbalanced connections: 10 on backend-1, 2 on backend-2
for (let i = 0; i < 10; i++) {
  rebalancer.addConnection({
    id: `conn-1-${i}`,
    tenantId: `tenant-${i}`,
    backendId: 'backend-1',
    startTime: Date.now(),
    lastActivity: Date.now(),
    requestCount: 1,
    state: 'active',
  });
}
for (let i = 0; i < 2; i++) {
  rebalancer.addConnection({
    id: `conn-2-${i}`,
    tenantId: `tenant-10-${i}`,
    backendId: 'backend-2',
    startTime: Date.now(),
    lastActivity: Date.now(),
    requestCount: 1,
    state: 'active',
  });
}

const imbalanceBefore = rebalancer.calculateImbalance();

check(
  'imbalance detected before rebalance',
  imbalanceBefore,
  (v) => v > 0.2,
  '> 0.2 (10 vs 2 connections)'
);

// Identify migrations
const migrations = rebalancer.identifyMigrations();

check(
  'migrations identified',
  migrations.length,
  (v) => v > 0,
  '> 0 (imbalance exceeds threshold)'
);

check(
  'migrations are from overloaded backend',
  migrations.every((m) => m.from === 'backend-1'),
  (v) => v === true,
  'true (backend-1 is overloaded)'
);

check(
  'migrations target underloaded backend',
  migrations.every((m) => m.to === 'backend-2'),
  (v) => v === true,
  'true (backend-2 is underloaded)'
);

// Execute rebalance
const rebalanceResult = rebalancer.rebalance();

check(
  'rebalance completed migrations',
  rebalanceResult.migrationsCompleted,
  (v) => v > 0,
  '> 0 (some migrations completed)'
);

check(
  'imbalance reduced after rebalance',
  rebalanceResult.imbalanceAfter < rebalanceResult.imbalanceBefore,
  (v) => v === true,
  'true (distribution improved)'
);

// Total connections preserved (not dropped)
const totalAfter = rebalancer.getStats().totalConnections;

check(
  'total connections preserved',
  totalAfter,
  (v) => v === 12,
  '12 (no connections dropped)'
);

// ---------------------------------------------------------------------
// Step 7 - No healthy backends returns null
// ---------------------------------------------------------------------

console.log('\nStep 7 - no healthy backends returns null');

const emptyBalancer = new LoadBalancer();
emptyBalancer.addBackend('backend-1', 'http://localhost:8001');
emptyBalancer.setHealth('backend-1', false);

const emptyResult = emptyBalancer.select();

check(
  'select returns null when no healthy backends',
  emptyResult.backend,
  (v) => v === null,
  'null (all backends unhealthy)'
);

check(
  'select returns reason for failure',
  emptyResult.reason,
  (v) => v === 'no_healthy_backends',
  '"no_healthy_backends"'
);

// ---------------------------------------------------------------------
// Step 8 - Sticky session TTL expiration
// ---------------------------------------------------------------------

console.log('\nStep 8 - sticky session TTL expiration');

const shortTtlManager = new StickySessionManager({ ttlMs: 50 });
const ttlBackend = { id: 'backend-1', address: 'http://localhost:8001', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 };
shortTtlManager.registerBackend(ttlBackend);

const ttlKey = shortTtlManager.generateKey('ttl-tenant');
shortTtlManager.create(ttlKey, ttlBackend);

// Immediate lookup should hit
const ttlLookup1 = shortTtlManager.lookup(ttlKey);

check(
  'session exists before TTL',
  ttlLookup1.hit,
  (v) => v === true,
  'true (within TTL)'
);

// Wait for TTL to expire
await new Promise((resolve) => setTimeout(resolve, 60));

const ttlLookup2 = shortTtlManager.lookup(ttlKey);

check(
  'session expired after TTL',
  ttlLookup2.hit,
  (v) => v === false,
  'false (TTL expired)'
);

// ---------------------------------------------------------------------
// Step 9 - Drain timeout cancels migration
// ---------------------------------------------------------------------

console.log('\nStep 9 - drain timeout cancels migration');

const timeoutRebalancer = new ConnectionRebalancer({
  drainTimeoutMs: 50,
});

const timeoutBackends = [
  { id: 'backend-1', address: 'http://localhost:8001', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
  { id: 'backend-2', address: 'http://localhost:8002', weight: 1, healthy: true, activeConnections: 0, totalRequests: 0, totalLatencyMs: 0, lastHealthCheck: Date.now(), consecutiveFailures: 0 },
];
timeoutBackends.forEach((b) => timeoutRebalancer.registerBackend(b));

timeoutRebalancer.addConnection({
  id: 'timeout-conn',
  tenantId: 'timeout-tenant',
  backendId: 'backend-1',
  startTime: Date.now(),
  lastActivity: Date.now(),
  requestCount: 1,
  state: 'active',
});

// Start drain but don't complete
timeoutRebalancer.startDrain('timeout-conn', 'backend-2');

const connBeforeTimeout = timeoutRebalancer.getConnection('timeout-conn');

check(
  'connection in draining state',
  connBeforeTimeout?.state,
  (v) => v === 'draining',
  '"draining"'
);

// Wait for timeout
await new Promise((resolve) => setTimeout(resolve, 60));

const cancelled = timeoutRebalancer.checkDrainTimeouts();

check(
  'timed out drain cancelled',
  cancelled,
  (v) => v === 1,
  '1 (one drain timed out)'
);

const connAfterTimeout = timeoutRebalancer.getConnection('timeout-conn');

check(
  'connection restored to active after timeout',
  connAfterTimeout?.state,
  (v) => v === 'active',
  '"active" (migration cancelled)'
);

check(
  'connection still on original backend',
  connAfterTimeout?.backendId,
  (v) => v === 'backend-1',
  '"backend-1" (not migrated)'
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
