#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

let passed = 0;
let failed = 0;

function check(condition, description, expected, observed) {
  if (condition) {
    console.log(`  [PASS] ${description}`);
    console.log(`         expected ${expected}, observed ${observed}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${description}`);
    console.log(`         expected ${expected}, observed ${observed}`);
    failed++;
  }
}

// Dynamic imports
const { IncidentClassifier } = await import(join(srcDir, 'classifier.ts'));
const { SeverityScorer } = await import(join(srcDir, 'severity.ts'));
const { RunbookRegistry, RunbookExecutor } = await import(join(srcDir, 'runbook.ts'));
const { TimelineManager, TimelineReconstructor } = await import(join(srcDir, 'timeline.ts'));
const { PostmortemGenerator, ActionItemTracker } = await import(join(srcDir, 'postmortem.ts'));

// Step 1: Incident classification
console.log('\nStep 1 - incident classified correctly');

const classifier = new IncidentClassifier();

const modelIncident = {
  title: 'Model accuracy degradation detected',
  description: 'Hallucination rate increased from 2% to 15% after deployment'
};

const modelResult = classifier.classify(modelIncident);
check(
  modelResult.type === 'model',
  'model degradation classified as model incident',
  'model',
  modelResult.type
);

const securityIncident = {
  title: 'Prompt injection attack detected',
  description: 'User attempting to jailbreak the assistant with malicious prompts'
};

const securityResult = classifier.classify(securityIncident);
check(
  securityResult.type === 'security',
  'prompt injection classified as security incident',
  'security',
  securityResult.type
);

const costIncident = {
  title: 'Budget exceeded - token spending spike',
  description: 'Runaway loop causing excessive API calls and cost overage'
};

const costResult = classifier.classify(costIncident);
check(
  costResult.type === 'cost',
  'budget exceeded classified as cost incident',
  'cost',
  costResult.type
);

const availabilityIncident = {
  title: 'LLM Gateway timeout storm',
  description: 'Provider outage causing 503 errors and service unavailable'
};

const availabilityResult = classifier.classify(availabilityIncident);
check(
  availabilityResult.type === 'availability',
  'timeout storm classified as availability incident',
  'availability',
  availabilityResult.type
);

// Step 2: Severity matches impact criteria
console.log('\nStep 2 - severity matches impact criteria');

const scorer = new SeverityScorer();

const criticalIncident = {
  impactedUsers: 50000,
  impactedServices: ['llm-gateway', 'payment-service'],
  type: 'security',
  detectedAt: new Date('2024-01-15T14:00:00Z')
};

const criticalScore = scorer.score(criticalIncident);
check(
  criticalScore.severity === 'sev1',
  'high impact incident scored as sev1',
  'sev1',
  criticalScore.severity
);

const minorIncident = {
  impactedUsers: 5,
  impactedServices: ['internal-tool'],
  type: 'data',
  detectedAt: new Date('2024-01-15T22:00:00Z')
};

const minorScore = scorer.score(minorIncident);
check(
  minorScore.severity === 'sev4',
  'low impact incident scored as sev4',
  'sev4',
  minorScore.severity
);

check(
  criticalScore.factors.length >= 4,
  'severity score includes multiple factors',
  '>= 4 factors',
  `${criticalScore.factors.length} factors`
);

// Step 3: Runbook steps execute in order
console.log('\nStep 3 - runbook steps execute in order');

const registry = new RunbookRegistry();
const executor = new RunbookExecutor();

const runbook = registry.get('runbook-model-degradation');
check(
  runbook !== undefined,
  'model degradation runbook exists',
  'defined',
  runbook ? 'defined' : 'undefined'
);

const execution = executor.startExecution(runbook, 'INC-001');

// Try to start step 2 before step 1 - should fail validation
const canSkipToStep2 = executor.validateStepOrder(runbook, execution, 2);
check(
  canSkipToStep2 === false,
  'cannot start step 2 before step 1',
  'false',
  canSkipToStep2
);

// Execute steps in order
executor.startStep(execution, 1);
executor.completeStep(execution, 1, 'Verified accuracy drop');

const canNowDoStep2 = executor.validateStepOrder(runbook, execution, 2);
check(
  canNowDoStep2 === true,
  'can start step 2 after completing step 1',
  'true',
  canNowDoStep2
);

executor.startStep(execution, 2);
executor.completeStep(execution, 2, 'Fallback enabled');
executor.startStep(execution, 3);
executor.completeStep(execution, 3, 'Root cause identified');

check(
  executor.isComplete(execution),
  'execution marked complete after all steps',
  'true',
  executor.isComplete(execution)
);

const progress = executor.getProgress(execution);
check(
  progress.percentage === 100,
  'progress shows 100% completion',
  '100%',
  `${progress.percentage}%`
);

// Step 4: Timeline captures all events
console.log('\nStep 4 - timeline captures all events');

const incident = {
  id: 'INC-002',
  type: 'availability',
  severity: 'sev2',
  status: 'detected',
  title: 'Service degradation',
  description: 'High latency observed',
  detectedAt: new Date(),
  impactedServices: ['llm-gateway'],
  impactedUsers: 1000,
  timeline: [],
  assignees: []
};

const timeline = new TimelineManager();

timeline.addEvent(incident, 'monitoring', 'detected', 'Alert triggered at p99 > 5s');
timeline.addEvent(incident, 'alice', 'acknowledged', 'On-call engineer responding');
timeline.addEvent(incident, 'alice', 'investigating', 'Checking recent deployments');
timeline.addEvent(incident, 'bob', 'mitigating', 'Rolling back to previous version');
timeline.addEvent(incident, 'bob', 'resolved', 'Service restored to normal');

const events = timeline.getEvents(incident);
check(
  events.length === 5,
  'all 5 timeline events captured',
  '5 events',
  `${events.length} events`
);

check(
  events[0].action === 'detected' && events[4].action === 'resolved',
  'events in chronological order',
  'detected...resolved',
  `${events[0].action}...${events[events.length - 1].action}`
);

// Verify timestamps present
const allHaveTimestamps = events.every(e => e.timestamp instanceof Date);
check(
  allHaveTimestamps,
  'all events have timestamps',
  'true',
  allHaveTimestamps
);

// Step 5: Post-incident report has required sections
console.log('\nStep 5 - post-incident report has required sections');

incident.resolvedAt = new Date();

const generator = new PostmortemGenerator();

const rootCause = {
  description: 'Memory leak in connection pool caused gradual degradation',
  category: 'technology',
  contributingFactors: ['Insufficient monitoring', 'Missing load tests']
};

const impact = {
  duration: 45,
  usersAffected: 1000,
  requestsDropped: 5000,
  revenueImpact: 25000,
  reputationImpact: 'medium'
};

const report = generator.generate(incident, rootCause, impact);

const validation = generator.validate(report);
check(
  validation.valid === true,
  'report passes validation',
  'true (valid)',
  validation.valid
);

check(
  validation.missing.length === 0,
  'no missing sections',
  '0 missing',
  `${validation.missing.length} missing`
);

check(
  generator.hasRequiredSections(report),
  'has summary, timeline, rootCause, impact, actionItems',
  'true',
  generator.hasRequiredSections(report)
);

check(
  report.actionItems.length >= 2,
  'report includes action items',
  '>= 2 items',
  `${report.actionItems.length} items`
);

check(
  report.lessonsLearned.length > 0,
  'report includes lessons learned',
  '> 0 lessons',
  `${report.lessonsLearned.length} lessons`
);

// Step 6: Runbook suggested by type
console.log('\nStep 6 - runbook suggested by incident type');

const securityRunbooks = registry.findByType('security');
check(
  securityRunbooks.length > 0,
  'security runbook exists for security incidents',
  '> 0 runbooks',
  `${securityRunbooks.length} runbooks`
);

check(
  securityResult.suggestedRunbook !== undefined,
  'classifier suggests runbook for incident',
  'defined',
  securityResult.suggestedRunbook || 'undefined'
);

// Step 7: Action item tracking
console.log('\nStep 7 - action item tracking');

const tracker = new ActionItemTracker();
tracker.addFromReport(report);

const openItems = tracker.getOpenItems();
check(
  openItems.length > 0,
  'action items tracked from report',
  '> 0 items',
  `${openItems.length} items`
);

tracker.updateStatus(report.actionItems[0].id, 'completed');
const afterComplete = tracker.getCompletionRate();
check(
  afterComplete > 0,
  'completion rate increases after marking item done',
  '> 0%',
  `${afterComplete}%`
);

// Step 8: Timeline reconstruction
console.log('\nStep 8 - timeline reconstruction');

const reconstructor = new TimelineReconstructor();
const reconstructed = reconstructor.reconstruct(incident.timeline);

check(
  reconstructed.phases.length > 0,
  'phases identified from timeline',
  '> 0 phases',
  `${reconstructed.phases.length} phases`
);

check(
  reconstructed.summary.length > 0,
  'summary generated from reconstruction',
  '> 0 chars',
  `${reconstructed.summary.length} chars`
);

// Summary
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
