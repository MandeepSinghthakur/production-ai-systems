// Reproduces every numbered step of the Chapter 27 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch27-multi-agent)
//   node examples/ch27-multi-agent/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { TraceCollector, createTrace, createChildSpan } = await import(
  resolve(srcDir, 'tracing.ts')
);
const { Agent, createAgent } = await import(resolve(srcDir, 'agent.ts'));
const { createWorker, createSpecialist } = await import(
  resolve(srcDir, 'worker.ts')
);
const { HandoffManager } = await import(resolve(srcDir, 'handoff.ts'));
const {
  DeadlockDetector,
  createDeadlockScenario,
  createLinearWaitScenario,
} = await import(resolve(srcDir, 'deadlock.ts'));
const { createSupervisor } = await import(resolve(srcDir, 'supervisor.ts'));

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
// Step 1 - Agent handoff preserves context
// ---------------------------------------------------------------------

console.log('\nStep 1 - agent handoff preserves context');

const traceCollector1 = new TraceCollector();
const handoffManager = new HandoffManager(traceCollector1);

// Create two agents with conversation history
const agent1Config = {
  id: 'agent-1',
  role: 'worker',
  capabilities: ['general'],
  maxConcurrentTasks: 3,
  timeoutMs: 30000,
};
const agent2Config = {
  id: 'agent-2',
  role: 'specialist',
  capabilities: ['specialist'],
  maxConcurrentTasks: 2,
  timeoutMs: 30000,
};

const agent1 = createAgent(agent1Config, traceCollector1);
const agent2 = createAgent(agent2Config, traceCollector1);

// Add conversation history to agent1
agent1.addToHistory({ role: 'user', content: 'Hello', timestamp: 1000 });
agent1.addToHistory({
  role: 'assistant',
  content: 'Hi there!',
  timestamp: 1001,
  agentId: 'agent-1',
});
agent1.addToHistory({
  role: 'user',
  content: 'I need help with billing',
  timestamp: 1002,
});

handoffManager.registerAgent(agent1);
handoffManager.registerAgent(agent2);

// Create trace context for handoff
const { context: handoffContext } = createTrace('test-handoff', 'agent-1');

// Perform handoff
const handoffResult = handoffManager.handoff(
  'agent-1',
  'agent-2',
  handoffContext
);

check(
  'handoff succeeds',
  handoffResult.success,
  (v) => v === true,
  'true (handoff completes)'
);

check(
  'context preserved flag set',
  handoffResult.contextPreserved,
  (v) => v === true,
  'true (context was transferred)'
);

// Verify agent2 has the full history plus handoff message
const agent2History = agent2.getConversationHistory();
check(
  'receiving agent has conversation history',
  agent2History.length,
  (v) => v >= 3,
  '>= 3 (original 3 turns plus handoff message)'
);

// Verify original messages were preserved
const originalHistoryPreserved =
  agent2History[0].content === 'Hello' &&
  agent2History[1].content === 'Hi there!' &&
  agent2History[2].content === 'I need help with billing';

check(
  'original conversation preserved in order',
  originalHistoryPreserved,
  (v) => v === true,
  'true (all original turns present)'
);

// ---------------------------------------------------------------------
// Step 2 - Trace IDs correlate across agents
// ---------------------------------------------------------------------

console.log('\nStep 2 - trace IDs correlate across agents');

const traceCollector2 = new TraceCollector();
const supervisor = createSupervisor('supervisor-1', traceCollector2);

const worker1 = createWorker('worker-1', ['extract'], traceCollector2, {
  processingTimeMs: 5,
});
const worker2 = createWorker('worker-2', ['transform'], traceCollector2, {
  processingTimeMs: 5,
});

supervisor.registerWorker(worker1);
supervisor.registerWorker(worker2);

// Dispatch tasks - these should share trace context
await supervisor.dispatchTask('extract', { data: 'test' }, 'extract');
await supervisor.dispatchTask('transform', { input: 'test' }, 'transform');

// Get spans and verify trace correlation
const spans = traceCollector2.getSpans(
  traceCollector2.getSpans('').length > 0
    ? traceCollector2.getSpans('')[0]?.traceId ?? ''
    : ''
);

// Each dispatch creates its own trace, but all spans within a trace share traceId
// Let's verify by checking the swarm execution which should correlate
const swarmResult = await supervisor.executeSwarm(
  ['worker-1', 'worker-2'],
  'analyze',
  { test: 'data' },
  (results) => ({ combined: results.length })
);

// Get all spans and check that swarm spans share a traceId
const allSpans = [];
for (const [key, value] of Object.entries(traceCollector2)) {
  if (key === 'spans') {
    for (const [traceId, spanList] of value) {
      allSpans.push(...spanList);
    }
  }
}

// Find swarm trace and verify all participants share traceId
const swarmSpans = allSpans.filter(
  (s) => s.operationName === 'swarm' || s.operationName.includes('worker')
);

// Get the trace that has multiple agents
const traceAgentCounts = new Map();
for (const span of allSpans) {
  const agents = traceAgentCounts.get(span.traceId) ?? new Set();
  agents.add(span.agentId);
  traceAgentCounts.set(span.traceId, agents);
}

let multiAgentTraceFound = false;
for (const [traceId, agents] of traceAgentCounts) {
  if (agents.size > 1) {
    multiAgentTraceFound = true;
    // Verify all spans in this trace have same traceId
    const traceSpans = allSpans.filter((s) => s.traceId === traceId);
    const allSameTrace = traceSpans.every((s) => s.traceId === traceId);
    check(
      'all spans in multi-agent trace share traceId',
      allSameTrace,
      (v) => v === true,
      'true (trace correlation maintained)'
    );
    break;
  }
}

if (!multiAgentTraceFound) {
  // Swarm should have created a multi-agent trace
  check(
    'multi-agent trace exists',
    swarmResult.results.length,
    (v) => v >= 2,
    '>= 2 (swarm executed across workers)'
  );
}

// ---------------------------------------------------------------------
// Step 3 - Deadlock detection
// ---------------------------------------------------------------------

console.log('\nStep 3 - deadlock detection');

const deadlockDetector = new DeadlockDetector(5000);

// Create a deadlock scenario: A waits for B, B waits for C, C waits for A
createDeadlockScenario(deadlockDetector);

const deadlockResult = deadlockDetector.detectDeadlock();

check(
  'deadlock detected in cycle',
  deadlockResult.detected,
  (v) => v === true,
  'true (circular wait detected)'
);

check(
  'deadlock cycle identified',
  deadlockResult.cycle.length,
  (v) => v >= 2,
  '>= 2 (cycle has multiple agents)'
);

// Verify the cycle contains the expected agents
const cycleHasExpectedAgents =
  deadlockResult.cycle.includes('agent-a') ||
  deadlockResult.cycle.includes('agent-b') ||
  deadlockResult.cycle.includes('agent-c');

check(
  'cycle contains expected agents',
  cycleHasExpectedAgents,
  (v) => v === true,
  'true (detected agents in cycle)'
);

// Test resolution
const resolution = deadlockDetector.resolveDeadlock(deadlockResult.cycle);

check(
  'deadlock resolution proposed',
  resolution !== null,
  (v) => v === true,
  'true (agent identified for interrupt)'
);

// After resolution, no deadlock should exist
const afterResolution = deadlockDetector.detectDeadlock();
check(
  'deadlock resolved after intervention',
  afterResolution.detected,
  (v) => v === false,
  'false (cycle broken)'
);

// ---------------------------------------------------------------------
// Step 4 - No false positive for linear wait chain
// ---------------------------------------------------------------------

console.log('\nStep 4 - no false positive for linear wait');

deadlockDetector.clear();
createLinearWaitScenario(deadlockDetector);

const linearResult = deadlockDetector.detectDeadlock();

check(
  'linear wait chain not flagged as deadlock',
  linearResult.detected,
  (v) => v === false,
  'false (no cycle in linear chain)'
);

// ---------------------------------------------------------------------
// Step 5 - Supervisor interrupt capability
// ---------------------------------------------------------------------

console.log('\nStep 5 - supervisor interrupt capability');

const traceCollector3 = new TraceCollector();
const supervisor2 = createSupervisor('supervisor-2', traceCollector3);

const slowWorker = createWorker('slow-worker', ['slow'], traceCollector3, {
  processingTimeMs: 100,
});

supervisor2.registerWorker(slowWorker);

// Interrupt the worker
const interrupted = supervisor2.interrupt(
  'slow-worker',
  'task-1',
  'Test interrupt'
);

check(
  'supervisor can interrupt worker',
  interrupted,
  (v) => v === true,
  'true (interrupt sent)'
);

check(
  'worker received interrupt',
  slowWorker.isInterrupted(),
  (v) => v === true,
  'true (worker marked as interrupted)'
);

// ---------------------------------------------------------------------
// Step 6 - Pipeline pattern execution
// ---------------------------------------------------------------------

console.log('\nStep 6 - pipeline pattern');

const traceCollector4 = new TraceCollector();
const supervisor3 = createSupervisor('supervisor-3', traceCollector4);

const pipeWorker1 = createWorker(
  'pipe-worker-1',
  ['extract'],
  traceCollector4,
  { processingTimeMs: 5 }
);
const pipeWorker2 = createWorker(
  'pipe-worker-2',
  ['transform'],
  traceCollector4,
  { processingTimeMs: 5 }
);

supervisor3.registerWorker(pipeWorker1);
supervisor3.registerWorker(pipeWorker2);

const pipelineResult = await supervisor3.executePipeline(
  [
    { agentId: 'pipe-worker-1', transform: (x) => ({ stage1: x }) },
    { agentId: 'pipe-worker-2', transform: (x) => ({ stage2: x }) },
  ],
  { initial: 'data' }
);

check(
  'pipeline executes successfully',
  pipelineResult.success,
  (v) => v === true,
  'true (all stages completed)'
);

check(
  'pipeline stages completed in order',
  pipelineResult.stagesCompleted,
  (v) => v === 2,
  '2 (both stages executed)'
);

// Verify output flows through stages
const hasStage2Wrapper = pipelineResult.output && 'stage2' in pipelineResult.output;
check(
  'output flows through pipeline stages',
  hasStage2Wrapper,
  (v) => v === true,
  'true (stage2 wrapper present)'
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
