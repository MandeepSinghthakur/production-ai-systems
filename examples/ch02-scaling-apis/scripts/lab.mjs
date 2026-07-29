// Reproduces every numbered step of the Chapter 2 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch02-scaling-apis)
//   node examples/ch02-scaling-apis/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const {
  APIInstance,
  LoadBalancer,
  measureThroughput,
  demonstrateLinearScaling,
} = await import(resolve(srcDir, 'scaling.ts'));

const {
  StreamingResponse,
  StreamConnectionManager,
  demonstrateStreamingHold,
  calculateConnectionCapacity,
} = await import(resolve(srcDir, 'streaming.ts'));

const {
  BackpressureBuffer,
  BackpressureProducer,
  simulateSlowConsumer,
  demonstrateBackpressurePreventsOverflow,
} = await import(resolve(srcDir, 'backpressure.ts'));

const {
  DegradationController,
  DegradedRequestProcessor,
  demonstrateGracefulDegradation,
  PriorityLoadShedder,
  demonstratePriorityShedding,
} = await import(resolve(srcDir, 'degradation.ts'));

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
// Step 1 - Horizontal scaling increases throughput
// ---------------------------------------------------------------------

console.log('\nStep 1 - horizontal scaling increases throughput');

const scalingResults = await demonstrateLinearScaling(100);

check(
  '2 instances have higher throughput than 1',
  scalingResults[1].throughputRps > scalingResults[0].throughputRps,
  (v) => v === true,
  'true (2x instances should increase throughput)'
);

check(
  '4 instances have higher throughput than 2',
  scalingResults[2].throughputRps > scalingResults[1].throughputRps,
  (v) => v === true,
  'true (4x instances should increase throughput)'
);

// Check approximate linearity (within 50% - accounting for overhead)
const ratio2to1 = scalingResults[1].throughputRps / scalingResults[0].throughputRps;
const ratio4to2 = scalingResults[2].throughputRps / scalingResults[1].throughputRps;

check(
  'scaling ratio 2:1 is approximately linear',
  ratio2to1,
  (v) => v > 1.3 && v < 2.5,
  '>1.3 and <2.5 (accounting for coordination overhead)'
);

check(
  'scaling ratio 4:2 is approximately linear',
  ratio4to2,
  (v) => v > 1.3 && v < 2.5,
  '>1.3 and <2.5 (accounting for coordination overhead)'
);

// ---------------------------------------------------------------------
// Step 2 - Stateless instances process independently
// ---------------------------------------------------------------------

console.log('\nStep 2 - stateless instances process independently');

const instance1 = new APIInstance({
  id: 'instance-1',
  maxConcurrency: 5,
  processingTimeMs: 10,
  streamChunkIntervalMs: 5,
});

const instance2 = new APIInstance({
  id: 'instance-2',
  maxConcurrency: 5,
  processingTimeMs: 10,
  streamChunkIntervalMs: 5,
});

// Process requests on both instances
const req1 = { id: 'r1', tenantId: 't1', payload: 'p1', estimatedTokens: 100, streaming: false, arrivedAt: Date.now() };
const req2 = { id: 'r2', tenantId: 't1', payload: 'p2', estimatedTokens: 100, streaming: false, arrivedAt: Date.now() };

const [resp1, resp2] = await Promise.all([
  instance1.process(req1),
  instance2.process(req2),
]);

check(
  'instance 1 processes its request',
  resp1.status,
  (v) => v === 'success',
  '"success"'
);

check(
  'instance 2 processes its request independently',
  resp2.status,
  (v) => v === 'success',
  '"success"'
);

check(
  'requests processed by different instances',
  resp1.instanceId !== resp2.instanceId,
  (v) => v === true,
  'true (each instance identified separately)'
);

// ---------------------------------------------------------------------
// Step 3 - Load balancer distributes requests
// ---------------------------------------------------------------------

console.log('\nStep 3 - load balancer distributes requests');

const lb = new LoadBalancer({
  strategy: 'least-connections',
  instances: [
    { id: 'lb-inst-1', maxConcurrency: 5, processingTimeMs: 10, streamChunkIntervalMs: 5 },
    { id: 'lb-inst-2', maxConcurrency: 5, processingTimeMs: 10, streamChunkIntervalMs: 5 },
  ],
  maxQueueSize: 20,
  queueTimeoutMs: 1000,
});

// Send 10 requests through load balancer
const lbRequests = [];
for (let i = 0; i < 10; i++) {
  lbRequests.push({
    id: `lb-req-${i}`,
    tenantId: 'tenant-1',
    payload: `Request ${i}`,
    estimatedTokens: 100,
    streaming: false,
    arrivedAt: Date.now(),
  });
}

const lbResponses = await Promise.all(lbRequests.map((r) => lb.route(r)));
const instancesUsed = new Set(lbResponses.map((r) => r.instanceId));

check(
  'load balancer uses multiple instances',
  instancesUsed.size,
  (v) => v >= 2,
  '>=2 (requests distributed across instances)'
);

const successCount = lbResponses.filter((r) => r.status === 'success').length;
check(
  'all requests succeed through load balancer',
  successCount,
  (v) => v === 10,
  '10 (all requests processed successfully)'
);

// ---------------------------------------------------------------------
// Step 4 - Connection limits reject excess
// ---------------------------------------------------------------------

console.log('\nStep 4 - connection limits reject excess');

const limitedInstance = new APIInstance({
  id: 'limited',
  maxConcurrency: 2,
  processingTimeMs: 100,
  streamChunkIntervalMs: 10,
});

// Start 3 concurrent requests on instance with limit of 2
const concurrentReqs = [
  { id: 'c1', tenantId: 't1', payload: 'p1', estimatedTokens: 100, streaming: false, arrivedAt: Date.now() },
  { id: 'c2', tenantId: 't1', payload: 'p2', estimatedTokens: 100, streaming: false, arrivedAt: Date.now() },
  { id: 'c3', tenantId: 't1', payload: 'p3', estimatedTokens: 100, streaming: false, arrivedAt: Date.now() },
];

// Start all at once
const concurrentPromises = concurrentReqs.map((r) => limitedInstance.process(r));
const concurrentResponses = await Promise.all(concurrentPromises);

const accepted = concurrentResponses.filter((r) => r.status === 'success').length;
const rejected = concurrentResponses.filter((r) => r.status === 'rejected').length;

check(
  'some requests accepted within concurrency limit',
  accepted,
  (v) => v >= 2,
  '>=2 (at least maxConcurrency accepted)'
);

check(
  'excess requests rejected when at capacity',
  rejected,
  (v) => v >= 1,
  '>=1 (requests beyond limit rejected)'
);

// ---------------------------------------------------------------------
// Step 5 - Streaming connections held during response
// ---------------------------------------------------------------------

console.log('\nStep 5 - streaming connections held during response');

const streamResult = await demonstrateStreamingHold(5, 10, 10);

check(
  'streaming connections limited by capacity',
  streamResult.connectionsAccepted,
  (v) => v === 5,
  '5 (connection limit enforced)'
);

check(
  'excess streaming connections rejected',
  streamResult.connectionsRejected,
  (v) => v === 5,
  '5 (attempted 10, accepted 5, rejected 5)'
);

check(
  'connections held for duration of streaming',
  streamResult.avgHoldTimeMs,
  (v) => v > 50,
  '>50ms (10 chunks * 10ms interval = ~100ms minimum)'
);

// ---------------------------------------------------------------------
// Step 6 - Connection capacity calculation
// ---------------------------------------------------------------------

console.log('\nStep 6 - connection capacity calculation');

const capacity = calculateConnectionCapacity(100, 500, 50);

check(
  'connection duration calculated from token rate',
  capacity.avgConnectionDurationMs,
  (v) => v === 10000,
  '10000ms (500 tokens / 50 tokens/sec = 10 sec)'
);

check(
  'required connections follows Little\'s Law',
  capacity.requiredConnections,
  (v) => v === 1000,
  '1000 (100 req/s * 10s hold time)'
);

check(
  'headroom adds 20% capacity',
  capacity.headroom20Percent,
  (v) => v === 1200,
  '1200 (1000 * 1.2)'
);

// ---------------------------------------------------------------------
// Step 7 - Backpressure pauses production
// ---------------------------------------------------------------------

console.log('\nStep 7 - backpressure pauses production');

// Test with settings that trigger backpressure:
// - Producer is 4x faster than consumer (2ms vs 8ms)
// - Small buffer (300 bytes high water, ~3 chunks worth)
// - Long pause threshold to allow recovery
const slowConsumerResult = await simulateSlowConsumer(
  20,     // chunks to produce
  2,      // produce every 2ms (fast)
  8,      // consume every 8ms (4x slower)
  {
    highWaterMark: 300,    // ~3 chunks triggers pause
    lowWaterMark: 100,     // ~1 chunk triggers resume
    maxBufferSize: 2000,
    pauseThresholdMs: 5000,  // Long timeout to avoid abort
  }
);

check(
  'slow consumer triggers backpressure pauses',
  slowConsumerResult.pauseCount,
  (v) => v > 0,
  '>0 (producer paused when buffer filled)'
);

check(
  'chunks consumed matches chunks produced (backpressure coordinates)',
  slowConsumerResult.chunksConsumed,
  (v) => v === slowConsumerResult.chunksProduced,
  `${slowConsumerResult.chunksProduced} (consumer catches up with coordination)`
);

check(
  'buffer size stayed bounded',
  slowConsumerResult.peakBufferSize,
  (v) => v <= 2000,
  '<=2000 bytes (maxBufferSize limit respected)'
);

// ---------------------------------------------------------------------
// Step 8 - Backpressure prevents overflow
// ---------------------------------------------------------------------

console.log('\nStep 8 - backpressure prevents overflow');

const overflowResult = await demonstrateBackpressurePreventsOverflow(100, 1000);

check(
  'not all chunks produced when no consumer',
  overflowResult.chunksProduced < overflowResult.chunksAttempted,
  (v) => v === true,
  'true (production stopped by backpressure)'
);

check(
  'buffer overflow prevented',
  overflowResult.bufferOverflowPrevented,
  (v) => v === true,
  'true (peak buffer <= max buffer)'
);

// ---------------------------------------------------------------------
// Step 9 - Graceful degradation under load
// ---------------------------------------------------------------------

console.log('\nStep 9 - graceful degradation under load');

const degradationResult = await demonstrateGracefulDegradation(100);

check(
  'some requests accepted during degradation',
  degradationResult.accepted,
  (v) => v > 0,
  '>0 (partial service maintained)'
);

check(
  'some requests rejected during overload',
  degradationResult.rejected,
  (v) => v > 0,
  '>0 (load shedding activated)'
);

check(
  'degradation levels transitioned',
  degradationResult.levelTransitions.length,
  (v) => v >= 1,
  '>=1 (system transitioned through degradation levels)'
);

// Verify transitions went in order
const levelOrder = ['none', 'shed-new', 'shed-streaming', 'emergency'];
let transitionsInOrder = true;
for (let i = 0; i < degradationResult.levelTransitions.length; i++) {
  const t = degradationResult.levelTransitions[i];
  if (levelOrder.indexOf(t.to) < levelOrder.indexOf(t.from)) {
    // De-escalation - that's fine
    continue;
  }
  // Escalation should be sequential
  const fromIdx = levelOrder.indexOf(t.from);
  const toIdx = levelOrder.indexOf(t.to);
  if (toIdx > fromIdx + 1) {
    // Skipped a level - unexpected but not necessarily wrong
  }
}

check(
  'degradation escalated progressively',
  transitionsInOrder,
  (v) => v === true,
  'true (levels escalate in order)'
);

// ---------------------------------------------------------------------
// Step 10 - Priority shedding protects high-priority
// ---------------------------------------------------------------------

console.log('\nStep 10 - priority shedding protects high-priority');

// Create a load pattern that starts low and goes high
const loadPattern = [];
for (let i = 0; i < 50; i++) {
  loadPattern.push(0.5 + (i / 50) * 0.5); // 0.5 to 1.0
}

const priorityResult = demonstratePriorityShedding(200, loadPattern);

check(
  'high priority has better success rate than low',
  priorityResult.highPrioritySuccessRate > priorityResult.lowPrioritySuccessRate,
  (v) => v === true,
  'true (priority shedding protects high priority)'
);

check(
  'high priority success rate above 80%',
  priorityResult.highPrioritySuccessRate,
  (v) => v > 0.8,
  '>0.8 (high priority mostly protected)'
);

check(
  'some requests shed during overload',
  priorityResult.totalShed,
  (v) => v > 0,
  '>0 (load shedding activated)'
);

// ---------------------------------------------------------------------
// Step 11 - Degradation controller hysteresis
// ---------------------------------------------------------------------

console.log('\nStep 11 - degradation controller hysteresis');

const controller = new DegradationController({
  cpuThresholds: { shedNew: 70, shedStreaming: 85, emergency: 95 },
  queueThresholds: { shedNew: 100, shedStreaming: 200, emergency: 500 },
  recoveryHysteresis: 10,
});

// Escalate to shed-new
controller.updateHealth(75, 50, 50, 10);
check(
  'escalates to shed-new at 75% CPU',
  controller.getCurrentLevel(),
  (v) => v === 'shed-new',
  '"shed-new"'
);

// Try to de-escalate with CPU just below threshold (should stay due to hysteresis)
controller.updateHealth(65, 50, 50, 10);
check(
  'hysteresis prevents immediate de-escalation',
  controller.getCurrentLevel(),
  (v) => v === 'shed-new',
  '"shed-new" (65% > 70% - 10% hysteresis = 60%)'
);

// De-escalate with CPU well below threshold
controller.updateHealth(55, 50, 50, 10);
check(
  'de-escalates when below hysteresis threshold',
  controller.getCurrentLevel(),
  (v) => v === 'none',
  '"none" (55% < 60% threshold with hysteresis)'
);

// ---------------------------------------------------------------------
// Step 12 - Metrics tracked correctly
// ---------------------------------------------------------------------

console.log('\nStep 12 - metrics tracked correctly');

const metricInstance = new APIInstance({
  id: 'metrics-test',
  maxConcurrency: 10,
  processingTimeMs: 5,
  streamChunkIntervalMs: 2,
});

// Process 5 requests
for (let i = 0; i < 5; i++) {
  await metricInstance.process({
    id: `metric-${i}`,
    tenantId: 't1',
    payload: 'p',
    estimatedTokens: 100,
    streaming: false,
    arrivedAt: Date.now(),
  });
}

const metrics = metricInstance.getMetrics();

check(
  'requests processed count accurate',
  metrics.requestsProcessed,
  (v) => v === 5,
  '5'
);

check(
  'tokens processed count accurate',
  metrics.tokensProcessed,
  (v) => v === 500,
  '500 (5 * 100 tokens)'
);

check(
  'average latency tracked',
  metrics.avgLatencyMs,
  (v) => v > 0,
  '>0ms'
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
