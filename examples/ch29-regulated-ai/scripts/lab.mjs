// Reproduces every numbered step of the Chapter 29 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch29-regulated-ai)
//   node examples/ch29-regulated-ai/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { AuditLogger, redactPII, recoverPII } = await import(
  resolve(srcDir, 'audit.ts')
);
const { ApprovalManager } = await import(resolve(srcDir, 'approval.ts'));
const { RetentionManager } = await import(resolve(srcDir, 'retention.ts'));
const { AccessManager } = await import(resolve(srcDir, 'access.ts'));
const { ComplianceSystem, createComplianceSystem } = await import(
  resolve(srcDir, 'compliance.ts')
);

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  if (typeof actual === 'object') {
    console.log(`         expected ${expectation}, observed ${JSON.stringify(actual).substring(0, 80)}`);
  } else {
    console.log(`         expected ${expectation}, observed ${actual}`);
  }
}

// ---------------------------------------------------------------------
// Step 1 - Audit trail completeness
// ---------------------------------------------------------------------

console.log('\nStep 1 - audit trail completeness');

const auditLogger1 = new AuditLogger();

// Log several AI decisions
const entry1 = auditLogger1.log(
  'session-1',
  'user-123',
  'clinician',
  'query',
  'low',
  'Patient: John Smith, MRN-123456. What medications are they on?',
  'Patient is currently on Lisinopril 10mg daily.',
  'executed',
  'Query completed',
  null,
  null,
  30
);

const entry2 = auditLogger1.log(
  'session-1',
  'user-123',
  'clinician',
  'recommendation',
  'medium',
  'Should we increase the dosage?',
  'Based on blood pressure readings, consider increasing to 20mg.',
  'executed',
  'Recommendation generated',
  null,
  null,
  365
);

check(
  'audit entry has required id',
  entry1.id,
  (v) => v && v.length > 0,
  'non-empty string'
);

check(
  'audit entry has timestamp',
  entry1.timestamp,
  (v) => v > 0,
  'positive timestamp'
);

check(
  'audit entry has session id',
  entry1.sessionId,
  (v) => v === 'session-1',
  'session-1'
);

check(
  'audit entry has user id',
  entry1.userId,
  (v) => v === 'user-123',
  'user-123'
);

check(
  'audit entry has input hash',
  entry1.inputHash,
  (v) => v && v.startsWith('h_'),
  'hash starting with h_'
);

check(
  'audit entry has output hash',
  entry1.outputHash,
  (v) => v && v.startsWith('h_'),
  'hash starting with h_'
);

// Verify completeness check
const completeness = auditLogger1.verifyCompleteness('session-1');
check(
  'audit trail is complete',
  completeness.complete,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 2 - PII redaction in logs
// ---------------------------------------------------------------------

console.log('\nStep 2 - PII redaction in logs');

check(
  'MRN is redacted in audit entry',
  entry1.redactedInput.includes('[MRN:'),
  (v) => v === true,
  'true (MRN redacted)'
);

check(
  'patient name is redacted',
  entry1.redactedInput.includes('[NAME:'),
  (v) => v === true,
  'true (name redacted)'
);

check(
  'original MRN not in redacted input',
  entry1.redactedInput.includes('MRN-123456'),
  (v) => v === false,
  'false (original MRN removed)'
);

// Test direct redaction function
const testInput = 'Email: john@example.com, SSN: 123-45-6789, Phone: 555-123-4567';
const redactionResult = redactPII(testInput);

check(
  'email is redacted',
  redactionResult.redactedText.includes('[EMAIL:'),
  (v) => v === true,
  'true'
);

check(
  'SSN is redacted',
  redactionResult.redactedText.includes('[SSN:'),
  (v) => v === true,
  'true'
);

check(
  'phone is redacted',
  redactionResult.redactedText.includes('[PHONE:'),
  (v) => v === true,
  'true'
);

check(
  'recovery token is generated',
  redactionResult.recoveryToken.length > 0,
  (v) => v === true,
  'true (non-empty token)'
);

// ---------------------------------------------------------------------
// Step 3 - PII recovery for compliance
// ---------------------------------------------------------------------

console.log('\nStep 3 - PII recovery for compliance');

// Recover original content
const recoveredContent = auditLogger1.recoverOriginalContent(entry1.id, 'input');

check(
  'original content can be recovered',
  recoveredContent !== null,
  (v) => v === true,
  'true'
);

check(
  'recovered content contains original MRN',
  recoveredContent && recoveredContent.includes('MRN'),
  (v) => v === true,
  'true (MRN recovered)'
);

// ---------------------------------------------------------------------
// Step 4 - Human-in-the-loop approval workflow
// ---------------------------------------------------------------------

console.log('\nStep 4 - human-in-the-loop approval');

const approvalManager = new ApprovalManager();

// High-risk actions require approval
check(
  'prescription requires approval',
  approvalManager.requiresApproval('prescription', 'medium'),
  (v) => v === true,
  'true'
);

check(
  'diagnosis requires approval',
  approvalManager.requiresApproval('diagnosis', 'low'),
  (v) => v === true,
  'true'
);

check(
  'high-risk query requires approval',
  approvalManager.requiresApproval('query', 'high'),
  (v) => v === true,
  'true'
);

check(
  'low-risk query does not require approval',
  approvalManager.requiresApproval('query', 'low'),
  (v) => v === false,
  'false'
);

// Create approval request
const approvalRequest = approvalManager.createRequest(
  'session-2',
  'user-456',
  'clinician',
  'prescription',
  'high',
  'Prescribe medication X',
  'Recommended: Medication X 50mg'
);

check(
  'approval request created with pending status',
  approvalRequest.status,
  (v) => v === 'pending',
  'pending'
);

// Approve the request
const approvalResult = approvalManager.approve(
  approvalRequest.id,
  'reviewer-789',
  'clinician',
  'Approved after review'
);

check(
  'approval succeeds',
  approvalResult.success,
  (v) => v === true,
  'true'
);

check(
  'request status is approved',
  approvalManager.getRequest(approvalRequest.id).status,
  (v) => v === 'approved',
  'approved'
);

// ---------------------------------------------------------------------
// Step 5 - Data retention policy enforcement
// ---------------------------------------------------------------------

console.log('\nStep 5 - data retention policy');

const retentionManager = new RetentionManager();

check(
  'query has 30-day retention',
  retentionManager.getRetentionDays('query'),
  (v) => v === 30,
  '30'
);

check(
  'prescription has 7-year retention',
  retentionManager.getRetentionDays('prescription'),
  (v) => v === 2555,
  '2555 (~7 years)'
);

// Test retention enforcement
const auditLogger2 = new AuditLogger();
const oldEntry = auditLogger2.log(
  'session-old',
  'user-old',
  'clinician',
  'query',
  'low',
  'old query',
  'old response',
  'executed',
  'completed',
  null,
  null,
  30 // 30 days retention
);

// Simulate time passage (31 days)
const futureTime = Date.now() + 31 * 24 * 60 * 60 * 1000;

check(
  'entry is expired after retention period',
  auditLogger2.isExpired(oldEntry.id, futureTime),
  (v) => v === true,
  'true'
);

const deleted = auditLogger2.deleteExpired(futureTime);

check(
  'expired entry is deleted',
  deleted.length,
  (v) => v === 1,
  '1 entry deleted'
);

check(
  'entry no longer exists after deletion',
  auditLogger2.getEntry(oldEntry.id),
  (v) => v === null,
  'null'
);

// ---------------------------------------------------------------------
// Step 6 - Role-based access control
// ---------------------------------------------------------------------

console.log('\nStep 6 - role-based access control');

const accessManager = new AccessManager();

// Patient cannot perform prescriptions
const patientPrescription = accessManager.checkAccess(
  'patient-1',
  'patient',
  'prescription',
  'low'
);

check(
  'patient cannot prescribe',
  patientPrescription.allowed,
  (v) => v === false,
  'false'
);

// Clinician can prescribe with approval
const clinicianPrescription = accessManager.checkAccess(
  'clinician-1',
  'clinician',
  'prescription',
  'high'
);

check(
  'clinician can prescribe',
  clinicianPrescription.allowed,
  (v) => v === true,
  'true'
);

check(
  'clinician prescription requires approval',
  clinicianPrescription.requiresApproval,
  (v) => v === true,
  'true'
);

// Check risk level limits
const patientHighRisk = accessManager.checkAccess(
  'patient-1',
  'patient',
  'query',
  'high'
);

check(
  'patient denied high-risk query',
  patientHighRisk.allowed,
  (v) => v === false,
  'false (exceeds risk limit)'
);

// Compliance role checks
check(
  'compliance can recover PII',
  accessManager.canRecoverPII('compliance'),
  (v) => v === true,
  'true'
);

check(
  'clinician cannot recover PII',
  accessManager.canRecoverPII('clinician'),
  (v) => v === false,
  'false'
);

// ---------------------------------------------------------------------
// Step 7 - Integrated compliance system
// ---------------------------------------------------------------------

console.log('\nStep 7 - integrated compliance system');

const complianceSystem = createComplianceSystem();

// Process a low-risk query (should be allowed)
const queryResult = complianceSystem.processDecision({
  sessionId: 'session-3',
  userId: 'clinician-1',
  userRole: 'clinician',
  actionType: 'query',
  input: 'What is the patient status?',
  output: 'Patient is stable.',
  timestamp: Date.now(),
});

check(
  'low-risk query is allowed',
  queryResult.allowed,
  (v) => v === true,
  'true'
);

check(
  'low-risk query has audit entry',
  queryResult.auditEntryId.length > 0,
  (v) => v === true,
  'true'
);

// Process a high-risk prescription (should require approval)
const prescriptionResult = complianceSystem.processDecision({
  sessionId: 'session-3',
  userId: 'clinician-1',
  userRole: 'clinician',
  actionType: 'prescription',
  input: 'Prescribe controlled substance for pain',
  output: 'Recommending oxycodone 10mg',
  timestamp: Date.now(),
});

check(
  'prescription requires approval',
  prescriptionResult.requiresApproval,
  (v) => v === true,
  'true'
);

check(
  'prescription has approval id',
  prescriptionResult.approvalId !== null,
  (v) => v === true,
  'true'
);

// Patient trying prescription (should be blocked)
const patientPrescriptionResult = complianceSystem.processDecision({
  sessionId: 'session-4',
  userId: 'patient-1',
  userRole: 'patient',
  actionType: 'prescription',
  input: 'I want to prescribe myself medication',
  output: 'N/A',
  timestamp: Date.now(),
});

check(
  'patient prescription is blocked',
  patientPrescriptionResult.allowed,
  (v) => v === false,
  'false'
);

// Run compliance check
const complianceResult = complianceSystem.checkCompliance('session-3');

check(
  'compliance check runs',
  complianceResult !== null,
  (v) => v === true,
  'true'
);

// Get metrics
const metrics = complianceSystem.getMetrics();

check(
  'metrics track total decisions',
  metrics.totalDecisions >= 2,
  (v) => v === true,
  '>= 2 decisions'
);

check(
  'metrics track pending approvals',
  metrics.pendingApprovals >= 1,
  (v) => v === true,
  '>= 1 pending'
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
