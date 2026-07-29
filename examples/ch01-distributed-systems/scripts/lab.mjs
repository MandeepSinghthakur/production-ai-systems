// Reproduces every numbered step of the Chapter 1 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch01-distributed-systems)
//   node examples/ch01-distributed-systems/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { ConsistencySimulator, demonstrateCAPTradeoff } = await import(
  resolve(srcDir, 'consistency.ts')
);
const {
  ExponentialBackoff,
  PhiAccrualFailureDetector,
  SimpleFailureDetector,
  LLMTimeoutStrategy,
  CircuitBreaker,
  executeWithTimeout,
} = await import(resolve(srcDir, 'failures.ts'));
const {
  TokenCapacityPlanner,
  RequestCapacityPlanner,
  demonstrateCapacityDifference,
  compareRequestSizeThroughput,
  QueueModel,
} = await import(resolve(srcDir, 'capacity.ts'));
const {
  LogNormalDistribution,
  simulateLatencyDistribution,
  compareLatencyProfiles,
  recommendTimeout,
  simulateTimeoutImpact,
} = await import(resolve(srcDir, 'latency.ts'));

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
// Step 1 - Eventual consistency converges
// ---------------------------------------------------------------------

console.log('\nStep 1 - eventual consistency converges');

const simulator1 = new ConsistencySimulator(3, 50);

// Write with eventual consistency
const writeResult = simulator1.writeEventual('key1', 'value1');
check(
  'eventual write succeeds immediately',
  writeResult.success,
  (v) => v === true,
  'true (one ack is enough)'
);

check(
  'eventual write acks one node',
  writeResult.nodesAcked,
  (v) => v === 1,
  '1 (primary only)'
);

// Initially not converged
const beforeReplication = simulator1.checkConvergence('key1');
check(
  'not converged before replication',
  beforeReplication.converged,
  (v) => v === false,
  'false (secondaries have not received write)'
);

// Wait for replication
await new Promise((r) => setTimeout(r, 100));
simulator1.simulateReplication();

// Now converged
const afterReplication = simulator1.checkConvergence('key1');
check(
  'converged after replication',
  afterReplication.converged,
  (v) => v === true,
  'true (all nodes have the value)'
);

// ---------------------------------------------------------------------
// Step 2 - Strong consistency blocks until majority
// ---------------------------------------------------------------------

console.log('\nStep 2 - strong consistency blocks until majority');

const simulator2 = new ConsistencySimulator(3, 50);

const strongResult = simulator2.writeStrong('key2', 'value2');
check(
  'strong write succeeds',
  strongResult.success,
  (v) => v === true,
  'true (majority acked)'
);

check(
  'strong write acks majority',
  strongResult.nodesAcked,
  (v) => v >= 2,
  '>=2 (majority of 3)'
);

check(
  'strong write has higher latency',
  strongResult.latencyMs,
  (v) => v > writeResult.latencyMs,
  `>${writeResult.latencyMs}ms (waits for multiple nodes)`
);

// Read with strong consistency sees the value immediately
const strongRead = simulator2.read('key2', 'strong');
check(
  'strong read sees value immediately',
  strongRead.value,
  (v) => v === 'value2',
  '"value2" (no staleness)'
);

check(
  'strong read has zero staleness',
  strongRead.staleness,
  (v) => v === 0,
  '0 (guaranteed fresh)'
);

// ---------------------------------------------------------------------
// Step 3 - CAP theorem during partition
// ---------------------------------------------------------------------

console.log('\nStep 3 - CAP theorem during partition');

const simulator3 = new ConsistencySimulator(3, 50);
const capResult = demonstrateCAPTradeoff(simulator3, 'capKey', 'capValue');

check(
  'strong write fails during partition (CP)',
  capResult.cpResult.success,
  (v) => v === false,
  'false (cannot reach majority)'
);

check(
  'eventual read succeeds during partition (AP)',
  capResult.apResult.value,
  (v) => v === 'capValue',
  '"capValue" (local read succeeds)'
);

// ---------------------------------------------------------------------
// Step 4 - Exponential backoff with jitter
// ---------------------------------------------------------------------

console.log('\nStep 4 - exponential backoff with jitter');

const backoff = new ExponentialBackoff({
  initialMs: 100,
  maxMs: 5000,
  multiplier: 2,
  jitterRatio: 0.2,
});

const timeouts = [];
for (let i = 0; i < 5; i++) {
  timeouts.push(backoff.nextTimeout());
}

check(
  'timeouts increase exponentially',
  timeouts[2] > timeouts[1] && timeouts[1] > timeouts[0],
  (v) => v === true,
  'true (exponential growth)'
);

check(
  'timeouts capped at max',
  Math.max(...timeouts),
  (v) => v <= 6000, // max + jitter
  '<=6000 (max + jitter)'
);

// Jitter adds variance - not all same
const uniqueTimeouts = new Set(timeouts.map((t) => Math.round(t / 10)));
check(
  'jitter adds variance',
  uniqueTimeouts.size,
  (v) => v >= 3,
  '>=3 unique values (jitter working)'
);

// ---------------------------------------------------------------------
// Step 5 - Phi accrual failure detection
// ---------------------------------------------------------------------

console.log('\nStep 5 - phi accrual failure detection');

const phiDetector = new PhiAccrualFailureDetector({
  heartbeatIntervalMs: 100,
  phiThreshold: 8,
});

// Simulate healthy heartbeats
for (let i = 0; i < 20; i++) {
  phiDetector.recordHeartbeat('node-a');
  await new Promise((r) => setTimeout(r, 10));
}

const healthyResult = phiDetector.getNodeHealth('node-a');
check(
  'healthy node has low phi',
  healthyResult.phi,
  (v) => v < 4,
  '<4 (well below threshold)'
);

check(
  'healthy node status is healthy',
  healthyResult.status,
  (v) => v === 'healthy',
  '"healthy"'
);

// Wait without heartbeat to simulate failure
await new Promise((r) => setTimeout(r, 500));

const suspectResult = phiDetector.getNodeHealth('node-a');
check(
  'missed heartbeats increase phi',
  suspectResult.phi,
  (v) => v > healthyResult.phi,
  `>${healthyResult.phi} (phi increases with silence)`
);

// ---------------------------------------------------------------------
// Step 6 - Token-based vs request-based capacity
// ---------------------------------------------------------------------

console.log('\nStep 6 - token-based vs request-based capacity');

const capacityDemo = demonstrateCapacityDifference();

check(
  'token-based shows small request advantage',
  capacityDemo.tokenBased.small.effectiveRps,
  (v) => v > capacityDemo.tokenBased.large.effectiveRps,
  `>${capacityDemo.tokenBased.large.effectiveRps} (small requests get more RPS)`
);

const rpsRatio =
  capacityDemo.tokenBased.small.effectiveRps /
  capacityDemo.tokenBased.large.effectiveRps;
check(
  'RPS ratio matches token ratio',
  Math.abs(rpsRatio - 20),
  (v) => v < 1,
  '~20 (2000/100 token ratio)'
);

check(
  'request-based shows no difference',
  capacityDemo.requestBased.small.effectiveRps,
  (v) => v === capacityDemo.requestBased.large.effectiveRps,
  `${capacityDemo.requestBased.large.effectiveRps} (same regardless of size)`
);

// ---------------------------------------------------------------------
// Step 7 - Token capacity planning
// ---------------------------------------------------------------------

console.log('\nStep 7 - token capacity planning');

const tokenPlanner = new TokenCapacityPlanner({
  tokensPerSecond: 10000,
  maxConcurrentRequests: 50,
  averageTokensPerRequest: 500,
});

const throughputComparison = compareRequestSizeThroughput(10000, [100, 500, 2000]);

check(
  '100-token requests: 100 RPS',
  throughputComparison[0].maxRps,
  (v) => v === 100,
  '100 (10000/100)'
);

check(
  '500-token requests: 20 RPS',
  throughputComparison[1].maxRps,
  (v) => v === 20,
  '20 (10000/500)'
);

check(
  '2000-token requests: 5 RPS',
  throughputComparison[2].maxRps,
  (v) => v === 5,
  '5 (10000/2000)'
);

// ---------------------------------------------------------------------
// Step 8 - LLM latency distribution
// ---------------------------------------------------------------------

console.log('\nStep 8 - LLM latency distribution');

const latencyComparison = compareLatencyProfiles();

check(
  'LLM p50 >> traditional p50',
  latencyComparison.ratioP50,
  (v) => v > 100,
  '>100x (LLM is much slower)'
);

check(
  'LLM p99 >> traditional p99',
  latencyComparison.ratioP99,
  (v) => v > 50,
  '>50x (long tail is even longer)'
);

// Use frontier tier which has larger variance and no token generation overhead
const llmDistribution = simulateLatencyDistribution('frontier', 1000, 100);
check(
  'p99 >> p50 for LLM',
  llmDistribution.p99 / llmDistribution.p50,
  (v) => v > 1.5,
  '>1.5x (significant tail vs traditional APIs ~1.1x)'
);

// ---------------------------------------------------------------------
// Step 9 - Timeout strategy for LLM
// ---------------------------------------------------------------------

console.log('\nStep 9 - timeout strategy for LLM');

const llmTimeout = new LLMTimeoutStrategy(800, 5000, 50);

const shortRequestTimeout = llmTimeout.calculateTimeout(100);
const longRequestTimeout = llmTimeout.calculateTimeout(2000);

check(
  'longer requests get longer timeouts',
  longRequestTimeout > shortRequestTimeout,
  (v) => v === true,
  'true (timeout scales with tokens)'
);

const timeoutRatio = longRequestTimeout / shortRequestTimeout;
check(
  'timeout ratio less than token ratio',
  timeoutRatio < 20, // 2000/100
  (v) => v === true,
  'true (fixed TTFT component reduces ratio)'
);

// Timeout recommendation based on distribution
const recommendedTimeout = recommendTimeout(latencyComparison.llmApi, 0.99);
check(
  'recommended timeout close to p99',
  Math.abs(recommendedTimeout - latencyComparison.llmApi.p99Ms),
  (v) => v < 100,
  '<100ms difference from p99'
);

// ---------------------------------------------------------------------
// Step 10 - Circuit breaker behavior
// ---------------------------------------------------------------------

console.log('\nStep 10 - circuit breaker behavior');

const breaker = new CircuitBreaker(3, 1000, 2);

check(
  'breaker starts closed',
  breaker.getState(),
  (v) => v === 'closed',
  '"closed"'
);

// Record failures to trip breaker
breaker.recordFailure();
breaker.recordFailure();
breaker.recordFailure();

check(
  'breaker opens after threshold',
  breaker.getState(),
  (v) => v === 'open',
  '"open" (3 failures)'
);

check(
  'open breaker rejects requests',
  breaker.shouldAllow(),
  (v) => v === false,
  'false'
);

// Wait for recovery time
await new Promise((r) => setTimeout(r, 1100));

check(
  'breaker transitions to half-open',
  breaker.getState(),
  (v) => v === 'half-open',
  '"half-open" (recovery time elapsed)'
);

// Successful requests close breaker
breaker.recordSuccess();
breaker.recordSuccess();

check(
  'breaker closes after successes',
  breaker.getState(),
  (v) => v === 'closed',
  '"closed" (2 successes in half-open)'
);

// ---------------------------------------------------------------------
// Step 11 - Queue model for capacity
// ---------------------------------------------------------------------

console.log('\nStep 11 - queue model for capacity');

// QueueModel(arrivalRate, serviceRatePerServer, numServers)
// Utilization = arrivalRate / (serviceRatePerServer * numServers)
const stableQueue = new QueueModel(50, 20, 5); // 50 / (20*5) = 50/100 = 0.5
const saturatedQueue = new QueueModel(95, 20, 5); // 95 / (20*5) = 95/100 = 0.95

check(
  'stable queue has low utilization',
  stableQueue.getUtilization(),
  (v) => v < 0.8,
  '<0.8 (system not saturated)'
);

check(
  'saturated queue has high utilization',
  saturatedQueue.getUtilization(),
  (v) => v > 0.9,
  '>0.9 (approaching capacity)'
);

check(
  'saturated queue has longer wait',
  saturatedQueue.getAverageWaitTimeMs() > stableQueue.getAverageWaitTimeMs(),
  (v) => v === true,
  'true (higher utilization means longer waits)'
);

// ---------------------------------------------------------------------
// Step 12 - Timeout impact on throughput
// ---------------------------------------------------------------------

console.log('\nStep 12 - timeout impact on throughput');

const shortTimeoutImpact = simulateTimeoutImpact('mid', 500, 100);
const longTimeoutImpact = simulateTimeoutImpact('mid', 10000, 100);

check(
  'short timeout causes more timeouts',
  shortTimeoutImpact.timedOut > longTimeoutImpact.timedOut,
  (v) => v === true,
  'true (aggressive timeout cuts off tail)'
);

check(
  'short timeout completes fewer requests',
  shortTimeoutImpact.completed < longTimeoutImpact.completed,
  (v) => v === true,
  'true (some requests get cut off)'
);

// But average latency is lower with short timeout
check(
  'short timeout has lower avg latency',
  shortTimeoutImpact.avgLatencyMs < longTimeoutImpact.avgLatencyMs,
  (v) => v === true,
  'true (timeouts cap the latency)'
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
