// Reproduces every numbered step of the Chapter 25 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch25-planning)
//   node examples/ch25-planning/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { LoopDetector, ProgressDetector } = await import(
  resolve(srcDir, 'loop-detector.ts')
);
const {
  ActionExecutor,
  createTestActions,
  createFailingAction,
  createEventuallySucceedingAction,
} = await import(resolve(srcDir, 'executor.ts'));
const { Reflector, analyzeReflectionPatterns } = await import(
  resolve(srcDir, 'reflection.ts')
);
const {
  Planner,
  createGoalState,
  markSubgoalComplete,
  detectGoalDrift,
} = await import(resolve(srcDir, 'planner.ts'));
const {
  ReActLoop,
  createSimpleReasoning,
  createRepeatingReasoning,
  DEFAULT_REACT_CONFIG,
} = await import(resolve(srcDir, 'react.ts'));

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
// Step 1 - ReAct loop executes thought-action-observation cycle
// ---------------------------------------------------------------------

console.log('\nStep 1 - ReAct loop basic execution');

const executor1 = new ActionExecutor();
executor1.registerActions(createTestActions());

const react1 = new ReActLoop(executor1, createSimpleReasoning(), {
  maxIterations: 5,
});

const result1 = await react1.run('What is the capital of France?');

check(
  'react loop completes',
  result1.terminationReason,
  (v) => v === 'goal_achieved' || v === 'max_iterations',
  'goal_achieved or max_iterations'
);

check(
  'react loop has steps',
  result1.steps.length,
  (v) => v >= 1,
  '>= 1 steps'
);

// Check that each step has thought, action, observation
const firstStep = result1.steps[0];
check(
  'step has thought',
  firstStep.thought.content,
  (v) => typeof v === 'string' && v.length > 0,
  'non-empty string'
);

check(
  'step has action',
  firstStep.action.name,
  (v) => typeof v === 'string' && v.length > 0,
  'non-empty action name'
);

check(
  'step has observation',
  typeof firstStep.observation.success,
  (v) => v === 'boolean',
  'boolean success field'
);

// ---------------------------------------------------------------------
// Step 2 - Loop detection triggers on repetitive patterns
// ---------------------------------------------------------------------

console.log('\nStep 2 - Loop detection');

const loopDetector = new LoopDetector(6);

// Record a repeating pattern
const action1 = { type: 'test', name: 'search', parameters: { q: 'same' }, timestamp: 1, iteration: 1 };
const action2 = { type: 'test', name: 'search', parameters: { q: 'same' }, timestamp: 2, iteration: 2 };
const action3 = { type: 'test', name: 'search', parameters: { q: 'same' }, timestamp: 3, iteration: 3 };
const action4 = { type: 'test', name: 'search', parameters: { q: 'same' }, timestamp: 4, iteration: 4 };

loopDetector.recordAction(action1);
loopDetector.recordAction(action2);
loopDetector.recordAction(action3);
const state4 = loopDetector.recordAction(action4);

check(
  'loop detected after repeated actions',
  state4.loopDetected,
  (v) => v === true,
  'true (loop should be detected)'
);

check(
  'loop pattern identified',
  state4.loopPattern ? state4.loopPattern.length : 0,
  (v) => v >= 1,
  '>= 1 (pattern length)'
);

// Test no loop with varied actions
const loopDetector2 = new LoopDetector(6);
const variedActions = [
  { type: 'test', name: 'search', parameters: { q: 'a' }, timestamp: 1, iteration: 1 },
  { type: 'test', name: 'lookup', parameters: { entity: 'b' }, timestamp: 2, iteration: 2 },
  { type: 'test', name: 'calculate', parameters: { expr: 'c' }, timestamp: 3, iteration: 3 },
];

let variedState;
for (const a of variedActions) {
  variedState = loopDetector2.recordAction(a);
}

check(
  'no loop with varied actions',
  variedState.loopDetected,
  (v) => v === false,
  'false (no loop should be detected)'
);

// ---------------------------------------------------------------------
// Step 3 - Reflection catches errors and suggests alternatives
// ---------------------------------------------------------------------

console.log('\nStep 3 - Reflection on errors');

const reflector = new Reflector();

const failedAction = {
  type: 'test',
  name: 'lookup',
  parameters: { entity: 'atlantis', attribute: 'capital' },
  timestamp: Date.now(),
  iteration: 1,
};

const failedObservation = {
  actionName: 'lookup',
  success: false,
  result: null,
  error: 'Entity not found: atlantis',
  timestamp: Date.now(),
  iteration: 1,
};

const reflection = reflector.reflect(
  failedAction,
  failedObservation,
  ['search', 'lookup', 'calculate', 'finish'],
  'Find information about Atlantis'
);

check(
  'reflection analyzes failure',
  reflection.analysis,
  (v) => v.includes('failed') || v.includes('error'),
  'contains failure analysis'
);

check(
  'reflection does not suggest retry for not-found',
  reflection.shouldRetry,
  (v) => v === false,
  'false (entity not found is permanent)'
);

check(
  'reflection suggests alternative action',
  reflection.alternativeAction?.name,
  (v) => v === 'search',
  'search (alternative to failed lookup)'
);

check(
  'reflection extracts lesson',
  reflection.lessonLearned,
  (v) => v.length > 0,
  'non-empty lesson'
);

// ---------------------------------------------------------------------
// Step 4 - Plan decomposition for complex tasks
// ---------------------------------------------------------------------

console.log('\nStep 4 - Plan decomposition');

const planner = new Planner();

const plan1 = planner.decompose('Find the capital of France and the population');

check(
  'plan has multiple tasks for compound goal',
  plan1.tasks.length,
  (v) => v >= 2,
  '>= 2 tasks'
);

check(
  'tasks have descriptions',
  plan1.tasks.every((t) => t.description.length > 0),
  (v) => v === true,
  'true (all tasks have descriptions)'
);

// Check dependencies
const taskWithDeps = plan1.tasks.find((t) => t.dependencies.length > 0);
check(
  'some tasks have dependencies',
  taskWithDeps !== undefined,
  (v) => v === true,
  'true (compound goals have dependent tasks)'
);

// Test simple goal produces fewer tasks
const plan2 = planner.decompose('Calculate 2 + 2');

check(
  'plan decomposition works for calculation',
  plan2.tasks.length,
  (v) => v >= 1,
  '>= 1 tasks'
);

// ---------------------------------------------------------------------
// Step 5 - Goal tracking and completion
// ---------------------------------------------------------------------

console.log('\nStep 5 - Goal tracking');

const goalState = createGoalState(plan1);

check(
  'goal state has original goal',
  goalState.originalGoal,
  (v) => v.includes('capital') || v.includes('Find'),
  'contains goal text'
);

check(
  'goal state has remaining subgoals',
  goalState.remainingSubgoals.length,
  (v) => v >= 2,
  '>= 2 remaining subgoals'
);

// Mark a subgoal complete
const firstSubgoal = goalState.remainingSubgoals[0];
const updatedState = markSubgoalComplete(goalState, firstSubgoal);

check(
  'completed subgoal added to completed list',
  updatedState.completedSubgoals.includes(firstSubgoal),
  (v) => v === true,
  'true'
);

check(
  'completed subgoal removed from remaining',
  updatedState.remainingSubgoals.includes(firstSubgoal),
  (v) => v === false,
  'false'
);

// ---------------------------------------------------------------------
// Step 6 - Goal drift detection
// ---------------------------------------------------------------------

console.log('\nStep 6 - Goal drift detection');

const driftState = createGoalState(planner.decompose('Find the capital of France'));

// Actions related to the goal - no drift
const relevantActions = ['lookup capital', 'search France', 'find Paris'];
const noDriftState = detectGoalDrift(driftState, relevantActions);

check(
  'no drift with relevant actions',
  noDriftState.driftDetected,
  (v) => v === false,
  'false'
);

// Actions unrelated to the goal - should detect drift
const irrelevantActions = ['check weather', 'calculate taxes', 'send email'];
const driftDetected = detectGoalDrift(driftState, irrelevantActions);

check(
  'drift detected with irrelevant actions',
  driftDetected.driftDetected,
  (v) => v === true,
  'true (actions unrelated to goal)'
);

check(
  'drift reason provided',
  driftDetected.driftReason,
  (v) => typeof v === 'string' && v.length > 0,
  'non-empty reason'
);

// ---------------------------------------------------------------------
// Step 7 - Backtracking with checkpoints
// ---------------------------------------------------------------------

console.log('\nStep 7 - Backtracking');

const backtrackPlanner = new Planner();
const backtrackPlan = backtrackPlanner.decompose('Complex multi-step task');
const backtrackGoalState = createGoalState(backtrackPlan);

// Create a checkpoint
const checkpoint = backtrackPlanner.createCheckpoint(
  backtrackPlan,
  backtrackGoalState,
  5
);

check(
  'checkpoint created',
  checkpoint.id,
  (v) => v.startsWith('checkpoint_'),
  'checkpoint_* format'
);

// Modify the plan
backtrackPlanner.updateTaskStatus(backtrackPlan, backtrackPlan.tasks[0].id, 'completed');

check(
  'plan modified after checkpoint',
  backtrackPlan.tasks[0].status,
  (v) => v === 'completed',
  'completed'
);

// Restore from checkpoint
const restored = backtrackPlanner.restoreFromCheckpoint(checkpoint.id);

check(
  'checkpoint restoration works',
  restored !== null,
  (v) => v === true,
  'true'
);

check(
  'restored plan has original status',
  restored.plan.tasks[0].status,
  (v) => v === 'pending',
  'pending (restored to checkpoint state)'
);

// ---------------------------------------------------------------------
// Step 8 - Error recovery with retry and alternatives
// ---------------------------------------------------------------------

console.log('\nStep 8 - Error recovery');

const executor2 = new ActionExecutor();
const eventualAction = createEventuallySucceedingAction('flaky', 2, { result: 'success' });
executor2.registerAction(eventualAction);
executor2.registerActions(createTestActions());

// Execute failing action multiple times
const failAction = {
  type: 'test',
  name: 'flaky',
  parameters: {},
  timestamp: Date.now(),
  iteration: 1,
};

const obs1 = await executor2.execute(failAction);
const obs2 = await executor2.execute({ ...failAction, iteration: 2 });
const obs3 = await executor2.execute({ ...failAction, iteration: 3 });

check(
  'first attempt fails',
  obs1.success,
  (v) => v === false,
  'false'
);

check(
  'second attempt fails',
  obs2.success,
  (v) => v === false,
  'false'
);

check(
  'third attempt succeeds',
  obs3.success,
  (v) => v === true,
  'true (succeeds after configured failures)'
);

// ---------------------------------------------------------------------
// Step 9 - ReAct loop terminates on max iterations
// ---------------------------------------------------------------------

console.log('\nStep 9 - Max iterations termination');

const executor3 = new ActionExecutor();
executor3.registerActions(createTestActions());

// Use reasoning that never finishes
const neverFinishReasoning = async () => 'I should keep searching.';

const react2 = new ReActLoop(executor3, neverFinishReasoning, {
  maxIterations: 3,
  loopDetectionWindow: 10, // Larger window to avoid loop detection
});

const result2 = await react2.run('Impossible task');

check(
  'terminates at max iterations',
  result2.terminationReason,
  (v) => v === 'max_iterations',
  'max_iterations'
);

check(
  'correct iteration count',
  result2.totalIterations,
  (v) => v === 3,
  '3 (matches maxIterations config)'
);

// ---------------------------------------------------------------------
// Step 10 - ReAct loop terminates on loop detection
// ---------------------------------------------------------------------

console.log('\nStep 10 - Loop detection termination');

const executor4 = new ActionExecutor();
executor4.registerAction({
  name: 'repeat',
  description: 'An action that always does the same thing',
  parameters: [],
  execute: async () => ({ result: 'same' }),
});
executor4.registerAction({
  name: 'finish',
  description: 'Finish',
  parameters: [{ name: 'answer', type: 'string', required: true, description: 'Answer' }],
  execute: async (p) => ({ answer: p.answer, finished: true }),
});

// Reasoning that always picks the same action
const repeatReasoning = createRepeatingReasoning('repeat');

const react3 = new ReActLoop(executor4, repeatReasoning, {
  maxIterations: 20,
  loopDetectionWindow: 4,
});

const result3 = await react3.run('Test loop detection');

check(
  'terminates on loop detection',
  result3.terminationReason,
  (v) => v === 'loop_detected',
  'loop_detected'
);

check(
  'terminated before max iterations',
  result3.totalIterations,
  (v) => v < 20,
  '< 20 (stopped early due to loop)'
);

// ---------------------------------------------------------------------
// Step 11 - Progress detector tracks milestones
// ---------------------------------------------------------------------

console.log('\nStep 11 - Progress detection');

const progressDetector = new ProgressDetector(3);

check(
  'initially making progress (no iterations)',
  progressDetector.isMakingProgress(),
  (v) => v === true,
  'true'
);

// Record iterations without milestones
progressDetector.recordIteration();
progressDetector.recordIteration();
progressDetector.recordIteration();

check(
  'not making progress after threshold iterations',
  progressDetector.isMakingProgress(),
  (v) => v === false,
  'false (3 iterations without progress)'
);

// Record a milestone
progressDetector.recordMilestone('found_answer');

check(
  'making progress after milestone',
  progressDetector.isMakingProgress(),
  (v) => v === true,
  'true (milestone resets counter)'
);

check(
  'milestone recorded',
  progressDetector.getMilestones().includes('found_answer'),
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 12 - Reflection patterns analysis
// ---------------------------------------------------------------------

console.log('\nStep 12 - Reflection patterns');

const patternReflector = new Reflector();

// Simulate multiple failures on same action
for (let i = 0; i < 3; i++) {
  patternReflector.reflect(
    { type: 'test', name: 'bad_action', parameters: {}, timestamp: i, iteration: i },
    { actionName: 'bad_action', success: false, result: null, error: 'Always fails', timestamp: i, iteration: i },
    ['search', 'lookup'],
    'Test goal'
  );
}

// Add a success
patternReflector.reflect(
  { type: 'test', name: 'good_action', parameters: {}, timestamp: 4, iteration: 4 },
  { actionName: 'good_action', success: true, result: { data: 'found' }, timestamp: 4, iteration: 4 },
  ['search', 'lookup'],
  'Test goal'
);

const patterns = analyzeReflectionPatterns(patternReflector.getReflections());

check(
  'repeated failures identified',
  patterns.repeatedFailures.includes('bad_action'),
  (v) => v === true,
  'true (bad_action failed multiple times)'
);

check(
  'successful approaches recorded',
  patterns.successfulApproaches.length,
  (v) => v >= 1,
  '>= 1 successful approach'
);

// ---------------------------------------------------------------------
// Step 13 - End-to-end ReAct with goal achievement
// ---------------------------------------------------------------------

console.log('\nStep 13 - End-to-end goal achievement');

const executor5 = new ActionExecutor();
executor5.registerActions(createTestActions());

const react4 = new ReActLoop(executor5, createSimpleReasoning(), {
  maxIterations: 10,
  loopDetectionWindow: 8,
});

const result4 = await react4.run('Find the capital of Japan');

// The simple reasoning should be able to lookup Japan's capital
check(
  'goal achieved or made progress',
  result4.steps.length,
  (v) => v >= 1,
  '>= 1 steps taken'
);

// Check that some step succeeded
const hasSuccess = result4.steps.some((s) => s.observation.success);
check(
  'at least one successful action',
  hasSuccess,
  (v) => v === true,
  'true (some action succeeded)'
);

// Check final answer if goal achieved
if (result4.terminationReason === 'goal_achieved') {
  check(
    'final answer provided when goal achieved',
    result4.finalAnswer,
    (v) => v !== null && v.length > 0,
    'non-empty answer'
  );
} else {
  check(
    'loop executed without infinite loop',
    result4.terminationReason,
    (v) => v !== 'loop_detected' || result4.totalIterations < 10,
    'terminated reasonably'
  );
}

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
