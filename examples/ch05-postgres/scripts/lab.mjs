// Reproduces every numbered step of the Chapter 5 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch05-postgres)
//   node examples/ch05-postgres/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { ConnectionPool, simulateWithoutPool, simulateWithPool } = await import(
  resolve(srcDir, 'pooling.ts')
);
const {
  IndexAdvisor,
  demonstrateIndexTypeMismatch,
  demonstratePartialIndex,
} = await import(resolve(srcDir, 'indexing.ts'));
const {
  PartitionManager,
  createMonthlyPartitions,
  createTenantPartitions,
  demonstratePruningEffectiveness,
} = await import(resolve(srcDir, 'partitioning.ts'));
const {
  QueryRouter,
  DocumentStore,
  simulateRetrievalPipeline,
  demonstrateJSONBPerformance,
} = await import(resolve(srcDir, 'queries.ts'));

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
// Step 1 - Connection pooling reduces overhead
// ---------------------------------------------------------------------

console.log('\nStep 1 - connection pooling reduces overhead');

// Simulate without pooling: each query pays connection overhead
const withoutPool = await simulateWithoutPool(10, 50, 10); // 10 queries, 50ms connect, 10ms query

// Simulate with pooling: connections are reused
const pool = new ConnectionPool({ maxConnections: 5, minConnections: 2 });
const withPool = await simulateWithPool(pool, 10, 10); // 10 queries, 10ms each

check(
  'pooling reduces total time',
  withPool.totalMs < withoutPool.totalMs,
  (v) => v === true,
  'true (pooled queries skip connection overhead)'
);

check(
  'without pooling pays 50ms per query',
  withoutPool.totalMs,
  (v) => v >= 500, // 10 * (50 + 10) = 600ms minimum
  '>=500ms (connection overhead dominates)'
);

check(
  'pooling completes faster than sequential connection overhead',
  withPool.totalMs,
  (v) => v < 200, // 10 concurrent queries at 10ms each
  '<200ms (parallel execution, no connection overhead)'
);

// ---------------------------------------------------------------------
// Step 2 - Pool handles concurrent requests
// ---------------------------------------------------------------------

console.log('\nStep 2 - pool handles concurrent requests');

const concurrentPool = new ConnectionPool({
  maxConnections: 5,
  minConnections: 2,
  acquireTimeoutMs: 100,
});

// Fire 20 concurrent requests with 5 max connections
const concurrentPromises = [];
for (let i = 0; i < 20; i++) {
  concurrentPromises.push(concurrentPool.query('SELECT 1', 20));
}

const concurrentResults = await Promise.allSettled(concurrentPromises);
const successful = concurrentResults.filter((r) => r.status === 'fulfilled').length;
const stats = concurrentPool.getStats();

check(
  'all 20 requests complete',
  successful,
  (v) => v === 20,
  '20 (pool queues requests when at capacity)'
);

check(
  'pool created connections up to max',
  stats.connectionsCreated,
  (v) => v >= 5,
  '>=5 (scaled up to handle load)'
);

check(
  'connections are reused',
  stats.connectionsCreated < 20,
  (v) => v === true,
  'true (20 queries, fewer than 20 connections created)'
);

// ---------------------------------------------------------------------
// Step 3 - Index type selection
// ---------------------------------------------------------------------

console.log('\nStep 3 - index type selection');

const advisor = new IndexAdvisor();

// Test B-tree index for equality queries
advisor.registerStats('users', {
  rowCount: 1000000,
  avgRowSizeBytes: 200,
  distinctValues: { tenant_id: 100, email: 1000000 },
});

advisor.registerIndexes('users', [
  {
    name: 'idx_users_tenant',
    table: 'users',
    columns: ['tenant_id'],
    type: 'btree',
    isPartial: false,
  },
]);

const tenantQuery = advisor.planQuery({
  table: 'users',
  conditions: [{ column: 'tenant_id', operator: '=', value: 'tenant_1' }],
  selectColumns: ['id', 'email'],
});

check(
  'B-tree index used for equality',
  tenantQuery.indexUsed?.name,
  (v) => v === 'idx_users_tenant',
  '"idx_users_tenant" (B-tree optimal for equality)'
);

check(
  'selectivity reduces estimated rows',
  tenantQuery.estimatedRows < 1000000,
  (v) => v === true,
  'true (index narrows scan)'
);

// Test wrong index type for JSONB
const mismatch = demonstrateIndexTypeMismatch();

check(
  'GIN index has lower cost for JSONB containment',
  mismatch.correct.estimatedCost < mismatch.wrong.estimatedCost,
  (v) => v === true,
  'true (GIN supports @> operator, B-tree does not)'
);

// ---------------------------------------------------------------------
// Step 4 - Partial indexes
// ---------------------------------------------------------------------

console.log('\nStep 4 - partial indexes');

const partialResult = demonstratePartialIndex();

check(
  'partial index has lower cost',
  partialResult.withPartial.estimatedCost < partialResult.withFull.estimatedCost,
  (v) => v === true,
  'true (partial index is smaller, faster to scan)'
);

check(
  'partial index used for matching query',
  partialResult.withPartial.indexUsed?.isPartial,
  (v) => v === true,
  'true (query matches partial predicate)'
);

// ---------------------------------------------------------------------
// Step 5 - Range partitioning by time
// ---------------------------------------------------------------------

console.log('\nStep 5 - range partitioning by time');

const partitionManager = new PartitionManager();
const monthlyPartitions = createMonthlyPartitions(
  'ai_requests',
  'created_at',
  2024,
  1,
  24
);
partitionManager.registerPartitions('ai_requests', monthlyPartitions);

// Route a row
const rowResult = partitionManager.routeRow('ai_requests', {
  partitionKey: new Date(2024, 5, 15), // June 2024
  data: { prompt: 'test', response: 'test' },
});

check(
  'row routed to correct monthly partition',
  rowResult.partitionName,
  (v) => v === 'ai_requests_y2024m06',
  '"ai_requests_y2024m06" (June 2024 partition)'
);

check(
  'routing matched a partition',
  rowResult.matched,
  (v) => v === true,
  'true (partition exists for date)'
);

// Test partition pruning
const pruningResult = partitionManager.prunePartitions('ai_requests', {
  partitionKey: 'created_at',
  operator: '=',
  value: new Date(2024, 11, 15), // December 2024
});

check(
  'partition pruning eliminates most partitions',
  pruningResult.pruningRatio,
  (v) => v > 0.9,
  '>0.90 (only 1 of 24 partitions scanned)'
);

check(
  'only relevant partition scanned',
  pruningResult.scannedPartitions.length,
  (v) => v === 1,
  '1 (single monthly partition for query)'
);

// ---------------------------------------------------------------------
// Step 6 - List partitioning by tenant
// ---------------------------------------------------------------------

console.log('\nStep 6 - list partitioning by tenant');

const tenantManager = new PartitionManager();
const tenantPartitions = createTenantPartitions(
  'documents',
  'tenant_id',
  ['acme', 'globex', 'initech', 'umbrella']
);
tenantManager.registerPartitions('documents', tenantPartitions);

// Route a tenant row
const tenantRowResult = tenantManager.routeRow('documents', {
  partitionKey: 'globex',
  data: { content: 'test document' },
});

check(
  'tenant row routed to tenant partition',
  tenantRowResult.partitionName,
  (v) => v === 'documents_globex',
  '"documents_globex" (tenant-specific partition)'
);

// Tenant query only scans tenant partition
const tenantPruning = tenantManager.prunePartitions('documents', {
  partitionKey: 'tenant_id',
  operator: '=',
  value: 'acme',
});

check(
  'tenant query scans only tenant partition',
  tenantPruning.scannedPartitions.length,
  (v) => v === 1,
  '1 (tenant isolation via partitioning)'
);

// ---------------------------------------------------------------------
// Step 7 - Read replica routing
// ---------------------------------------------------------------------

console.log('\nStep 7 - read replica routing');

const router = new QueryRouter({
  primaryHost: 'primary.db',
  replicaHosts: ['replica1.db', 'replica2.db'],
  replicaLagThresholdMs: 1000,
  loadBalanceStrategy: 'round_robin',
});

// Fresh data request goes to primary
const freshRoute = router.routeRead({
  tenantId: 'tenant_1',
  requestId: 'req_1',
  prompt: 'test',
  tier: 'mid',
  requiresFreshData: true,
  maxLatencyMs: 100,
});

check(
  'fresh data request goes to primary',
  freshRoute.host,
  (v) => v === 'primary.db',
  '"primary.db" (requiresFreshData = true)'
);

check(
  'fresh data not from replica',
  freshRoute.fromReplica,
  (v) => v === false,
  'false (primary used for consistency)'
);

// Normal read can use replica
const normalRoute = router.routeRead({
  tenantId: 'tenant_1',
  requestId: 'req_2',
  prompt: 'test',
  tier: 'mid',
  requiresFreshData: false,
  maxLatencyMs: 100,
});

check(
  'normal read uses replica',
  normalRoute.fromReplica,
  (v) => v === true,
  'true (read replicas handle read-heavy workloads)'
);

// Simulate retrieval pipeline
const pipelineResult = await simulateRetrievalPipeline(
  router,
  Array(10).fill({
    tenantId: 'tenant_1',
    requestId: 'req',
    prompt: 'test',
    tier: 'mid',
    requiresFreshData: false,
    maxLatencyMs: 100,
  }),
  5 // 5 documents per request
);

check(
  'retrieval pipeline uses replicas for document fetches',
  pipelineResult.replicaQueries > pipelineResult.primaryQueries,
  (v) => v === true,
  'true (document fetches offloaded to replicas)'
);

// ---------------------------------------------------------------------
// Step 8 - Replica lag handling
// ---------------------------------------------------------------------

console.log('\nStep 8 - replica lag handling');

const lagRouter = new QueryRouter({
  primaryHost: 'primary.db',
  replicaHosts: ['replica1.db', 'replica2.db'],
  replicaLagThresholdMs: 500,
  loadBalanceStrategy: 'round_robin',
});

// Simulate high lag on both replicas
lagRouter.simulateReplicaLag('replica1.db', 2000);
lagRouter.simulateReplicaLag('replica2.db', 2000);

// Read should fall back to primary
const lagRoute = lagRouter.routeRead({
  tenantId: 'tenant_1',
  requestId: 'req_3',
  prompt: 'test',
  tier: 'mid',
  requiresFreshData: false,
  maxLatencyMs: 100,
});

check(
  'high lag causes fallback to primary',
  lagRoute.host,
  (v) => v === 'primary.db',
  '"primary.db" (replicas exceed lag threshold)'
);

const lagStats = lagRouter.getStats();

check(
  'fallback tracked in stats',
  lagStats.replicaFallbacks,
  (v) => v >= 1,
  '>=1 (fallback event recorded)'
);

// ---------------------------------------------------------------------
// Step 9 - JSONB queries with indexing
// ---------------------------------------------------------------------

console.log('\nStep 9 - JSONB queries with indexing');

const jsonbResult = demonstrateJSONBPerformance(10000);

check(
  'indexed JSONB query is faster',
  jsonbResult.withIndex.durationMs <= jsonbResult.withoutIndex.durationMs,
  (v) => v === true,
  'true (GIN index on JSONB path)'
);

check(
  'both queries return same results',
  jsonbResult.withIndex.rowCount,
  (v) => v === jsonbResult.withoutIndex.rowCount,
  `${jsonbResult.withoutIndex.rowCount} (index returns correct results)`
);

// Test JSONB containment query
const store = new DocumentStore();
for (let i = 0; i < 100; i++) {
  store.insert({
    id: `doc_${i}`,
    tenantId: `tenant_${i % 5}`,
    docType: 'invoice',
    data: {
      status: i % 4 === 0 ? 'pending' : 'completed',
      amount: i * 100,
      metadata: { source: i % 2 === 0 ? 'api' : 'web' },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

const containmentResult = store.queryContains({ status: 'pending' });

check(
  'JSONB containment finds matching documents',
  containmentResult.rowCount,
  (v) => v === 25, // 100 / 4 = 25 pending
  '25 (every 4th document is pending)'
);

// Nested containment
const nestedResult = store.queryContains({ metadata: { source: 'api' } });

check(
  'nested JSONB containment works',
  nestedResult.rowCount,
  (v) => v === 50, // 100 / 2 = 50 from api
  '50 (every 2nd document from api)'
);

// ---------------------------------------------------------------------
// Step 10 - Partition pruning effectiveness
// ---------------------------------------------------------------------

console.log('\nStep 10 - partition pruning effectiveness');

const pruningDemo = demonstratePruningEffectiveness();

check(
  'pruning eliminates most partitions',
  pruningDemo.withPruning.pruningRatio,
  (v) => v > 0.9,
  '>0.90 (23/24 partitions pruned for single-month query)'
);

check(
  'without pruning scans all partitions',
  pruningDemo.withoutPruning.partitionsScanned,
  (v) => v === 24,
  '24 (all partitions scanned)'
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
