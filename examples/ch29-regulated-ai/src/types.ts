// Core types for regulated AI systems.
// See Chapter 29, "Building Production AI Systems".

/**
 * Risk level for AI decisions.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Approval status for high-risk actions.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * User role in the system.
 */
export type UserRole = 'patient' | 'clinician' | 'admin' | 'compliance';

/**
 * Action type the AI can perform.
 */
export type ActionType =
  | 'query'
  | 'recommendation'
  | 'prescription'
  | 'diagnosis'
  | 'referral';

/**
 * Audit entry for compliance logging.
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  userRole: UserRole;
  actionType: ActionType;
  riskLevel: RiskLevel;
  inputHash: string;
  outputHash: string;
  redactedInput: string;
  redactedOutput: string;
  piiFields: string[];
  approvalId: string | null;
  approvalStatus: ApprovalStatus | null;
  decision: 'executed' | 'pending' | 'denied' | 'blocked';
  reason: string;
  expiresAt: number;
}

/**
 * Approval request for human-in-the-loop.
 */
export interface ApprovalRequest {
  id: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  userRole: UserRole;
  actionType: ActionType;
  riskLevel: RiskLevel;
  redactedInput: string;
  redactedOutput: string;
  status: ApprovalStatus;
  reviewerId: string | null;
  reviewedAt: number | null;
  reviewNotes: string | null;
  expiresAt: number;
}

/**
 * PII field detection result.
 */
export interface PIIMatch {
  type: string;
  originalValue: string;
  redactedValue: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Redaction result with recovery capability.
 */
export interface RedactionResult {
  redactedText: string;
  piiFields: PIIMatch[];
  recoveryToken: string;
}

/**
 * Data retention policy configuration.
 */
export interface RetentionPolicy {
  actionType: ActionType;
  retentionDays: number;
  requiresExplicitDeletion: boolean;
}

/**
 * Access control entry.
 */
export interface AccessRule {
  role: UserRole;
  actionType: ActionType;
  allowed: boolean;
  requiresApproval: boolean;
  maxRiskLevel: RiskLevel;
}

/**
 * Compliance check result.
 */
export interface ComplianceResult {
  compliant: boolean;
  violations: ComplianceViolation[];
  warnings: string[];
}

/**
 * Compliance violation detail.
 */
export interface ComplianceViolation {
  code: string;
  severity: 'warning' | 'error' | 'critical';
  description: string;
  affectedEntryId: string | null;
}

/**
 * AI decision context.
 */
export interface DecisionContext {
  sessionId: string;
  userId: string;
  userRole: UserRole;
  actionType: ActionType;
  input: string;
  output: string;
  timestamp: number;
}

/**
 * Metrics for compliance monitoring.
 */
export interface ComplianceMetrics {
  totalDecisions: number;
  pendingApprovals: number;
  approvedActions: number;
  rejectedActions: number;
  blockedByAccess: number;
  piiRedactions: number;
  expiredEntries: number;
  complianceViolations: number;
}
