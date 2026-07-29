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
const { RoadmapPlanner } = await import(join(srcDir, 'roadmap.ts'));
const { BuildBuyAnalyzer } = await import(join(srcDir, 'build-buy.ts'));
const { TechDebtTracker, TechDebtScorer } = await import(join(srcDir, 'tech-debt.ts'));
const { StrategyBuilder, StrategyValidator } = await import(join(srcDir, 'strategy.ts'));
const { InitiativePrioritizer } = await import(join(srcDir, 'prioritization.ts'));

// Step 1: Roadmap dependencies validated
console.log('\nStep 1 - roadmap dependencies validated');

const planner = new RoadmapPlanner();
const roadmap = planner.create('rm-2024', 'AI Platform Roadmap', '2024');

planner.addInitiative('rm-2024', {
  id: 'init-1',
  name: 'Build LLM Gateway',
  description: 'Core gateway infrastructure',
  quarter: 'Q1',
  status: 'completed',
  dependencies: [],
  owner: 'platform-team',
  priority: 1,
  effort: 'large',
  impact: 'critical'
});

planner.addInitiative('rm-2024', {
  id: 'init-2',
  name: 'Add Multi-Provider Routing',
  description: 'Route to multiple LLM providers',
  quarter: 'Q2',
  status: 'in_progress',
  dependencies: ['init-1'],
  owner: 'platform-team',
  priority: 2,
  effort: 'medium',
  impact: 'high'
});

planner.addInitiative('rm-2024', {
  id: 'init-3',
  name: 'Implement Cost Controls',
  description: 'Budget enforcement and alerts',
  quarter: 'Q2',
  status: 'planned',
  dependencies: ['init-2'],
  owner: 'platform-team',
  priority: 3,
  effort: 'small',
  impact: 'medium'
});

const validation = planner.validateDependencies(roadmap);
check(
  validation.valid === true,
  'valid roadmap passes dependency check',
  'true (valid)',
  validation.valid
);

check(
  validation.hasCycles === false,
  'no circular dependencies detected',
  'false',
  validation.hasCycles
);

// Add circular dependency
planner.addInitiative('rm-2024', {
  id: 'init-cycle-a',
  name: 'Cycle A',
  description: 'Creates a cycle',
  quarter: 'Q3',
  status: 'planned',
  dependencies: ['init-cycle-b'],
  owner: 'team',
  priority: 4,
  effort: 'small',
  impact: 'low'
});

planner.addInitiative('rm-2024', {
  id: 'init-cycle-b',
  name: 'Cycle B',
  description: 'Creates a cycle',
  quarter: 'Q3',
  status: 'planned',
  dependencies: ['init-cycle-a'],
  owner: 'team',
  priority: 4,
  effort: 'small',
  impact: 'low'
});

const cycleValidation = planner.validateDependencies(roadmap);
check(
  cycleValidation.hasCycles === true,
  'circular dependency detected',
  'true',
  cycleValidation.hasCycles
);

check(
  cycleValidation.errors.length > 0,
  'cycle reported as error',
  '> 0 errors',
  `${cycleValidation.errors.length} errors`
);

// Step 2: Build vs buy analysis has cost/benefit
console.log('\nStep 2 - build vs buy analysis has cost/benefit');

const analyzer = new BuildBuyAnalyzer();

const analysis = analyzer.analyze(
  'LLM Gateway',
  'Gateway for routing LLM requests',
  {
    upfrontCost: 150000,
    ongoingCost: 5000,
    timeToDeliver: 16,
    teamSize: 4,
    risks: ['Team bandwidth', 'Maintenance burden'],
    benefits: ['Full control', 'Custom features', 'No vendor lock-in']
  },
  {
    vendorName: 'VendorX Gateway',
    upfrontCost: 50000,
    ongoingCost: 15000,
    timeToDeliver: 4,
    integrationEffort: 'medium',
    risks: ['Vendor dependency', 'Feature limitations'],
    benefits: ['Fast deployment', 'Managed service', 'Support included']
  }
);

check(
  analysis.buildOption.benefits.length > 0,
  'build option has benefits',
  '> 0 benefits',
  `${analysis.buildOption.benefits.length} benefits`
);

check(
  analysis.buyOption.benefits.length > 0,
  'buy option has benefits',
  '> 0 benefits',
  `${analysis.buyOption.benefits.length} benefits`
);

check(
  analysis.buildOption.risks.length > 0 && analysis.buyOption.risks.length > 0,
  'both options have risks documented',
  'true',
  analysis.buildOption.risks.length > 0 && analysis.buyOption.risks.length > 0
);

const analysisValidation = analyzer.validateAnalysis(analysis);
check(
  analysisValidation.valid === true,
  'analysis passes validation',
  'true (valid)',
  analysisValidation.valid
);

check(
  analysis.recommendation === 'build' || analysis.recommendation === 'buy',
  'recommendation is build or buy',
  'build or buy',
  analysis.recommendation
);

check(
  analysis.rationale.length > 0,
  'rationale provided',
  '> 0 chars',
  `${analysis.rationale.length} chars`
);

// Step 3: Tech debt scored by impact and effort
console.log('\nStep 3 - tech debt scored by impact and effort');

const tracker = new TechDebtTracker();
const scorer = new TechDebtScorer();

tracker.add({
  id: 'debt-1',
  title: 'Refactor legacy prompt builder',
  description: 'Old code is hard to maintain',
  category: 'code',
  impact: 4,
  effort: 2,
  interestRate: 1.3,
  createdAt: new Date(),
  linkedIncidents: ['INC-001', 'INC-002']
});

tracker.add({
  id: 'debt-2',
  title: 'Add integration tests',
  description: 'Missing test coverage',
  category: 'testing',
  impact: 3,
  effort: 4,
  interestRate: 1.1,
  createdAt: new Date(),
  linkedIncidents: []
});

tracker.add({
  id: 'debt-3',
  title: 'Update documentation',
  description: 'Docs are outdated',
  category: 'documentation',
  impact: 2,
  effort: 1,
  interestRate: 1.0,
  createdAt: new Date(),
  linkedIncidents: []
});

const scores = scorer.scoreAll(tracker.list());

check(
  scores.length === 3,
  'all debt items scored',
  '3 items',
  `${scores.length} items`
);

// Higher impact/lower effort should rank higher
const topItem = scores[0];
check(
  topItem.item.id === 'debt-1',
  'highest ROI item ranked first',
  'debt-1 (high impact, low effort)',
  topItem.item.id
);

check(
  scorer.validateScoring(scores) === true,
  'scores are sorted by priority',
  'true',
  scorer.validateScoring(scores)
);

// Step 4: Strategy document has required sections
console.log('\nStep 4 - strategy document has required sections');

const builder = new StrategyBuilder('AI Platform Strategy 2024', 'alice');
const validator = new StrategyValidator();

const strategy = builder
  .setVision('Build a world-class AI platform that enables rapid feature development while maintaining reliability and cost efficiency.')
  .addGoal({
    id: 'goal-1',
    description: 'Reduce model inference latency by 50%',
    timeframe: 'Q2 2024',
    measurable: true,
    keyResults: ['P99 latency < 500ms', 'Cache hit rate > 80%']
  })
  .addGoal({
    id: 'goal-2',
    description: 'Achieve 99.9% availability',
    timeframe: 'Q4 2024',
    measurable: true,
    keyResults: ['< 4 hours downtime per year', 'All critical paths have fallbacks']
  })
  .addMilestone({
    id: 'ms-1',
    name: 'Gateway v2 Launch',
    targetQuarter: 'Q2',
    deliverables: ['Connection pooling', 'Request caching'],
    dependencies: []
  })
  .addMilestone({
    id: 'ms-2',
    name: 'Multi-provider rollout',
    targetQuarter: 'Q3',
    deliverables: ['Provider routing', 'Failover logic'],
    dependencies: ['ms-1']
  })
  .addRisk({
    id: 'risk-1',
    description: 'Provider rate limits may block scaling',
    probability: 'medium',
    impact: 'high',
    mitigation: 'Pre-negotiate rate limit increases; implement request queueing'
  })
  .addMetric({
    name: 'P99 Latency',
    currentValue: 950,
    targetValue: 500,
    unit: 'ms',
    trackingFrequency: 'daily'
  })
  .build();

const strategyValidation = validator.validate(strategy);

check(
  strategyValidation.valid === true,
  'strategy passes validation',
  'true (valid)',
  strategyValidation.valid
);

check(
  validator.hasRequiredSections(strategy),
  'has vision, goals, milestones, risks',
  'true',
  validator.hasRequiredSections(strategy)
);

check(
  strategyValidation.errors.length === 0,
  'no validation errors',
  '0 errors',
  `${strategyValidation.errors.length} errors`
);

check(
  strategyValidation.completeness >= 80,
  'strategy completeness > 80%',
  '>= 80%',
  `${strategyValidation.completeness}%`
);

// Step 5: Initiative prioritization consistent with scoring
console.log('\nStep 5 - initiative prioritization consistent with scoring');

const prioritizer = new InitiativePrioritizer();
const initiatives = roadmap.initiatives.filter(i => !i.id.includes('cycle'));

const result = prioritizer.prioritize(initiatives);

check(
  result.initiatives.length === 3,
  'all initiatives scored',
  '3 initiatives',
  `${result.initiatives.length} initiatives`
);

check(
  result.topPriorities.length > 0,
  'top priorities identified',
  '> 0 priorities',
  `${result.topPriorities.length} priorities`
);

check(
  prioritizer.validatePrioritization(result) === true,
  'prioritization is consistent with scoring',
  'true',
  prioritizer.validatePrioritization(result)
);

// Verify factors are present
const firstScored = result.initiatives[0];
check(
  firstScored.factors.length >= 4,
  'scoring includes multiple factors',
  '>= 4 factors',
  `${firstScored.factors.length} factors`
);

// Step 6: Incomplete strategy validation
console.log('\nStep 6 - incomplete strategy validation');

const incompleteStrategy = new StrategyBuilder('Empty Strategy', 'bob').build();
const incompleteValidation = validator.validate(incompleteStrategy);

check(
  incompleteValidation.valid === false,
  'incomplete strategy fails validation',
  'false (invalid)',
  incompleteValidation.valid
);

check(
  incompleteValidation.errors.length >= 3,
  'multiple errors for missing sections',
  '>= 3 errors',
  `${incompleteValidation.errors.length} errors`
);

// Step 7: Build vs buy comparison table
console.log('\nStep 7 - build vs buy comparison table');

const comparison = analyzer.compareOptions(analysis);

check(
  comparison.dimensions.length >= 4,
  'comparison covers multiple dimensions',
  '>= 4 dimensions',
  `${comparison.dimensions.length} dimensions`
);

const hasWinners = comparison.dimensions.every(d => d.winner === 'build' || d.winner === 'buy');
check(
  hasWinners,
  'each dimension has a winner',
  'true',
  hasWinners
);

// Summary
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
