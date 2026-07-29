// Reproduces every numbered step of the Chapter 8 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch08-outbox-saga)
//   node examples/ch08-outbox-saga/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { Outbox } = await import(resolve(srcDir, 'outbox.ts'));
const { SagaOrchestrator, LLMSagaSteps } = await import(
  resolve(srcDir, 'saga.ts')
);
const {
  CompensationHandler,
  IdempotentCompensation,
} = await import(resolve(srcDir, 'compensation.ts'));
const {
  IdempotencyStore,
  IdempotentProcessor,
  ExactlyOnceCoordinator,
  DeadLetterHandler,
} = await import(resolve(srcDir, 'delivery.ts'));

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
// Step 1 - Outbox pattern ensures atomic writes
// ---------------------------------------------------------------------

console.log('\nStep 1 - outbox pattern ensures atomic writes');

const outbox1 = new Outbox({
  pollIntervalMs: 100,
  batchSize: 10,
  maxAttempts: 3,
  retryDelayMs: 100,
});

// Execute a transactional write
const result1 = outbox1.executeTransaction(
  'LLMRequest',
  'req_001',
  'RequestCreated',
  {
    prompt: 'Analyze this document',
    tenant: 'acme',
    tier: 'frontier',
  },
  'idem_key_001'
);

check(
  'outbox entry created in transaction',
  result1.success,
  (v) => v === true,
  'true (entry and domain data written atomically)'
);

// Verify both outbox entry and domain data exist
const entry1 = outbox1.getEntry(result1.entryId);
const domainData1 = outbox1.getDomainData('req_001');

check(
  'outbox entry persisted',
  entry1 !== null,
  (v) => v === true,
  'true (entry exists)'
);

check(
  'domain data persisted',
  domainData1 !== null,
  (v) => v === true,
  'true (domain data exists)'
);

// Verify transaction log shows atomic write
const txLog1 = outbox1.getTransactionLog();

check(
  'transaction log shows atomic write',
  txLog1.length,
  (v) => v === 1,
  '1 (single transaction committed)'
);

// ---------------------------------------------------------------------
// Step 2 - Outbox handles duplicate idempotency keys
// ---------------------------------------------------------------------

console.log('\nStep 2 - outbox handles duplicate idempotency keys');

// Try to create another entry with the same idempotency key
const duplicateResult = outbox1.executeTransaction(
  'LLMRequest',
  'req_002',
  'RequestCreated',
  {
    prompt: 'Different prompt',
    tenant: 'acme',
    tier: 'mid',
  },
  'idem_key_001' // Same key as before
);

check(
  'duplicate detected and rejected',
  duplicateResult.entryId,
  (v) => v === result1.entryId,
  `${result1.entryId} (returns original entry ID)`
);

const metrics1 = outbox1.getMetrics();

check(
  'duplicate counter incremented',
  metrics1.duplicatesDetected,
  (v) => v === 1,
  '1 (one duplicate detected)'
);

// Verify only one entry exists
const allEntries1 = outbox1.getAllEntries();

check(
  'only original entry exists',
  allEntries1.length,
  (v) => v === 1,
  '1 (duplicate not written)'
);

// ---------------------------------------------------------------------
// Step 3 - Outbox publisher delivers messages
// ---------------------------------------------------------------------

console.log('\nStep 3 - outbox publisher delivers messages');

const outbox2 = new Outbox({
  pollIntervalMs: 50,
  batchSize: 10,
  maxAttempts: 3,
  retryDelayMs: 50,
});

let publishedMessages = [];

outbox2.setHandler(async (entry) => {
  publishedMessages.push({
    id: entry.id,
    eventType: entry.eventType,
    payload: entry.payload,
  });
  return true;
});

// Create entries
outbox2.executeTransaction(
  'LLMRequest',
  'req_010',
  'RequestCreated',
  { prompt: 'Request 1' },
  'pub_key_001'
);

outbox2.executeTransaction(
  'LLMRequest',
  'req_011',
  'RequestCreated',
  { prompt: 'Request 2' },
  'pub_key_002'
);

// Publish pending entries
const publishResults = await outbox2.publishPending();

check(
  'all entries published',
  publishResults.filter((r) => r.success).length,
  (v) => v === 2,
  '2 (both entries published)'
);

check(
  'handler received all messages',
  publishedMessages.length,
  (v) => v === 2,
  '2 (handler called twice)'
);

// Verify entries marked as published
const entries2 = outbox2.getAllEntries();
const publishedCount = entries2.filter((e) => e.state === 'published').length;

check(
  'entries marked as published',
  publishedCount,
  (v) => v === 2,
  '2 (both entries published state)'
);

// ---------------------------------------------------------------------
// Step 4 - Outbox retries failed deliveries
// ---------------------------------------------------------------------

console.log('\nStep 4 - outbox retries failed deliveries');

const outbox3 = new Outbox({
  pollIntervalMs: 50,
  batchSize: 10,
  maxAttempts: 3,
  retryDelayMs: 10,
});

let failCount = 0;

outbox3.setHandler(async (entry) => {
  failCount++;
  if (failCount < 3) {
    throw new Error('Transient failure');
  }
  return true;
});

// Create an entry
const result3 = outbox3.executeTransaction(
  'LLMRequest',
  'req_020',
  'RequestCreated',
  { prompt: 'Retry test' },
  'retry_key_001'
);

// First attempt fails
await outbox3.publishPending();
const afterFirst = outbox3.getEntry(result3.entryId);

check(
  'entry still pending after first failure',
  afterFirst?.state,
  (v) => v === 'pending',
  'pending (retries available)'
);

// Second attempt fails
await outbox3.publishPending();

// Third attempt succeeds
await outbox3.publishPending();
const afterThird = outbox3.getEntry(result3.entryId);

check(
  'entry published after successful retry',
  afterThird?.state,
  (v) => v === 'published',
  'published (third attempt succeeded)'
);

check(
  'handler called three times',
  failCount,
  (v) => v === 3,
  '3 (two failures + one success)'
);

// ---------------------------------------------------------------------
// Step 5 - Saga executes steps in order
// ---------------------------------------------------------------------

console.log('\nStep 5 - saga executes steps in order');

const orchestrator1 = new SagaOrchestrator({
  maxRetries: 2,
  retryDelayMs: 10,
  timeoutMs: 5000,
});

const executionOrder = [];

orchestrator1.registerSaga({
  type: 'ProcessLLMRequest',
  steps: [
    {
      name: 'step_1',
      execute: async (ctx) => {
        executionOrder.push('step_1_execute');
        return { success: true, output: { step1Data: 'data1' } };
      },
      compensate: async (ctx) => {
        executionOrder.push('step_1_compensate');
        return { success: true };
      },
    },
    {
      name: 'step_2',
      execute: async (ctx) => {
        executionOrder.push('step_2_execute');
        return { success: true, output: { step2Data: 'data2' } };
      },
      compensate: async (ctx) => {
        executionOrder.push('step_2_compensate');
        return { success: true };
      },
    },
    {
      name: 'step_3',
      execute: async (ctx) => {
        executionOrder.push('step_3_execute');
        return { success: true, output: { step3Data: 'data3' } };
      },
      compensate: async (ctx) => {
        executionOrder.push('step_3_compensate');
        return { success: true };
      },
    },
  ],
});

const sagaResult1 = await orchestrator1.execute('ProcessLLMRequest', {
  tenant: 'acme',
  requestId: 'req_100',
});

check(
  'saga completed successfully',
  sagaResult1.success,
  (v) => v === true,
  'true (all steps completed)'
);

check(
  'steps executed in order',
  executionOrder.join(','),
  (v) => v === 'step_1_execute,step_2_execute,step_3_execute',
  'step_1_execute,step_2_execute,step_3_execute'
);

check(
  'all steps completed',
  sagaResult1.steps.filter((s) => s.state === 'completed').length,
  (v) => v === 3,
  '3 (all three steps completed)'
);

// ---------------------------------------------------------------------
// Step 6 - Saga compensates on failure
// ---------------------------------------------------------------------

console.log('\nStep 6 - saga compensates on failure');

const orchestrator2 = new SagaOrchestrator({
  maxRetries: 1,
  retryDelayMs: 10,
  timeoutMs: 5000,
});

const compensationOrder = [];

orchestrator2.registerSaga({
  type: 'FailingSaga',
  steps: [
    {
      name: 'reserve',
      execute: async (ctx) => {
        compensationOrder.push('reserve_execute');
        return { success: true, output: { reservationId: 'res_001' } };
      },
      compensate: async (ctx) => {
        compensationOrder.push('reserve_compensate');
        return { success: true };
      },
    },
    {
      name: 'charge',
      execute: async (ctx) => {
        compensationOrder.push('charge_execute');
        return { success: true, output: { chargeId: 'chrg_001' } };
      },
      compensate: async (ctx) => {
        compensationOrder.push('charge_compensate');
        return { success: true };
      },
    },
    {
      name: 'process',
      execute: async (ctx) => {
        compensationOrder.push('process_execute');
        return { success: false, error: 'Processing failed' };
      },
      compensate: async (ctx) => {
        compensationOrder.push('process_compensate');
        return { success: true };
      },
    },
  ],
});

const sagaResult2 = await orchestrator2.execute('FailingSaga', {
  tenant: 'acme',
});

check(
  'saga failed',
  sagaResult2.success,
  (v) => v === false,
  'false (step 3 failed)'
);

check(
  'saga compensated',
  sagaResult2.compensated,
  (v) => v === true,
  'true (compensation executed)'
);

// Verify compensation happened in reverse order (charge, then reserve)
// process step failed so it may or may not be compensated
const execPattern = compensationOrder.join(',');

check(
  'compensation in reverse order',
  execPattern.includes('charge_compensate') &&
    execPattern.indexOf('charge_compensate') < execPattern.indexOf('reserve_compensate'),
  (v) => v === true,
  'true (charge compensated before reserve)'
);

check(
  'saga state is compensated',
  sagaResult2.state,
  (v) => v === 'compensated',
  'compensated'
);

// ---------------------------------------------------------------------
// Step 7 - Idempotent processor handles duplicates
// ---------------------------------------------------------------------

console.log('\nStep 7 - idempotent processor handles duplicates');

let processingCount = 0;

const processor = new IdempotentProcessor(
  (req) => `${req.tenant}_${req.prompt}`,
  async (req) => {
    processingCount++;
    return { output: `Processed: ${req.prompt}`, tokens: 100 };
  },
  60000
);

const request1 = { tenant: 'acme', prompt: 'Test prompt' };

// First call - should process
const firstCall = await processor.process(request1);

check(
  'first call processed',
  firstCall.isNew,
  (v) => v === true,
  'true (new request processed)'
);

// Second call - should return cached
const secondCall = await processor.process(request1);

check(
  'second call is duplicate',
  secondCall.isDuplicate,
  (v) => v === true,
  'true (duplicate detected)'
);

check(
  'handler called only once',
  processingCount,
  (v) => v === 1,
  '1 (handler not called for duplicate)'
);

check(
  'duplicate returns same response',
  JSON.stringify(secondCall.response),
  (v) => v === JSON.stringify(firstCall.response),
  JSON.stringify(firstCall.response)
);

// ---------------------------------------------------------------------
// Step 8 - Exactly-once coordinator
// ---------------------------------------------------------------------

console.log('\nStep 8 - exactly-once coordinator');

const coordinator = new ExactlyOnceCoordinator(3, 5000);

let coordinatorHandlerCalls = 0;

// Send a message
const sendResult1 = coordinator.send(
  'coord_key_001',
  { data: 'test payload' },
  async (payload) => {
    coordinatorHandlerCalls++;
    return { processed: true, payload };
  }
);

check(
  'first send is not duplicate',
  sendResult1.isDuplicate,
  (v) => v === false,
  'false (first send is new)'
);

// Wait for delivery
await sleep(100);

// Send duplicate
const sendResult2 = coordinator.send(
  'coord_key_001',
  { data: 'test payload' },
  async (payload) => {
    coordinatorHandlerCalls++;
    return { processed: true };
  }
);

check(
  'second send is duplicate',
  sendResult2.isDuplicate,
  (v) => v === true,
  'true (duplicate detected by producer)'
);

check(
  'duplicate returns same tracking ID',
  sendResult2.trackingId,
  (v) => v === sendResult1.trackingId,
  sendResult1.trackingId
);

// Verify handler was called only for non-duplicate
// Note: handler is called asynchronously, so wait a bit
await sleep(200);

check(
  'handler called only once for duplicates',
  coordinatorHandlerCalls,
  (v) => v === 1,
  '1 (handler not called for duplicate send)'
);

// ---------------------------------------------------------------------
// Step 9 - Dead letter handling
// ---------------------------------------------------------------------

console.log('\nStep 9 - dead letter handling');

const dlq = new DeadLetterHandler();

// Add failed messages
const dlqId1 = dlq.add(
  'failed_key_001',
  { prompt: 'Failed request 1' },
  3,
  'Max retries exceeded'
);

const dlqId2 = dlq.add(
  'failed_key_002',
  { prompt: 'Failed request 2' },
  5,
  'Timeout'
);

check(
  'DLQ entries added',
  dlq.size(),
  (v) => v === 2,
  '2 (two failed messages in DLQ)'
);

// Replay one message successfully
const replayResult = await dlq.replay(dlqId1, async (payload) => {
  return { success: true, payload };
});

check(
  'replay succeeded',
  replayResult.success,
  (v) => v === true,
  'true (message replayed successfully)'
);

check(
  'replayed message removed from DLQ',
  dlq.size(),
  (v) => v === 1,
  '1 (successful replay removed from DLQ)'
);

// ---------------------------------------------------------------------
// Step 10 - Compensation handler tracks records
// ---------------------------------------------------------------------

console.log('\nStep 10 - compensation handler tracks records');

const compHandler = new CompensationHandler();

// Register strategies
compHandler.registerStrategy('charge_customer', 'immediate');
compHandler.registerStrategy('reserve_capacity', 'scheduled');

// Check if compensation is required
const check1 = compHandler.checkCompensation(
  'charge_customer',
  { chargeId: 'chrg_001' },
  'Payment failed after charge'
);

check(
  'compensation required for failed step with output',
  check1.required,
  (v) => v === true,
  'true (step produced output before failure)'
);

// Create compensation record
const record = compHandler.createRecord(
  'saga_001',
  'charge_customer',
  'immediate',
  { chargeId: 'chrg_001' }
);

check(
  'compensation record created',
  record.status,
  (v) => v === 'pending',
  'pending (record created)'
);

// Execute compensation
const compResult = await compHandler.executeCompensation(
  record.id,
  async (ctx) => {
    return { success: true };
  },
  3
);

check(
  'compensation executed successfully',
  compResult.success,
  (v) => v === true,
  'true (compensation completed)'
);

const updatedRecord = compHandler.getRecord(record.id);

check(
  'compensation record marked completed',
  updatedRecord?.status,
  (v) => v === 'completed',
  'completed'
);

// ---------------------------------------------------------------------
// Step 11 - Idempotent compensation
// ---------------------------------------------------------------------

console.log('\nStep 11 - idempotent compensation');

const idempotentComp = new IdempotentCompensation();

let compExecutionCount = 0;

// Execute compensation first time
const comp1 = await idempotentComp.execute('comp_key_001', async () => {
  compExecutionCount++;
  return { success: true };
});

check(
  'first compensation executed',
  comp1.success,
  (v) => v === true,
  'true (compensation executed)'
);

// Execute same compensation again (should be idempotent)
const comp2 = await idempotentComp.execute('comp_key_001', async () => {
  compExecutionCount++;
  return { success: true };
});

check(
  'second compensation is idempotent',
  comp2.success,
  (v) => v === true,
  'true (returned cached result)'
);

check(
  'compensation action called only once',
  compExecutionCount,
  (v) => v === 1,
  '1 (idempotent - action not re-executed)'
);

// ---------------------------------------------------------------------
// Step 12 - Full saga with LLM steps
// ---------------------------------------------------------------------

console.log('\nStep 12 - full saga with LLM steps');

const orchestrator3 = new SagaOrchestrator({
  maxRetries: 2,
  retryDelayMs: 10,
  timeoutMs: 5000,
});

// Simulate external systems
const capacityStore = new Map();
const resultStore = new Map();
const chargeStore = new Map();

orchestrator3.registerSaga({
  type: 'LLMProcessing',
  steps: [
    LLMSagaSteps.reserveCapacity(
      (tenant, tokens) => true, // Always has capacity for test
      (tenant, tokens) => {
        const id = `res_${Date.now()}`;
        capacityStore.set(id, { tenant, tokens });
        return id;
      },
      (reservationId) => {
        capacityStore.delete(reservationId);
      }
    ),
    LLMSagaSteps.callLLM(async (prompt, tier) => {
      return { output: `Response to: ${prompt}`, tokens: 150 };
    }),
    LLMSagaSteps.persistResult(
      (id, data) => {
        resultStore.set(id, data);
      },
      (id) => {
        resultStore.delete(id);
      }
    ),
    LLMSagaSteps.chargeUsage(
      (tenant, amount) => {
        const id = `chrg_${Date.now()}`;
        chargeStore.set(id, { tenant, amount });
        return id;
      },
      (chargeId) => {
        chargeStore.delete(chargeId);
      }
    ),
  ],
});

const fullSagaResult = await orchestrator3.execute('LLMProcessing', {
  tenant: 'acme',
  requestId: 'full_req_001',
  prompt: 'Analyze this document',
  tier: 'frontier',
  estimatedTokens: 1000,
});

check(
  'full LLM saga completed',
  fullSagaResult.success,
  (v) => v === true,
  'true (all steps completed)'
);

check(
  'all four steps completed',
  fullSagaResult.steps.filter((s) => s.state === 'completed').length,
  (v) => v === 4,
  '4 (reserve, call, persist, charge)'
);

// Verify side effects
check(
  'capacity was reserved',
  capacityStore.size,
  (v) => v === 1,
  '1 (reservation exists)'
);

check(
  'result was persisted',
  resultStore.size,
  (v) => v === 1,
  '1 (result exists)'
);

check(
  'charge was recorded',
  chargeStore.size,
  (v) => v === 1,
  '1 (charge exists)'
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
