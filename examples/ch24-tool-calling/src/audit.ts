// Audit trail logging for tool operations.
// Records every tool invocation with enough detail for forensics.
//
// The audit log answers: who did what, when, with what arguments,
// and what was the outcome. It is append-only and tamper-evident.

import type { AuditAction, AuditEntry, ToolCall } from './types.ts';

/**
 * Generate a unique audit entry ID.
 */
function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `aud_${timestamp}_${random}`;
}

/**
 * AuditLogger records all tool operations.
 *
 * In production, this writes to:
 * - An append-only database table
 * - A SIEM system for security monitoring
 * - A compliance archive for regulatory retention
 *
 * Key principle: log enough to reconstruct what happened, but not
 * so much that the log itself becomes a liability (e.g., PII).
 */
export class AuditLogger {
  private entries: AuditEntry[];
  private onEntry: ((entry: AuditEntry) => void) | null;

  constructor(onEntry?: (entry: AuditEntry) => void) {
    this.entries = [];
    this.onEntry = onEntry ?? null;
  }

  /**
   * Log a tool operation.
   */
  log(
    actor: string,
    action: AuditAction,
    result: AuditEntry['result'],
    options: {
      toolName?: string;
      toolCallId?: string;
      idempotencyKey?: string;
      details?: Record<string, unknown>;
      durationMs?: number;
    } = {}
  ): AuditEntry {
    const entry: AuditEntry = {
      id: generateAuditId(),
      timestamp: Date.now(),
      actor,
      action,
      toolName: options.toolName,
      toolCallId: options.toolCallId,
      idempotencyKey: options.idempotencyKey,
      details: options.details ?? {},
      result,
      durationMs: options.durationMs,
    };

    this.entries.push(entry);

    if (this.onEntry) {
      this.onEntry(entry);
    }

    return entry;
  }

  /**
   * Log a tool call received.
   */
  logToolCallReceived(
    actor: string,
    toolCall: ToolCall
  ): AuditEntry {
    return this.log(actor, 'tool_call_received', 'success', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      details: {
        argumentKeys: Object.keys(toolCall.arguments),
      },
    });
  }

  /**
   * Log a validation failure.
   */
  logValidationFailed(
    actor: string,
    toolCall: ToolCall,
    errors: Array<{ path: string; message: string }>
  ): AuditEntry {
    return this.log(actor, 'validation_failed', 'failure', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      details: { errors },
    });
  }

  /**
   * Log an injection attempt blocked.
   */
  logInjectionBlocked(
    actor: string,
    toolCall: ToolCall,
    reason: string,
    sanitizedPath: string
  ): AuditEntry {
    return this.log(actor, 'injection_blocked', 'blocked', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      details: {
        reason,
        path: sanitizedPath,
      },
    });
  }

  /**
   * Log a transfer initiated.
   */
  logTransferInitiated(
    actor: string,
    toolCallId: string,
    idempotencyKey: string,
    fromAccount: string,
    toAccount: string,
    amount: number,
    currency: string
  ): AuditEntry {
    return this.log(actor, 'transfer_initiated', 'success', {
      toolName: 'transfer_funds',
      toolCallId,
      idempotencyKey,
      details: {
        fromAccount,
        toAccount,
        amount,
        currency,
      },
    });
  }

  /**
   * Log a transfer completed.
   */
  logTransferCompleted(
    actor: string,
    toolCallId: string,
    idempotencyKey: string,
    transferId: string,
    durationMs: number
  ): AuditEntry {
    return this.log(actor, 'transfer_completed', 'success', {
      toolName: 'transfer_funds',
      toolCallId,
      idempotencyKey,
      details: { transferId },
      durationMs,
    });
  }

  /**
   * Log a transfer rejected.
   */
  logTransferRejected(
    actor: string,
    toolCallId: string,
    idempotencyKey: string,
    reason: string
  ): AuditEntry {
    return this.log(actor, 'transfer_rejected', 'failure', {
      toolName: 'transfer_funds',
      toolCallId,
      idempotencyKey,
      details: { reason },
    });
  }

  /**
   * Log an approval requested.
   */
  logApprovalRequested(
    actor: string,
    toolCallId: string,
    approvalId: string,
    amount: number,
    currency: string
  ): AuditEntry {
    return this.log(actor, 'approval_requested', 'pending', {
      toolName: 'transfer_funds',
      toolCallId,
      details: {
        approvalId,
        amount,
        currency,
      },
    });
  }

  /**
   * Log an approval granted.
   */
  logApprovalGranted(
    decidedBy: string,
    approvalId: string,
    idempotencyKey: string
  ): AuditEntry {
    return this.log(decidedBy, 'approval_granted', 'success', {
      toolName: 'transfer_funds',
      idempotencyKey,
      details: { approvalId },
    });
  }

  /**
   * Log an approval denied.
   */
  logApprovalDenied(
    decidedBy: string,
    approvalId: string,
    idempotencyKey: string,
    reason: string
  ): AuditEntry {
    return this.log(decidedBy, 'approval_denied', 'failure', {
      toolName: 'transfer_funds',
      idempotencyKey,
      details: { approvalId, reason },
    });
  }

  /**
   * Log an idempotency cache hit.
   */
  logIdempotencyHit(
    actor: string,
    toolCallId: string,
    idempotencyKey: string
  ): AuditEntry {
    return this.log(actor, 'idempotency_hit', 'success', {
      toolName: 'transfer_funds',
      toolCallId,
      idempotencyKey,
      details: { cached: true },
    });
  }

  /**
   * Get all entries.
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by actor.
   */
  getEntriesByActor(actor: string): AuditEntry[] {
    return this.entries.filter((e) => e.actor === actor);
  }

  /**
   * Get entries by tool call ID.
   */
  getEntriesByToolCallId(toolCallId: string): AuditEntry[] {
    return this.entries.filter((e) => e.toolCallId === toolCallId);
  }

  /**
   * Get entries by idempotency key.
   */
  getEntriesByIdempotencyKey(key: string): AuditEntry[] {
    return this.entries.filter((e) => e.idempotencyKey === key);
  }

  /**
   * Get entries by action.
   */
  getEntriesByAction(action: AuditAction): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /**
   * Get blocked entries.
   */
  getBlockedEntries(): AuditEntry[] {
    return this.entries.filter((e) => e.result === 'blocked');
  }

  /**
   * Get failed entries.
   */
  getFailedEntries(): AuditEntry[] {
    return this.entries.filter((e) => e.result === 'failure');
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries = [];
  }
}
