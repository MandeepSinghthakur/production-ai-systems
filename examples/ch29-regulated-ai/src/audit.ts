// Compliance audit logging with PII protection.
// See Chapter 29, "Building Production AI Systems".

import type {
  AuditEntry,
  ActionType,
  RiskLevel,
  UserRole,
  ApprovalStatus,
  PIIMatch,
  RedactionResult,
} from './types.ts';

/**
 * Generate a unique ID.
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Hash content for audit logging without storing plaintext.
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'h_' + Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * PII patterns for redaction.
 */
const PII_PATTERNS: Array<{
  type: string;
  pattern: RegExp;
  redactor: (match: string) => string;
}> = [
  {
    type: 'ssn',
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    redactor: (m) => `[SSN:***-**-${m.replace(/\D/g, '').slice(-4)}]`,
  },
  {
    type: 'mrn',
    pattern: /\bMRN[-:\s]?\d{6,10}\b/gi,
    redactor: (m) => `[MRN:****${m.replace(/\D/g, '').slice(-4)}]`,
  },
  {
    type: 'dob',
    pattern: /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g,
    redactor: () => '[DOB:redacted]',
  },
  {
    type: 'phone',
    pattern: /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    redactor: (m) => `[PHONE:***-***-${m.replace(/\D/g, '').slice(-4)}]`,
  },
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    redactor: (m) => {
      const [local, domain] = m.split('@');
      return `[EMAIL:${local[0]}***@${domain}]`;
    },
  },
  {
    type: 'name',
    pattern: /\bPatient:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g,
    redactor: (m) => {
      const name = m.replace('Patient:', '').trim();
      const initials = name.split(' ').map((n) => n[0]).join('');
      return `[NAME:${initials}***]`;
    },
  },
];

/**
 * Redact PII from text with recovery capability.
 */
export function redactPII(text: string): RedactionResult {
  const piiFields: PIIMatch[] = [];
  let redactedText = text;
  const recoveryData: Array<{ type: string; original: string; index: number }> = [];

  for (const { type, pattern, redactor } of PII_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      const originalValue = match[0];
      const redactedValue = redactor(originalValue);

      piiFields.push({
        type,
        originalValue,
        redactedValue,
        startIndex: match.index,
        endIndex: match.index + originalValue.length,
      });

      recoveryData.push({
        type,
        original: originalValue,
        index: match.index,
      });
    }
  }

  // Apply redactions in reverse order to preserve indices
  for (const field of piiFields.sort((a, b) => b.startIndex - a.startIndex)) {
    redactedText =
      redactedText.substring(0, field.startIndex) +
      field.redactedValue +
      redactedText.substring(field.endIndex);
  }

  // Create recovery token (in production, this would be encrypted)
  const recoveryToken = Buffer.from(
    JSON.stringify(recoveryData)
  ).toString('base64');

  return { redactedText, piiFields, recoveryToken };
}

/**
 * Recover original PII from recovery token (compliance access only).
 */
export function recoverPII(
  redactedText: string,
  recoveryToken: string
): string {
  try {
    const recoveryData = JSON.parse(
      Buffer.from(recoveryToken, 'base64').toString('utf8')
    ) as Array<{ type: string; original: string; index: number }>;

    // This is a simplified recovery - production would need to handle
    // the redacted placeholders more carefully
    let result = redactedText;

    // Find and replace each placeholder with original value
    for (const { type, original } of recoveryData) {
      const placeholderPattern = new RegExp(
        `\\[${type.toUpperCase()}:[^\\]]+\\]`,
        'i'
      );
      result = result.replace(placeholderPattern, original);
    }

    return result;
  } catch {
    return redactedText;
  }
}

/**
 * Compliance audit logger.
 */
export class AuditLogger {
  private entries: Map<string, AuditEntry>;
  private recoveryTokens: Map<string, string>;

  constructor() {
    this.entries = new Map();
    this.recoveryTokens = new Map();
  }

  /**
   * Log an AI decision with full audit trail.
   */
  log(
    sessionId: string,
    userId: string,
    userRole: UserRole,
    actionType: ActionType,
    riskLevel: RiskLevel,
    input: string,
    output: string,
    decision: 'executed' | 'pending' | 'denied' | 'blocked',
    reason: string,
    approvalId: string | null,
    approvalStatus: ApprovalStatus | null,
    retentionDays: number
  ): AuditEntry {
    const inputRedaction = redactPII(input);
    const outputRedaction = redactPII(output);

    const entry: AuditEntry = {
      id: generateId(),
      timestamp: Date.now(),
      sessionId,
      userId,
      userRole,
      actionType,
      riskLevel,
      inputHash: hashContent(input),
      outputHash: hashContent(output),
      redactedInput: inputRedaction.redactedText,
      redactedOutput: outputRedaction.redactedText,
      piiFields: [
        ...inputRedaction.piiFields.map((f) => f.type),
        ...outputRedaction.piiFields.map((f) => f.type),
      ],
      approvalId,
      approvalStatus,
      decision,
      reason,
      expiresAt: Date.now() + retentionDays * 24 * 60 * 60 * 1000,
    };

    this.entries.set(entry.id, entry);

    // Store recovery tokens separately with entry ID reference
    if (inputRedaction.recoveryToken) {
      this.recoveryTokens.set(`${entry.id}:input`, inputRedaction.recoveryToken);
    }
    if (outputRedaction.recoveryToken) {
      this.recoveryTokens.set(`${entry.id}:output`, outputRedaction.recoveryToken);
    }

    return entry;
  }

  /**
   * Get all entries for a session.
   */
  getEntriesBySession(sessionId: string): AuditEntry[] {
    const result: AuditEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) {
        result.push(entry);
      }
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get all entries for a user.
   */
  getEntriesByUser(userId: string): AuditEntry[] {
    const result: AuditEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.userId === userId) {
        result.push(entry);
      }
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get entry by ID.
   */
  getEntry(id: string): AuditEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Get all entries.
   */
  getAllEntries(): AuditEntry[] {
    return Array.from(this.entries.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  /**
   * Recover original content for compliance review (requires compliance role).
   */
  recoverOriginalContent(
    entryId: string,
    field: 'input' | 'output'
  ): string | null {
    const entry = this.entries.get(entryId);
    if (!entry) return null;

    const token = this.recoveryTokens.get(`${entryId}:${field}`);
    if (!token) return null;

    const redactedText =
      field === 'input' ? entry.redactedInput : entry.redactedOutput;

    return recoverPII(redactedText, token);
  }

  /**
   * Check if an entry has expired.
   */
  isExpired(entryId: string, currentTime: number): boolean {
    const entry = this.entries.get(entryId);
    if (!entry) return true;
    return currentTime >= entry.expiresAt;
  }

  /**
   * Delete expired entries (retention policy enforcement).
   */
  deleteExpired(currentTime: number): string[] {
    const deleted: string[] = [];

    for (const [id, entry] of this.entries) {
      if (currentTime >= entry.expiresAt) {
        this.entries.delete(id);
        this.recoveryTokens.delete(`${id}:input`);
        this.recoveryTokens.delete(`${id}:output`);
        deleted.push(id);
      }
    }

    return deleted;
  }

  /**
   * Verify audit trail completeness for a session.
   */
  verifyCompleteness(sessionId: string): {
    complete: boolean;
    missingFields: string[];
  } {
    const entries = this.getEntriesBySession(sessionId);
    const missingFields: string[] = [];

    for (const entry of entries) {
      if (!entry.id) missingFields.push(`${entry.timestamp}:id`);
      if (!entry.timestamp) missingFields.push(`${entry.id}:timestamp`);
      if (!entry.sessionId) missingFields.push(`${entry.id}:sessionId`);
      if (!entry.userId) missingFields.push(`${entry.id}:userId`);
      if (!entry.inputHash) missingFields.push(`${entry.id}:inputHash`);
      if (!entry.outputHash) missingFields.push(`${entry.id}:outputHash`);
      if (!entry.decision) missingFields.push(`${entry.id}:decision`);
    }

    return {
      complete: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Get count of entries.
   */
  getEntryCount(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries.clear();
    this.recoveryTokens.clear();
  }
}
