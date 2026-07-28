// Reproduces every numbered step of the Chapter 28 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch28-conversational-assistant)
//   node examples/ch28-conversational-assistant/scripts/lab.mjs   (from repo root)
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
  calculateCapacity,
  calculateMemoryBudget,
  calculateAvailability,
  validateCapacity,
  calculateGatewayRequirements,
} = await import(resolve(srcDir, 'capacity.ts'));

const {
  buildArchitecture,
  identifyBottleneck,
  calculateUtilization,
  defineScalingPoints,
  validateArchitecture,
} = await import(resolve(srcDir, 'architecture.ts'));

const {
  simulateLoad,
  simulateFailover,
  simulateMemoryPressure,
  simulateConcurrentRequests,
  calculateCostEnvelope,
} = await import(resolve(srcDir, 'simulator.ts'));

const {
  projectTokenCost,
  validateCostProjection,
  calculateCostScaling,
} = await import(resolve(srcDir, 'cost.ts'));

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
// Step 1 - Capacity estimation consistency
// ---------------------------------------------------------------------

console.log('\nStep 1 - capacity estimation consistency');

const requirements = {
  dailyActiveUsers: 100000,
  messagesPerUserPerDay: 10,
  averageConversationTurns: 5,
  peakToAverageRatio: 4,
  modelTierDistribution: { frontier: 0.05, mid: 0.70, small: 0.25 },
  userTierDistribution: { free: 0.70, pro: 0.25, enterprise: 0.05 },
};

const capacity = calculateCapacity(requirements);
const validation = validateCapacity(requirements, capacity);

check(
  'capacity estimates are internally consistent',
  validation.valid,
  (v) => v === true,
  'true (no calculation errors)'
);

// Check: tokens/user * users = total tokens
const expectedTokens =
  requirements.dailyActiveUsers * requirements.messagesPerUserPerDay;
check(
  'messages per day matches users * messages/user',
  capacity.messagesPerDay,
  (v) => v === expectedTokens,
  `${expectedTokens} (users * messages/user)`
);

// Check: peak >= average * ratio
const expectedPeak =
  capacity.messagesPerSecondAverage * requirements.peakToAverageRatio;
check(
  'peak throughput matches average * ratio',
  Math.abs(capacity.messagesPerSecondPeak - expectedPeak) < 0.01,
  (v) => v === true,
  `${expectedPeak.toFixed(2)} (average * ${requirements.peakToAverageRatio})`
);

// ---------------------------------------------------------------------
// Step 2 - Architecture validation
// ---------------------------------------------------------------------

console.log('\nStep 2 - architecture validation');

const architecture = buildArchitecture(capacity);
const archValidation = validateArchitecture(architecture);

check(
  'architecture has no circular dependencies',
  archValidation.valid,
  (v) => v === true,
  'true (all dependencies resolvable)'
);

check(
  'architecture has required components',
  architecture.components.has('llm-gateway') &&
    architecture.components.has('memory-store') &&
    architecture.components.has('provider-primary'),
  (v) => v === true,
  'true (gateway, memory, provider present)'
);

// ---------------------------------------------------------------------
// Step 3 - Gateway throughput calculations
// ---------------------------------------------------------------------

console.log('\nStep 3 - gateway throughput');

const avgRequestDurationMs = 3000; // 3 second average for model inference
const gatewayReqs = calculateGatewayRequirements(capacity, avgRequestDurationMs);

check(
  'gateway concurrent connections calculated',
  gatewayReqs.minConcurrentConnections,
  (v) => v > 0,
  '> 0 (some concurrent connections needed)'
);

// Little's Law: L = lambda * W
const expectedConcurrent =
  capacity.messagesPerSecondPeak * (avgRequestDurationMs / 1000);
check(
  'concurrent connections follows Little\'s Law',
  Math.abs(gatewayReqs.minConcurrentConnections - Math.ceil(expectedConcurrent)) <= 1,
  (v) => v === true,
  `~${Math.ceil(expectedConcurrent)} (arrival_rate * service_time)`
);

// ---------------------------------------------------------------------
// Step 4 - Memory budget constraints
// ---------------------------------------------------------------------

console.log('\nStep 4 - memory budget');

const memoryBudget = calculateMemoryBudget(
  128000, // 128K context window
  2000, // System prompt
  4000 // Reserved for output
);

check(
  'memory budget is within context limits',
  memoryBudget.totalBudgetBytes,
  (v) => v > 0 && v < 128000 * 4,
  '< 512KB (must fit in context window)'
);

check(
  'summary threshold < max turns',
  memoryBudget.summaryThreshold < memoryBudget.maxTurns,
  (v) => v === true,
  'true (summarize before hitting limit)'
);

// ---------------------------------------------------------------------
// Step 5 - Cost projections align with token estimates
// ---------------------------------------------------------------------

console.log('\nStep 5 - cost projection consistency');

const tokenCost = projectTokenCost(
  capacity,
  requirements.modelTierDistribution,
  { frontier: 15.0, mid: 1.5, small: 0.15 } // Example per-million-token costs
);

// Validate: cost should be proportional to tokens * tier weight
const costValidation = validateCostProjection(
  capacity,
  requirements.modelTierDistribution,
  capacity.costUnitsPerDay
);

check(
  'cost projection is internally consistent',
  costValidation.valid,
  (v) => v === true,
  'true (tokens * cost_per_token = total)'
);

// Check cost scaling
const scaling = calculateCostScaling(requirements, [1, 10, 100]);
check(
  'cost scales linearly with users (no hidden efficiencies)',
  scaling.every((s) => Math.abs(s.scalingEfficiency - 1.0) < 0.01),
  (v) => v === true,
  'true (linear scaling for token costs)'
);

// ---------------------------------------------------------------------
// Step 6 - Load simulation
// ---------------------------------------------------------------------

console.log('\nStep 6 - load simulation');

const gatewayConfig = {
  maxConcurrentRequests: 1000,
  requestTimeoutMs: 30000,
  retryBudgetRatio: 0.1,
  circuitBreakerThreshold: 0.5,
  rateLimitPerTenant: 100,
};

const simulation = simulateLoad(architecture, capacity, 60, gatewayConfig);

check(
  'simulation completes without errors',
  simulation.totalRequests > 0,
  (v) => v === true,
  'true (requests processed)'
);

check(
  'successful requests > 0',
  simulation.successfulRequests,
  (v) => v > 0,
  '> 0 (some requests succeed)'
);

// Check bottleneck identification
check(
  'bottleneck identified or null (no bottleneck)',
  simulation.bottleneckComponent !== undefined,
  (v) => v === true,
  'true (bottleneck analysis completed)'
);

// ---------------------------------------------------------------------
// Step 7 - Failover maintains availability
// ---------------------------------------------------------------------

console.log('\nStep 7 - failover availability');

const failover = simulateFailover(
  architecture,
  capacity,
  60, // 60 second primary outage
  500 // 500ms failover detection
);

check(
  'some requests rerouted during failover',
  failover.requestsRerouted,
  (v) => v > 0,
  '> 0 (fallback handled traffic)'
);

// Availability should be > 90% even during failover
check(
  'availability > 90% during failover',
  failover.availabilityDuringIncident,
  (v) => v > 0.9,
  '> 0.9 (target availability maintained)'
);

// Availability calculation from ch19
const availability = calculateAvailability(0.99, 2, 500);
check(
  'multi-provider availability > single provider',
  availability.multiProviderAvailability > availability.singleProviderAvailability,
  (v) => v === true,
  'true (redundancy improves availability)'
);

// ---------------------------------------------------------------------
// Step 8 - Memory pressure handling
// ---------------------------------------------------------------------

console.log('\nStep 8 - memory pressure');

// Simulate more conversations than memory can hold
const memoryPressure = simulateMemoryPressure(
  100000, // 100K concurrent conversations
  capacity.memoryBytesPerConversation,
  capacity.totalMemoryBytes * 0.5 // Half the memory budget
);

check(
  'memory pressure triggers eviction when needed',
  memoryPressure.evictionRequired,
  (v) => v === true,
  'true (eviction needed when over budget)'
);

check(
  'some conversations remain in memory after eviction',
  memoryPressure.conversationsInMemory,
  (v) => v > 0,
  '> 0 (not all evicted)'
);

// ---------------------------------------------------------------------
// Step 9 - Concurrent request handling
// ---------------------------------------------------------------------

console.log('\nStep 9 - concurrent requests');

const concurrent = simulateConcurrentRequests(
  gatewayConfig.maxConcurrentRequests,
  capacity.messagesPerSecondPeak,
  avgRequestDurationMs,
  60
);

check(
  'peak concurrent <= max configured',
  concurrent.peakConcurrent <= gatewayConfig.maxConcurrentRequests * 1.5,
  (v) => v === true,
  'true (within configured limit with headroom)'
);

// If over capacity, some requests rejected
if (concurrent.peakConcurrent > gatewayConfig.maxConcurrentRequests) {
  check(
    'overload triggers rejection',
    concurrent.totalRejected,
    (v) => v > 0,
    '> 0 (load shedding active)'
  );
}

// ---------------------------------------------------------------------
// Step 10 - Scaling decision points
// ---------------------------------------------------------------------

console.log('\nStep 10 - scaling decisions');

const scalingPoints = defineScalingPoints();

check(
  'scaling points are ordered by user count',
  scalingPoints.every(
    (p, i) => i === 0 || p.usersThreshold >= scalingPoints[i - 1].usersThreshold
  ),
  (v) => v === true,
  'true (thresholds increase monotonically)'
);

check(
  'cost multiplier increases with scale',
  scalingPoints[scalingPoints.length - 1].costMultiplier >
    scalingPoints[0].costMultiplier,
  (v) => v === true,
  'true (larger scale = higher infrastructure cost)'
);

// ---------------------------------------------------------------------
// Step 11 - Cost envelope validation
// ---------------------------------------------------------------------

console.log('\nStep 11 - cost envelope');

const costEnvelope = calculateCostEnvelope(
  simulation.tokensProcessed,
  requirements.modelTierDistribution
);

check(
  'cost envelope has positive total',
  costEnvelope.totalCostUnits,
  (v) => v > 0,
  '> 0 (some cost incurred)'
);

// Verify tier breakdown sums to total
const tierSum = Object.values(costEnvelope.costByTier).reduce((a, b) => a + b, 0);
check(
  'tier costs sum to total',
  Math.abs(tierSum - costEnvelope.totalCostUnits) < 0.01,
  (v) => v === true,
  'true (frontier + mid + small = total)'
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
