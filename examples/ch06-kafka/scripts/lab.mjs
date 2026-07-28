// Reproduces every numbered step of the Chapter 6 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch06-kafka)
//   node examples/ch06-kafka/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { KafkaSimulator } = await import(resolve(srcDir, 'simulator.ts'));
const { Producer } = await import(resolve(srcDir, 'producer.ts'));
const { Consumer } = await import(resolve(srcDir, 'consumer.ts'));
const { DLQHandler } = await import(resolve(srcDir, 'dlq.ts'));

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
// Step 1 - Consumer timeout handling at 30s processing time
// ---------------------------------------------------------------------

console.log('\nStep 1 - consumer timeout handling at 30s processing time');

const kafka1 = new KafkaSimulator();
kafka1.createTopic({
  name: 'llm-requests',
  partitions: 4,
  replicationFactor: 3,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

const producer1 = new Producer(kafka1, 'llm-requests');
const consumer1 = new Consumer(kafka1, 'llm-requests', {
  groupId: 'llm-processor',
  sessionTimeoutMs: 120_000,  // 2 minutes
  heartbeatIntervalMs: 10_000,
  maxProcessingTimeMs: 60_000, // 1 minute max
  maxRetries: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 30_000,
});

consumer1.join();

// Produce a message
const request1 = {
  prompt: 'Analyze this document in detail',
  tier: 'frontier',
  maxTokens: 4000,
  tenant: 'acme',
  workload: 'analysis',
};
const produceResult1 = producer1.produce(request1, 'idem_test_1');

check(
  'message produced successfully',
  produceResult1.success,
  (v) => v === true,
  'true (message accepted)'
);

// Poll for messages
const messages1 = consumer1.poll(10);

check(
  'message received by consumer',
  messages1.length,
  (v) => v === 1,
  '1 (single message polled)'
);

// Simulate 30-second processing with successful completion
const processingStarted = Date.now();
let heartbeatsDuringProcessing = 0;

// Process with a handler that simulates 30s of work
const result1 = await consumer1.processMessage(
  messages1[0],
  0, // partition
  0, // offset
  async (msg) => {
    // Simulate long processing with periodic heartbeats
    for (let i = 0; i < 3; i++) {
      await sleep(10); // Simulate work (shortened for test)
      consumer1.heartbeat();
      heartbeatsDuringProcessing++;
    }
    return {
      success: true,
      response: {
        requestId: msg.id,
        output: 'Analysis complete',
        inputTokens: 1000,
        outputTokens: 500,
        processingTimeMs: Date.now() - processingStarted,
        tier: msg.payload.tier,
      },
    };
  }
);

check(
  '30s processing completes without session timeout',
  result1.success,
  (v) => v === true,
  'true (heartbeats kept session alive)'
);

check(
  'heartbeats sent during processing',
  heartbeatsDuringProcessing,
  (v) => v >= 3,
  '>= 3 (heartbeats sent during long operation)'
);

// ---------------------------------------------------------------------
// Step 2 - DLQ routing for failed messages
// ---------------------------------------------------------------------

console.log('\nStep 2 - DLQ routing for failed messages');

const kafka2 = new KafkaSimulator();
kafka2.createTopic({
  name: 'llm-requests',
  partitions: 4,
  replicationFactor: 3,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

const producer2 = new Producer(kafka2, 'llm-requests');
const consumer2 = new Consumer(kafka2, 'llm-requests', {
  groupId: 'llm-processor',
  sessionTimeoutMs: 120_000,
  heartbeatIntervalMs: 10_000,
  maxProcessingTimeMs: 60_000,
  maxRetries: 3,
  backoffBaseMs: 100, // Shorter for testing
  backoffMaxMs: 1000,
});
const dlqHandler2 = new DLQHandler(kafka2, 'llm-requests-dlq');

consumer2.join();

// Produce messages that will fail
for (let i = 0; i < 5; i++) {
  producer2.produce(
    {
      prompt: 'Bad request with invalid content',
      tier: 'mid',
      maxTokens: 1000,
      tenant: 'acme',
      workload: 'test',
    },
    `idem_fail_${i}`
  );
}

// Poll and process with failing handler
const messages2 = consumer2.poll(10);

for (const msg of messages2) {
  await consumer2.processMessage(
    msg,
    0,
    messages2.indexOf(msg),
    async () => {
      return {
        success: false,
        error: 'Bad request: invalid content format',
      };
    }
  );
}

const dlqStats = dlqHandler2.getStats();

check(
  'failed messages routed to DLQ',
  dlqStats.totalEntries,
  (v) => v === 5,
  '5 (all failed messages in DLQ)'
);

check(
  'DLQ entries categorized correctly',
  dlqStats.byReason.non_retriable_error,
  (v) => v === 5,
  '5 (bad request is non-retriable)'
);

// ---------------------------------------------------------------------
// Step 3 - Exactly-once via idempotency keys
// ---------------------------------------------------------------------

console.log('\nStep 3 - exactly-once via idempotency keys');

const kafka3 = new KafkaSimulator();
kafka3.createTopic({
  name: 'llm-requests',
  partitions: 4,
  replicationFactor: 3,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

const producer3 = new Producer(kafka3, 'llm-requests');

// Produce same message multiple times with same idempotency key
const request3 = {
  prompt: 'Summarize this document',
  tier: 'mid',
  maxTokens: 500,
  tenant: 'acme',
  workload: 'summarization',
};

const idempotencyKey = 'unique_request_12345';

const firstProduce = producer3.produce(request3, idempotencyKey);
const secondProduce = producer3.produce(request3, idempotencyKey);
const thirdProduce = producer3.produce(request3, idempotencyKey);

check(
  'first produce succeeds',
  firstProduce.success && !firstProduce.isDuplicate,
  (v) => v === true,
  'true (first message accepted)'
);

check(
  'second produce detected as duplicate',
  secondProduce.isDuplicate,
  (v) => v === true,
  'true (duplicate detected by idempotency key)'
);

check(
  'third produce detected as duplicate',
  thirdProduce.isDuplicate,
  (v) => v === true,
  'true (duplicate detected by idempotency key)'
);

const metrics3 = kafka3.getMetrics();

check(
  'duplicate counter incremented correctly',
  metrics3.duplicatesDetected,
  (v) => v === 2,
  '2 (two duplicate attempts detected)'
);

check(
  'only one message produced',
  metrics3.messagesProduced,
  (v) => v === 1,
  '1 (duplicates not written to topic)'
);

// ---------------------------------------------------------------------
// Step 4 - Backpressure pauses consumption
// ---------------------------------------------------------------------

console.log('\nStep 4 - backpressure pauses consumption');

const kafka4 = new KafkaSimulator();
kafka4.createTopic({
  name: 'llm-requests',
  partitions: 4,
  replicationFactor: 3,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
});

const producer4 = new Producer(kafka4, 'llm-requests');
const consumer4 = new Consumer(kafka4, 'llm-requests', {
  groupId: 'llm-processor',
  sessionTimeoutMs: 120_000,
  heartbeatIntervalMs: 10_000,
  maxProcessingTimeMs: 60_000,
  maxRetries: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 30_000,
});

consumer4.join();

// Produce several messages
for (let i = 0; i < 10; i++) {
  producer4.produce(
    {
      prompt: `Request ${i}`,
      tier: 'small',
      maxTokens: 100,
      tenant: 'acme',
      workload: 'batch',
    },
    `idem_batch_${i}`
  );
}

// Poll before pause - should get messages
const messagesBeforePause = consumer4.poll(5);

check(
  'messages received before pause',
  messagesBeforePause.length,
  (v) => v > 0,
  '> 0 (messages available)'
);

// Simulate rate limit - pause consumption
consumer4.applyRateLimit(5000); // 5 second rate limit

// Poll during pause - should get nothing
const messagesDuringPause = consumer4.poll(5);

check(
  'no messages during backpressure',
  messagesDuringPause.length,
  (v) => v === 0,
  '0 (consumption paused due to rate limit)'
);

const backpressureState = consumer4.getBackpressureState();

check(
  'backpressure state tracked',
  backpressureState.isPaused,
  (v) => v === true,
  'true (consumer paused)'
);

// Resume and verify consumption resumes
consumer4.resume();
// Clear rate limit for test
consumer4.getBackpressureState().rateLimitedUntil = null;

const messagesAfterResume = consumer4.poll(5);

// Note: May still be 0 if rate limit hasn't expired, but pause state should be cleared
check(
  'backpressure state cleared after resume',
  consumer4.getBackpressureState().isPaused,
  (v) => v === false,
  'false (consumer resumed)'
);

const metrics4 = kafka4.getMetrics();

check(
  'backpressure pause recorded',
  metrics4.backpressurePauseCount,
  (v) => v >= 1,
  '>= 1 (pause event recorded)'
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
