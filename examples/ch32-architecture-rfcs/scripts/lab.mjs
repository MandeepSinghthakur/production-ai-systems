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

// Dynamic imports for TypeScript modules
const { RFCValidator, RFCBuilder } = await import(join(srcDir, 'rfc.ts'));
const { ADRRegistry, createADRFromRFC } = await import(join(srcDir, 'adr.ts'));
const { ReviewChecklistManager, hasAISpecificItems } = await import(join(srcDir, 'checklist.ts'));
const { TradeoffAnalyzer } = await import(join(srcDir, 'tradeoffs.ts'));
const { RFCWorkflow, RFCRepository } = await import(join(srcDir, 'workflow.ts'));

// Step 1: RFC structure validation
console.log('\nStep 1 - RFC has required sections');

const validator = new RFCValidator();

const completeRFC = new RFCBuilder('RFC-001', 'Replace LLM Gateway', 'alice')
  .withContext('Current gateway has 500ms p99 latency, need 200ms.')
  .withDecision('Build custom gateway with connection pooling.')
  .addConsequence('Reduced latency by 60%')
  .addConsequence('Increased maintenance burden')
  .addAlternative('Build custom', 'Build in-house solution')
  .addTradeoffToAlternative('Build custom', 'latency', 'Full control over optimization', 'Longer development time')
  .addTradeoffToAlternative('Build custom', 'cost', 'No licensing fees', 'Higher development cost')
  .addAlternative('Buy vendor', 'Use commercial solution')
  .addTradeoffToAlternative('Buy vendor', 'latency', 'Quick deployment', 'Less customization')
  .addTradeoffToAlternative('Buy vendor', 'cost', 'Predictable pricing', 'Monthly licensing fee')
  .addAIChecklistItem('latency', 'What is the p99 target?', '200ms')
  .addAIChecklistItem('cost', 'Monthly token budget?', '$50,000')
  .addAIChecklistItem('security', 'Prompt injection mitigation?', 'Input sanitization')
  .addAIChecklistItem('reliability', 'Fallback strategy?', 'Queue and retry')
  .addAIChecklistItem('scalability', 'Peak QPS?', '10,000')
  .build();

const validationResult = validator.validate(completeRFC);

check(
  validationResult.valid === true,
  'complete RFC passes validation',
  'true (valid)',
  validationResult.valid
);

check(
  validationResult.errors.length === 0,
  'no validation errors',
  '0 errors',
  `${validationResult.errors.length} errors`
);

check(
  validator.hasRequiredSections(completeRFC),
  'RFC has context, decision, consequences, alternatives',
  'true',
  validator.hasRequiredSections(completeRFC)
);

// Step 2: Trade-offs documented for each alternative
console.log('\nStep 2 - trade-offs documented for each alternative');

const analyzer = new TradeoffAnalyzer();
const tradeoffIssues = analyzer.validateTradeoffCompleteness(completeRFC);

check(
  tradeoffIssues.length === 0,
  'all alternatives have tradeoffs',
  '0 issues',
  `${tradeoffIssues.length} issues`
);

const incompleteRFC = new RFCBuilder('RFC-002', 'Missing Tradeoffs', 'bob')
  .withContext('Need to improve accuracy')
  .withDecision('Use larger model')
  .addConsequence('Better accuracy')
  .addAlternative('Option A', 'No tradeoffs documented')
  .build();

const incompleteIssues = analyzer.validateTradeoffCompleteness(incompleteRFC);

check(
  incompleteIssues.length > 0,
  'RFC without tradeoffs flagged',
  '> 0 issues',
  `${incompleteIssues.length} issues`
);

// Step 3: Decision links to related ADRs
console.log('\nStep 3 - decision links to related ADRs');

const adrRegistry = new ADRRegistry();

adrRegistry.create({
  id: 'ADR-001',
  title: 'Use TypeScript for all services',
  status: 'accepted',
  context: 'Need consistent language across team',
  decision: 'Adopt TypeScript',
  consequences: ['Type safety', 'Learning curve'],
  date: new Date(),
  relatedRFCs: []
});

const linkedRFC = new RFCBuilder('RFC-003', 'Gateway Rewrite', 'charlie')
  .withContext('Rewriting gateway')
  .withDecision('Use TypeScript per ADR-001')
  .addConsequence('Consistent with other services')
  .addAlternative('TypeScript', 'Follow ADR-001')
  .addTradeoffToAlternative('TypeScript', 'consistency', 'Team familiarity', 'None')
  .linkADR('ADR-001')
  .build();

adrRegistry.linkToRFC('ADR-001', 'RFC-003');

const linkedADRs = adrRegistry.findRelatedToRFC('RFC-003');

check(
  linkedRFC.relatedADRs.includes('ADR-001'),
  'RFC links to ADR',
  'true',
  linkedRFC.relatedADRs.includes('ADR-001')
);

check(
  linkedADRs.length === 1,
  'ADR links back to RFC',
  '1 ADR',
  `${linkedADRs.length} ADRs`
);

// Step 4: AI-specific checklist items present
console.log('\nStep 4 - AI-specific checklist items present');

const checklistManager = new ReviewChecklistManager();
const checklist = checklistManager.createChecklist('RFC-001');

check(
  hasAISpecificItems(checklist),
  'checklist has AI categories (latency, cost, security, reliability, scalability)',
  'true',
  hasAISpecificItems(checklist)
);

const status = checklistManager.getCompletionStatus(checklist);

check(
  status.requiredTotal >= 5,
  'checklist has required AI items',
  '>= 5 required items',
  `${status.requiredTotal} required items`
);

// Check specific categories exist
const latencyItems = checklistManager.getItemsByCategory(checklist, 'latency');
const costItems = checklistManager.getItemsByCategory(checklist, 'cost');
const securityItems = checklistManager.getItemsByCategory(checklist, 'security');

check(
  latencyItems.length > 0 && costItems.length > 0 && securityItems.length > 0,
  'has latency, cost, and security checklist items',
  'true',
  latencyItems.length > 0 && costItems.length > 0 && securityItems.length > 0
);

// Step 5: RFC status transitions valid
console.log('\nStep 5 - RFC status transitions valid');

const workflow = new RFCWorkflow();
const repo = new RFCRepository();

const draftRFC = new RFCBuilder('RFC-004', 'Test Workflow', 'diana')
  .withContext('Testing workflow')
  .withDecision('Test transitions')
  .addConsequence('Verified workflow')
  .addAlternative('Proceed', 'Move forward')
  .addTradeoffToAlternative('Proceed', 'time', 'Quick resolution', 'None')
  .addReviewer('eve', 'tech-lead')
  .build();

repo.save(draftRFC);

// Valid: draft -> review
check(
  workflow.canTransition('draft', 'review'),
  'draft -> review is valid',
  'true',
  workflow.canTransition('draft', 'review')
);

// Invalid: draft -> approved (must go through review)
check(
  workflow.canTransition('draft', 'approved') === false,
  'draft -> approved is invalid (must go through review)',
  'false',
  workflow.canTransition('draft', 'approved')
);

// Invalid: approved -> draft
check(
  workflow.canTransition('approved', 'draft') === false,
  'approved -> draft is invalid',
  'false',
  workflow.canTransition('approved', 'draft')
);

// Valid: review -> approved
check(
  workflow.canTransition('review', 'approved'),
  'review -> approved is valid',
  'true',
  workflow.canTransition('review', 'approved')
);

// Valid: review -> rejected
check(
  workflow.canTransition('review', 'rejected'),
  'review -> rejected is valid',
  'true',
  workflow.canTransition('review', 'rejected')
);

// Step 6: Workflow execution
console.log('\nStep 6 - workflow execution');

const submittedOk = workflow.submitForReview(draftRFC, 'diana');
check(
  submittedOk && draftRFC.status === 'review',
  'RFC submitted for review',
  'review status',
  draftRFC.status
);

// Add reviewer approval
draftRFC.reviewers[0].approved = true;

const approvedOk = workflow.approve(draftRFC, 'eve');
check(
  approvedOk && draftRFC.status === 'approved',
  'RFC approved after reviewer signs off',
  'approved status',
  draftRFC.status
);

// Step 7: Tradeoff analysis scoring
console.log('\nStep 7 - tradeoff analysis scoring');

const analysis = analyzer.analyzeRFC(completeRFC);

check(
  analysis.alternatives.length === 2,
  'both alternatives scored',
  '2 alternatives',
  `${analysis.alternatives.length} alternatives`
);

check(
  analysis.recommendation !== '',
  'recommendation generated',
  'non-empty',
  analysis.recommendation
);

check(
  analysis.rationale.length > 0,
  'rationale provided',
  '> 0 chars',
  `${analysis.rationale.length} chars`
);

// Step 8: ADR creation from approved RFC
console.log('\nStep 8 - ADR creation from approved RFC');

const newADR = createADRFromRFC(draftRFC, 'ADR-002');

check(
  newADR.context === draftRFC.context,
  'ADR inherits RFC context',
  'matching context',
  newADR.context === draftRFC.context ? 'matching' : 'mismatch'
);

check(
  newADR.relatedRFCs.includes(draftRFC.id),
  'ADR links to source RFC',
  `includes ${draftRFC.id}`,
  newADR.relatedRFCs.join(', ')
);

check(
  newADR.status === 'proposed',
  'ADR starts in proposed status',
  'proposed',
  newADR.status
);

// Step 9: Incomplete RFC validation
console.log('\nStep 9 - incomplete RFC validation');

const emptyRFC = new RFCBuilder('RFC-005', 'Empty RFC', 'frank').build();
const emptyValidation = validator.validate(emptyRFC);

check(
  emptyValidation.valid === false,
  'empty RFC fails validation',
  'false (invalid)',
  emptyValidation.valid
);

check(
  emptyValidation.errors.length >= 4,
  'multiple errors for missing sections',
  '>= 4 errors',
  `${emptyValidation.errors.length} errors`
);

// Step 10: Checklist completion tracking
console.log('\nStep 10 - checklist completion tracking');

const workingChecklist = checklistManager.createChecklist('RFC-006');

check(
  checklistManager.isComplete(workingChecklist) === false,
  'unchecked checklist is incomplete',
  'false',
  checklistManager.isComplete(workingChecklist)
);

// Check all required items
const requiredItems = workingChecklist.items.filter(i => i.required);
for (const item of requiredItems) {
  checklistManager.checkItem(workingChecklist, item.id, 'Verified');
}

check(
  checklistManager.isComplete(workingChecklist) === true,
  'all required items checked = complete',
  'true',
  checklistManager.isComplete(workingChecklist)
);

const finalStatus = checklistManager.getCompletionStatus(workingChecklist);
check(
  finalStatus.requiredChecked === finalStatus.requiredTotal,
  'all required items accounted for',
  `${finalStatus.requiredTotal}/${finalStatus.requiredTotal}`,
  `${finalStatus.requiredChecked}/${finalStatus.requiredTotal}`
);

// Summary
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
