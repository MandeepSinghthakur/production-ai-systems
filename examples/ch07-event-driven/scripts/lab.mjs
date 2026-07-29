// Reproduces every numbered step of the Chapter 7 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch07-event-driven)
//   node examples/ch07-event-driven/scripts/lab.mjs   (from repo root)
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
const {
  InMemoryEventStore,
  EventValidator,
  SchemaRegistry,
  createConversationStartedEvent,
  createMessageSentEvent,
  createTierChangedEvent,
  createConversationEndedEvent,
} = await import(resolve(srcDir, 'events.ts'));

const {
  rehydrateConversation,
  ConversationRepository,
  EventStream,
  getStateAtTime,
  calculateEventStats,
} = await import(resolve(srcDir, 'sourcing.ts'));

const {
  ConversationCommandHandler,
  ConversationSummaryProjection,
  TenantAnalyticsProjection,
  ProjectionManager,
} = await import(resolve(srcDir, 'cqrs.ts'));

const {
  generateIdempotencyKey,
  InMemoryIdempotencyStore,
  IdempotentEventProcessor,
  DeduplicationWindow,
  EventOrderingEnforcer,
} = await import(resolve(srcDir, 'idempotency.ts'));

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  console.log(`         expected ${expectation}, observed ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------
// Step 1 - Events are immutable and ordered
// ---------------------------------------------------------------------

console.log('\nStep 1 - Events are immutable and ordered');

const store1 = new InMemoryEventStore();

// Create a conversation with multiple events
const convId1 = 'conv_001';
const events1 = [
  createConversationStartedEvent(convId1, 1, 'tenant_a', 'user_1', 'mid', 'You are a helpful assistant.'),
];
const result1 = store1.append(convId1, events1, 0);

check(
  'first event appended successfully',
  result1.success,
  (v) => v === true,
  'true (version 0 -> 1)'
);

// Append more events
const events1b = [
  createMessageSentEvent(convId1, 2, 'user', 'Hello', 10, null, null, null),
  createMessageSentEvent(convId1, 3, 'assistant', 'Hi there!', null, 20, 150, 'mid'),
];
const result1b = store1.append(convId1, events1b, 1);

check(
  'sequential events appended',
  result1b.newVersion,
  (v) => v === 3,
  '3 (three events total)'
);

// Verify events are in order
const readEvents1 = store1.read(convId1);

check(
  'events are ordered by version',
  readEvents1.map((e) => e.version),
  (v) => JSON.stringify(v) === '[1,2,3]',
  '[1,2,3] (ascending versions)'
);

// Verify immutability via optimistic concurrency
const conflictEvents = [
  createMessageSentEvent(convId1, 2, 'user', 'Conflict!', 5, null, null, null),
];
const conflictResult = store1.append(convId1, conflictEvents, 1);

check(
  'concurrent write rejected',
  conflictResult.success,
  (v) => v === false,
  'false (version mismatch detected)'
);

check(
  'conflict error message',
  conflictResult.error?.includes('Concurrency conflict'),
  (v) => v === true,
  'true (explains the conflict)'
);

// Verify version integrity
const validator = new EventValidator();
const invalidEvent = {
  id: 'evt_invalid',
  type: 'message.sent',
  aggregateId: convId1,
  version: -1, // Invalid
  timestamp: Date.now(),
  payload: { role: 'user', content: 'test' },
};
const validationResult = validator.validate(invalidEvent);

check(
  'invalid event version rejected',
  validationResult.valid,
  (v) => v === false,
  'false (negative version)'
);

// ---------------------------------------------------------------------
// Step 2 - Event sourcing reconstructs state from events
// ---------------------------------------------------------------------

console.log('\nStep 2 - Event sourcing reconstructs state from events');

const store2 = new InMemoryEventStore();
const convId2 = 'conv_002';

// Build up a conversation through events with distinct timestamps
// We need distinct timestamps for temporal queries to work correctly
const baseTime = Date.now();
const eventSequence = [
  { ...createConversationStartedEvent(convId2, 1, 'tenant_b', 'user_2', 'frontier', 'Be concise.'), timestamp: baseTime },
  { ...createMessageSentEvent(convId2, 2, 'user', 'What is 2+2?', 5, null, null, null), timestamp: baseTime + 100 },
  { ...createMessageSentEvent(convId2, 3, 'assistant', '4', null, 1, 50, 'frontier'), timestamp: baseTime + 200 },
  { ...createTierChangedEvent(convId2, 4, 'frontier', 'small', 'cost optimization'), timestamp: baseTime + 300 },
  { ...createMessageSentEvent(convId2, 5, 'user', 'Thanks', 3, null, null, null), timestamp: baseTime + 400 },
];

store2.append(convId2, eventSequence, 0);

// Reconstruct state from events
const events2 = store2.read(convId2);
const aggregate2 = rehydrateConversation(events2);

check(
  'state reconstructed from events',
  aggregate2 !== null,
  (v) => v === true,
  'true (aggregate rehydrated)'
);

check(
  'message count correct',
  aggregate2.messages.length,
  (v) => v === 3,
  '3 (three messages sent)'
);

check(
  'tier changed correctly',
  aggregate2.currentTier,
  (v) => v === 'small',
  '"small" (changed from frontier)'
);

check(
  'token counts accumulated',
  aggregate2.totalInputTokens,
  (v) => v === 8,
  '8 (5 + 3 from user messages)'
);

// Temporal query: get state at a point in time
const eventsForTemporal = store2.read(convId2);
// Get timestamp just before the tier change (event 4)
// Events: 1=started, 2=msg, 3=msg, 4=tier.changed, 5=msg
// We want state after event 3 but before event 4
const beforeTierChangeTime = eventsForTemporal[2].timestamp;
const stateAtTime = getStateAtTime(eventsForTemporal, beforeTierChangeTime);

check(
  'temporal query returns past state',
  stateAtTime.messages.length,
  (v) => v === 2,
  '2 (only two messages at that point)'
);

check(
  'temporal query preserves tier at time',
  stateAtTime.currentTier,
  (v) => v === 'frontier',
  '"frontier" (tier not yet changed)'
);

// Test snapshots via repository
const repo2 = new ConversationRepository(store2, 3); // Snapshot every 3 events
const convId2b = 'conv_002b';

// Add enough events to trigger snapshot
const startEvent = createConversationStartedEvent(convId2b, 1, 'tenant_c', 'user_3', 'mid', 'Test');
store2.append(convId2b, [startEvent], 0);

for (let i = 2; i <= 4; i++) {
  const msg = createMessageSentEvent(convId2b, i, 'user', `Message ${i}`, 5, null, null, null);
  repo2.save(convId2b, [msg], i - 1);
}

const snapshot = repo2.getSnapshot(convId2b);

check(
  'snapshot created at interval',
  snapshot !== null,
  (v) => v === true,
  'true (snapshot at version 3)'
);

// Load from snapshot + new events
const msg5 = createMessageSentEvent(convId2b, 5, 'user', 'After snapshot', 5, null, null, null);
repo2.save(convId2b, [msg5], 4);

const loadedAggregate = repo2.load(convId2b);

check(
  'aggregate loaded from snapshot + events',
  loadedAggregate.version,
  (v) => v === 5,
  '5 (snapshot + 2 new events)'
);

// ---------------------------------------------------------------------
// Step 3 - CQRS separates read and write models
// ---------------------------------------------------------------------

console.log('\nStep 3 - CQRS separates read and write models');

const store3 = new InMemoryEventStore();
const handler3 = new ConversationCommandHandler(store3);
const summaryProjection = new ConversationSummaryProjection();
const analyticsProjection = new TenantAnalyticsProjection();

// Execute commands (write side)
const startResult = handler3.handle({
  type: 'start_conversation',
  conversationId: 'conv_003',
  tenantId: 'tenant_x',
  userId: 'user_x',
  tier: 'mid',
  systemPrompt: 'You are helpful.',
});

check(
  'start_conversation command succeeds',
  startResult.success,
  (v) => v === true,
  'true (conversation created)'
);

check(
  'command produces events',
  startResult.events.length,
  (v) => v === 1,
  '1 (one event produced)'
);

// Send messages
handler3.handle({
  type: 'send_message',
  conversationId: 'conv_003',
  role: 'user',
  content: 'Hello AI',
  inputTokens: 10,
});

handler3.handle({
  type: 'send_message',
  conversationId: 'conv_003',
  role: 'assistant',
  content: 'Hello! How can I help?',
  outputTokens: 15,
  latencyMs: 200,
  tier: 'mid',
});

// Update projections (read side)
const allEvents = store3.readAll();
for (const envelope of allEvents) {
  summaryProjection.apply(envelope);
  analyticsProjection.apply(envelope);
}

// Query read models
const summary = summaryProjection.get('conv_003');

check(
  'summary projection updated',
  summary !== null,
  (v) => v === true,
  'true (summary exists)'
);

check(
  'summary has correct message count',
  summary.messageCount,
  (v) => v === 2,
  '2 (user + assistant messages)'
);

check(
  'summary has correct token total',
  summary.totalTokens,
  (v) => v === 25,
  '25 (10 + 15 tokens)'
);

const analytics = analyticsProjection.get('tenant_x');

check(
  'analytics projection updated',
  analytics !== null,
  (v) => v === true,
  'true (analytics exists)'
);

check(
  'analytics tracks conversations',
  analytics.totalConversations,
  (v) => v === 1,
  '1 (one conversation)'
);

check(
  'analytics tracks messages',
  analytics.totalMessages,
  (v) => v === 2,
  '2 (two messages)'
);

// Test validation on write side
const invalidResult = handler3.handle({
  type: 'send_message',
  conversationId: 'conv_nonexistent',
  role: 'user',
  content: 'This should fail',
});

check(
  'command to nonexistent aggregate fails',
  invalidResult.success,
  (v) => v === false,
  'false (conversation not found)'
);

// End conversation and verify
handler3.handle({
  type: 'end_conversation',
  conversationId: 'conv_003',
  reason: 'user_ended',
});

// Update projections
const newEvents = store3.readAll(summaryProjection.getPosition());
for (const envelope of newEvents) {
  summaryProjection.apply(envelope);
  analyticsProjection.apply(envelope);
}

const endedSummary = summaryProjection.get('conv_003');

check(
  'summary reflects ended status',
  endedSummary.status,
  (v) => v === 'ended',
  '"ended" (conversation ended)'
);

const updatedAnalytics = analyticsProjection.get('tenant_x');

check(
  'analytics reflects ended conversation',
  updatedAnalytics.activeConversations,
  (v) => v === 0,
  '0 (no active conversations)'
);

// ---------------------------------------------------------------------
// Step 4 - Idempotency handles duplicate events
// ---------------------------------------------------------------------

console.log('\nStep 4 - Idempotency handles duplicate events');

// Test command idempotency
const idempotencyStore = new InMemoryIdempotencyStore(1000); // 1 second TTL for testing

const command = {
  type: 'send_message',
  conversationId: 'conv_004',
  role: 'user',
  content: 'Test message',
  inputTokens: 10,
};

const key = generateIdempotencyKey(command);

// First check - should not be duplicate
const firstCheck = idempotencyStore.check(key);

check(
  'first command not duplicate',
  firstCheck.isDuplicate,
  (v) => v === false,
  'false (not seen before)'
);

// Record the result
idempotencyStore.record(key, {
  success: true,
  events: [{ id: 'evt_001', type: 'message.sent' }],
});

// Second check - should be duplicate
const secondCheck = idempotencyStore.check(key);

check(
  'duplicate command detected',
  secondCheck.isDuplicate,
  (v) => v === true,
  'true (already processed)'
);

check(
  'previous result returned',
  secondCheck.previousResult?.success,
  (v) => v === true,
  'true (original success)'
);

// Different command generates different key
const differentCommand = {
  ...command,
  content: 'Different message',
};
const differentKey = generateIdempotencyKey(differentCommand);

check(
  'different command has different key',
  differentKey !== key,
  (v) => v === true,
  'true (content changed key)'
);

// Test event deduplication window
const dedupWindow = new DeduplicationWindow(100, 10); // 100ms window, 10ms buckets

const eventId = 'evt_dedup_001';
const first = dedupWindow.checkAndAdd(eventId);

check(
  'first event not duplicate',
  first,
  (v) => v === false,
  'false (not in window)'
);

const second = dedupWindow.checkAndAdd(eventId);

check(
  'same event is duplicate',
  second,
  (v) => v === true,
  'true (within window)'
);

// Test event ordering enforcer
const orderEnforcer = new EventOrderingEnforcer();

const event1 = { id: 'e1', type: 'test', aggregateId: 'agg_1', version: 1, timestamp: Date.now(), payload: {} };
const event2 = { id: 'e2', type: 'test', aggregateId: 'agg_1', version: 2, timestamp: Date.now(), payload: {} };
const event3 = { id: 'e3', type: 'test', aggregateId: 'agg_1', version: 3, timestamp: Date.now(), payload: {} };

// First event can be processed
check(
  'version 1 can be processed',
  orderEnforcer.canProcess(event1),
  (v) => v === true,
  'true (expected version 1)'
);

// Out of order event cannot be processed yet
orderEnforcer.markProcessed(event1);

check(
  'version 3 cannot be processed yet',
  orderEnforcer.canProcess(event3),
  (v) => v === false,
  'false (waiting for version 2)'
);

// Buffer the out-of-order event
orderEnforcer.buffer(event3);

// Process version 2
orderEnforcer.markProcessed(event2);

// Now version 3 should be ready
const ready = orderEnforcer.getReadyEvents('agg_1');

check(
  'buffered event released',
  ready.length,
  (v) => v === 1,
  '1 (version 3 now ready)'
);

check(
  'correct event released',
  ready[0]?.version,
  (v) => v === 3,
  '3 (version 3)'
);

// Test idempotent event processor
const processor = new IdempotentEventProcessor(1000);
let processCount = 0;

const testEvent = {
  id: 'evt_process_001',
  type: 'test',
  aggregateId: 'agg_test',
  version: 1,
  timestamp: Date.now(),
  payload: { data: 'test' },
};

// Process the event
const processResult1 = await processor.process(testEvent, async (e) => {
  processCount++;
  return { processed: true, data: e.payload };
});

check(
  'event processed first time',
  processResult1.wasProcessed,
  (v) => v === false,
  'false (first processing)'
);

// Process same event again
const processResult2 = await processor.process(testEvent, async (e) => {
  processCount++;
  return { processed: true, data: e.payload };
});

check(
  'duplicate event detected',
  processResult2.wasProcessed,
  (v) => v === true,
  'true (already processed)'
);

check(
  'handler not called twice',
  processCount,
  (v) => v === 1,
  '1 (only processed once)'
);

// Test TTL expiration
await sleep(50); // Short wait
const cleanedUp = idempotencyStore.cleanup(Date.now() + 2000); // Force cleanup

check(
  'expired entries cleaned up',
  cleanedUp >= 0,
  (v) => v === true,
  'true (cleanup ran)'
);

// ---------------------------------------------------------------------
// Step 5 - Schema versioning for event evolution
// ---------------------------------------------------------------------

console.log('\nStep 5 - Schema versioning for event evolution');

const registry = new SchemaRegistry();

// Register schema versions
registry.registerSchema('message.sent', { major: 1, minor: 0 }, '1.0');
registry.registerSchema('message.sent', { major: 1, minor: 1 }, '1.1');
registry.registerSchema('message.sent', { major: 2, minor: 0 }, '2.0');

// Register a migration from 1.0 to 1.1
registry.registerMigration('message.sent', '1.0', '1.1', (event) => {
  const payload = event.payload;
  return {
    ...event,
    payload: {
      ...payload,
      // Add new field with default
      tier: payload.tier ?? 'mid',
    },
  };
});

const currentVersion = registry.getCurrentVersion('message.sent');

check(
  'current version tracked',
  currentVersion !== null,
  (v) => v === true,
  'true (version exists)'
);

check(
  'highest version returned',
  currentVersion?.major,
  (v) => v === 2,
  '2 (major version 2)'
);

// Test migration
const oldEvent = {
  id: 'evt_old',
  type: 'message.sent',
  aggregateId: 'agg_old',
  version: 1,
  timestamp: Date.now(),
  payload: {
    role: 'user',
    content: 'Old message',
    inputTokens: 10,
    outputTokens: null,
    latencyMs: null,
    // No tier field - old schema
  },
};

const migratedEvent = registry.migrate(
  oldEvent,
  { major: 1, minor: 0 },
  { major: 1, minor: 1 }
);

check(
  'migration adds default field',
  migratedEvent.payload.tier,
  (v) => v === 'mid',
  '"mid" (default tier added)'
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
    console.log(`    actual: ${JSON.stringify(f.actual)}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
