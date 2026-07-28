// Compliance checker for regulated AI systems.
// See Chapter 29, "Building Production AI Systems".

import type {
  ComplianceResult,
  ComplianceViolation,
  ComplianceMetrics,
  AuditEntry,
  DecisionContext,
  RiskLevel,
} from './types.ts';
import { AuditLogger, redactPII } from './audit.ts';
import { ApprovalManager } from './approval.ts';
import { RetentionManager } from './retention.ts';
import { AccessManager } from './access.ts';

/**
 * Generate a unique ID.
 */
function generateId(): string {
  return 'ses_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Determine risk level based on action type and content.
 */
function assessRisk(context: DecisionContext): RiskLevel {
  const { actionType, input, output } = context;

  // High-risk actions
  if (actionType === 'prescription' || actionType === 'diagnosis') {
    return 'high';
  }

  // Check for high-risk content indicators
  const highRiskPatterns = [
    /emergency/i,
    /critical/i,
    /urgent/i,
    /life-threatening/i,
    /controlled substance/i,
    /opioid/i,
  ];

  const content = `${input} ${output}`;
  for (const pattern of highRiskPatterns) {
    if (pattern.test(content)) {
      return 'high';
    }
  }

  // Medium-risk for recommendations
  if (actionType === 'recommendation' || actionType === 'referral') {
    return 'medium';
  }

  return 'low';
}

/**
 * Integrated compliance system for regulated AI.
 */
export class ComplianceSystem {
  private auditLogger: AuditLogger;
  private approvalManager: ApprovalManager;
  private retentionManager: RetentionManager;
  private accessManager: AccessManager;

  constructor(
    auditLogger?: AuditLogger,
    approvalManager?: ApprovalManager,
    retentionManager?: RetentionManager,
    accessManager?: AccessManager
  ) {
    this.auditLogger = auditLogger ?? new AuditLogger();
    this.approvalManager = approvalManager ?? new ApprovalManager();
    this.retentionManager = retentionManager ?? new RetentionManager();
    this.accessManager = accessManager ?? new AccessManager();
  }

  /**
   * Process an AI decision through the compliance pipeline.
   */
  processDecision(context: DecisionContext): {
    allowed: boolean;
    requiresApproval: boolean;
    approvalId: string | null;
    auditEntryId: string;
    reason: string;
  } {
    const riskLevel = assessRisk(context);

    // Step 1: Check access control
    const accessResult = this.accessManager.checkAccess(
      context.userId,
      context.userRole,
      context.actionType,
      riskLevel
    );

    if (!accessResult.allowed) {
      // Log the blocked action
      const inputRedaction = redactPII(context.input);
      const outputRedaction = redactPII(context.output);
      const retentionDays = this.retentionManager.getRetentionDays(
        context.actionType
      );

      const entry = this.auditLogger.log(
        context.sessionId,
        context.userId,
        context.userRole,
        context.actionType,
        riskLevel,
        context.input,
        context.output,
        'blocked',
        accessResult.reason,
        null,
        null,
        retentionDays
      );

      return {
        allowed: false,
        requiresApproval: false,
        approvalId: null,
        auditEntryId: entry.id,
        reason: accessResult.reason,
      };
    }

    // Step 2: Check if approval is required
    const needsApproval =
      accessResult.requiresApproval ||
      this.approvalManager.requiresApproval(context.actionType, riskLevel);

    const inputRedaction = redactPII(context.input);
    const outputRedaction = redactPII(context.output);
    const retentionDays = this.retentionManager.getRetentionDays(
      context.actionType
    );

    if (needsApproval) {
      // Create approval request
      const approvalRequest = this.approvalManager.createRequest(
        context.sessionId,
        context.userId,
        context.userRole,
        context.actionType,
        riskLevel,
        inputRedaction.redactedText,
        outputRedaction.redactedText
      );

      // Log pending action
      const entry = this.auditLogger.log(
        context.sessionId,
        context.userId,
        context.userRole,
        context.actionType,
        riskLevel,
        context.input,
        context.output,
        'pending',
        'Awaiting human approval',
        approvalRequest.id,
        'pending',
        retentionDays
      );

      return {
        allowed: false,
        requiresApproval: true,
        approvalId: approvalRequest.id,
        auditEntryId: entry.id,
        reason: 'Action requires human approval',
      };
    }

    // Step 3: Execute action and log
    const entry = this.auditLogger.log(
      context.sessionId,
      context.userId,
      context.userRole,
      context.actionType,
      riskLevel,
      context.input,
      context.output,
      'executed',
      'Action executed successfully',
      null,
      null,
      retentionDays
    );

    return {
      allowed: true,
      requiresApproval: false,
      approvalId: null,
      auditEntryId: entry.id,
      reason: 'Action executed',
    };
  }

  /**
   * Complete a pending action after approval.
   */
  completeApproval(
    approvalId: string,
    reviewerId: string,
    reviewerRole: 'clinician' | 'admin',
    approved: boolean,
    notes: string
  ): { success: boolean; error: string | null } {
    if (approved) {
      return this.approvalManager.approve(
        approvalId,
        reviewerId,
        reviewerRole,
        notes
      );
    } else {
      return this.approvalManager.reject(
        approvalId,
        reviewerId,
        reviewerRole,
        notes
      );
    }
  }

  /**
   * Run compliance checks on the audit trail.
   */
  checkCompliance(sessionId: string): ComplianceResult {
    const violations: ComplianceViolation[] = [];
    const warnings: string[] = [];

    // Get all entries for the session
    const entries = this.auditLogger.getEntriesBySession(sessionId);

    // Check 1: Audit trail completeness
    const completeness = this.auditLogger.verifyCompleteness(sessionId);
    if (!completeness.complete) {
      violations.push({
        code: 'AUDIT_INCOMPLETE',
        severity: 'critical',
        description: `Missing audit fields: ${completeness.missingFields.join(', ')}`,
        affectedEntryId: null,
      });
    }

    // Check 2: All high-risk actions have approval
    for (const entry of entries) {
      if (
        (entry.riskLevel === 'high' || entry.riskLevel === 'critical') &&
        entry.decision === 'executed' &&
        !entry.approvalId
      ) {
        // Check if action type requires approval
        if (
          this.approvalManager.requiresApproval(
            entry.actionType,
            entry.riskLevel
          )
        ) {
          violations.push({
            code: 'APPROVAL_BYPASS',
            severity: 'critical',
            description: `High-risk ${entry.actionType} executed without approval`,
            affectedEntryId: entry.id,
          });
        }
      }
    }

    // Check 3: Retention policy compliance
    for (const entry of entries) {
      const validation = this.retentionManager.validatePolicy(entry.actionType);
      if (!validation.valid) {
        warnings.push(
          `Retention policy for ${entry.actionType} (${validation.currentDays} days) ` +
            `is below minimum (${validation.minDays} days) required by ${validation.regulation}`
        );
      }
    }

    // Check 4: PII handling
    for (const entry of entries) {
      // Check that redaction occurred for entries with PII
      if (entry.piiFields.length > 0) {
        if (
          entry.redactedInput.includes('@') &&
          !entry.redactedInput.includes('[EMAIL:')
        ) {
          violations.push({
            code: 'PII_NOT_REDACTED',
            severity: 'error',
            description: 'Email address found in redacted input',
            affectedEntryId: entry.id,
          });
        }
      }
    }

    // Check 5: Access control consistency
    const deniedAccesses = this.accessManager.getDeniedAccesses();
    if (deniedAccesses.length > 0) {
      for (const denied of deniedAccesses) {
        // Check if a denied action was somehow executed
        const executedAfterDenied = entries.find(
          (e) =>
            e.userId === denied.userId &&
            e.actionType === denied.actionType &&
            e.decision === 'executed' &&
            e.timestamp > denied.timestamp
        );

        if (executedAfterDenied) {
          violations.push({
            code: 'ACCESS_CONTROL_BYPASS',
            severity: 'critical',
            description: `Action ${denied.actionType} executed after access denial`,
            affectedEntryId: executedAfterDenied.id,
          });
        }
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
      warnings,
    };
  }

  /**
   * Enforce retention policies by deleting expired entries.
   */
  enforceRetention(currentTime: number): {
    deletedCount: number;
    deletedIds: string[];
  } {
    const deletedIds = this.auditLogger.deleteExpired(currentTime);

    // Log each deletion
    for (const id of deletedIds) {
      this.retentionManager.logDeletion(
        id,
        'query', // We don't have the original action type after deletion
        'Retention policy enforcement'
      );
    }

    return {
      deletedCount: deletedIds.length,
      deletedIds,
    };
  }

  /**
   * Get compliance metrics.
   */
  getMetrics(): ComplianceMetrics {
    const entries = this.auditLogger.getAllEntries();
    const approvalStats = this.approvalManager.getStatistics();
    const deniedAccesses = this.accessManager.getDeniedAccesses();

    let piiRedactions = 0;
    for (const entry of entries) {
      if (entry.piiFields.length > 0) {
        piiRedactions++;
      }
    }

    return {
      totalDecisions: entries.length,
      pendingApprovals: approvalStats.pending,
      approvedActions: approvalStats.approved,
      rejectedActions: approvalStats.rejected,
      blockedByAccess: deniedAccesses.length,
      piiRedactions,
      expiredEntries: approvalStats.expired,
      complianceViolations: 0, // Would require running checkCompliance
    };
  }

  /**
   * Recover PII for compliance review.
   */
  recoverPIIForCompliance(
    entryId: string,
    requesterId: string,
    requesterRole: 'compliance' | 'admin'
  ): { success: boolean; input: string | null; output: string | null; error: string | null } {
    // Check if requester can access PII
    if (!this.accessManager.canRecoverPII(requesterRole)) {
      return {
        success: false,
        input: null,
        output: null,
        error: `Role ${requesterRole} cannot access PII recovery`,
      };
    }

    const recoveredInput = this.auditLogger.recoverOriginalContent(
      entryId,
      'input'
    );
    const recoveredOutput = this.auditLogger.recoverOriginalContent(
      entryId,
      'output'
    );

    if (!recoveredInput && !recoveredOutput) {
      return {
        success: false,
        input: null,
        output: null,
        error: 'No recovery data found for entry',
      };
    }

    return {
      success: true,
      input: recoveredInput,
      output: recoveredOutput,
      error: null,
    };
  }

  /**
   * Get access to underlying managers for testing.
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  getRetentionManager(): RetentionManager {
    return this.retentionManager;
  }

  getAccessManager(): AccessManager {
    return this.accessManager;
  }
}

/**
 * Create a compliance system with default configuration.
 */
export function createComplianceSystem(): ComplianceSystem {
  return new ComplianceSystem();
}
