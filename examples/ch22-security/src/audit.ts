// Audit trail logging for compliance and security monitoring.
// Records security-relevant events with enough detail for forensics
// while avoiding logging sensitive content directly.
//
// The key principle: log hashes of inputs/outputs, not plaintext.
// This enables correlation without creating a PII liability in logs.

import type { AuditEntry, AuditEventType, Severity } from './types.ts';

/**
 * Simple hash function for content fingerprinting.
 * Not cryptographically secure - use crypto.subtle in production.
 * This is synchronous for simplicity in the lab.
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return 'h_' + Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Generate a unique ID for audit entries.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `audit_${timestamp}_${random}`;
}

/**
 * AuditLogger records security events to an append-only log.
 *
 * In production this would write to:
 * - A tamper-evident log store (append-only, immutable)
 * - A SIEM system for alerting
 * - Long-term cold storage for compliance
 */
export class AuditLogger {
  private entries: AuditEntry[];
  private onEntry: ((entry: AuditEntry) => void) | null;

  constructor(onEntry?: (entry: AuditEntry) => void) {
    this.entries = [];
    this.onEntry = onEntry ?? null;
  }

  /**
   * Log a security event.
   */
  log(
    eventType: AuditEventType,
    requestId: string,
    tenantId: string,
    options: {
      userId?: string;
      severity?: Severity;
      details?: Record<string, unknown>;
      inputContent?: string;
      outputContent?: string;
      piiRedacted?: boolean;
      blocked?: boolean;
      durationMs?: number;
    } = {}
  ): AuditEntry {
    const entry: AuditEntry = {
      id: generateId(),
      timestamp: Date.now(),
      eventType,
      requestId,
      tenantId,
      userId: options.userId ?? null,
      severity: options.severity ?? this.defaultSeverity(eventType),
      details: options.details ?? {},
      inputHash: options.inputContent ? hashContent(options.inputContent) : null,
      outputHash: options.outputContent ? hashContent(options.outputContent) : null,
      piiRedacted: options.piiRedacted ?? false,
      blocked: options.blocked ?? false,
      durationMs: options.durationMs ?? null,
    };

    this.entries.push(entry);

    if (this.onEntry) {
      this.onEntry(entry);
    }

    return entry;
  }

  /**
   * Log request received.
   */
  logRequestReceived(
    requestId: string,
    tenantId: string,
    inputContent: string,
    userId?: string
  ): AuditEntry {
    return this.log('request_received', requestId, tenantId, {
      userId,
      inputContent,
      severity: 'info',
    });
  }

  /**
   * Log injection blocked.
   */
  logInjectionBlocked(
    requestId: string,
    tenantId: string,
    injectionType: string,
    confidence: number,
    inputFragment: string
  ): AuditEntry {
    return this.log('injection_blocked', requestId, tenantId, {
      severity: 'high',
      blocked: true,
      details: {
        injectionType,
        confidence,
        inputFragment, // Truncated fragment is safe to log
      },
    });
  }

  /**
   * Log PII redaction.
   */
  logPIIRedacted(
    requestId: string,
    tenantId: string,
    piiTypes: string[],
    count: number
  ): AuditEntry {
    return this.log('pii_redacted', requestId, tenantId, {
      severity: 'medium',
      piiRedacted: true,
      details: {
        piiTypes,
        matchCount: count,
      },
    });
  }

  /**
   * Log request dispatched to provider.
   */
  logRequestDispatched(
    requestId: string,
    tenantId: string,
    sanitizedInput: string
  ): AuditEntry {
    return this.log('request_dispatched', requestId, tenantId, {
      severity: 'info',
      inputContent: sanitizedInput,
    });
  }

  /**
   * Log response received from provider.
   */
  logResponseReceived(
    requestId: string,
    tenantId: string,
    outputContent: string,
    durationMs: number
  ): AuditEntry {
    return this.log('response_received', requestId, tenantId, {
      severity: 'info',
      outputContent,
      durationMs,
    });
  }

  /**
   * Log response filtered (content policy).
   */
  logResponseFiltered(
    requestId: string,
    tenantId: string,
    reason: string
  ): AuditEntry {
    return this.log('response_filtered', requestId, tenantId, {
      severity: 'medium',
      blocked: true,
      details: { reason },
    });
  }

  /**
   * Log error occurred.
   */
  logError(
    requestId: string,
    tenantId: string,
    errorType: string,
    errorMessage: string
  ): AuditEntry {
    return this.log('error_occurred', requestId, tenantId, {
      severity: 'high',
      details: {
        errorType,
        // Only log first 200 chars of error to avoid leaking sensitive data
        errorMessage: errorMessage.slice(0, 200),
      },
    });
  }

  /**
   * Get all entries (for testing).
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries by request ID.
   */
  getEntriesByRequest(requestId: string): AuditEntry[] {
    return this.entries.filter((e) => e.requestId === requestId);
  }

  /**
   * Get entries by tenant.
   */
  getEntriesByTenant(tenantId: string): AuditEntry[] {
    return this.entries.filter((e) => e.tenantId === tenantId);
  }

  /**
   * Get entries by severity (or higher).
   */
  getEntriesBySeverity(minSeverity: Severity): AuditEntry[] {
    const severityOrder: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIndex = severityOrder.indexOf(minSeverity);
    return this.entries.filter((e) => {
      const entryIndex = severityOrder.indexOf(e.severity);
      return entryIndex >= minIndex;
    });
  }

  /**
   * Get blocked request count.
   */
  getBlockedCount(): number {
    return this.entries.filter((e) => e.blocked).length;
  }

  /**
   * Get PII redaction count.
   */
  getPIIRedactionCount(): number {
    return this.entries.filter((e) => e.piiRedacted).length;
  }

  /**
   * Default severity based on event type.
   */
  private defaultSeverity(eventType: AuditEventType): Severity {
    switch (eventType) {
      case 'injection_blocked':
        return 'high';
      case 'pii_redacted':
        return 'medium';
      case 'response_filtered':
        return 'medium';
      case 'error_occurred':
        return 'high';
      default:
        return 'info';
    }
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Structured audit summary for dashboards.
 */
export interface AuditSummary {
  totalRequests: number;
  blockedRequests: number;
  piiRedactions: number;
  byEventType: Record<AuditEventType, number>;
  bySeverity: Record<Severity, number>;
  byTenant: Record<string, number>;
}

/**
 * Generate summary statistics from audit log.
 */
export function summarizeAudit(entries: AuditEntry[]): AuditSummary {
  const summary: AuditSummary = {
    totalRequests: 0,
    blockedRequests: 0,
    piiRedactions: 0,
    byEventType: {
      request_received: 0,
      injection_blocked: 0,
      pii_redacted: 0,
      request_dispatched: 0,
      response_received: 0,
      response_filtered: 0,
      error_occurred: 0,
    },
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    },
    byTenant: {},
  };

  const requestIds = new Set<string>();

  for (const entry of entries) {
    requestIds.add(entry.requestId);
    summary.byEventType[entry.eventType]++;
    summary.bySeverity[entry.severity]++;
    summary.byTenant[entry.tenantId] = (summary.byTenant[entry.tenantId] ?? 0) + 1;

    if (entry.blocked) {
      summary.blockedRequests++;
    }
    if (entry.piiRedacted) {
      summary.piiRedactions++;
    }
  }

  summary.totalRequests = requestIds.size;

  return summary;
}
