// Core types for AI security: prompt injection, PII handling, audit trails.
// See Chapter 22, "Building Production AI Systems".

/**
 * Severity levels for security findings.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Categories of prompt injection attacks.
 */
export type InjectionType =
  | 'direct_override'     // "Ignore previous instructions"
  | 'role_escape'         // "You are now a different assistant"
  | 'delimiter_attack'    // Attempts to break out of structured prompts
  | 'instruction_leak'    // Trying to extract system prompt
  | 'jailbreak'           // Attempts to bypass safety guidelines
  | 'indirect_injection'; // Injection hidden in external content

/**
 * Result of scanning input for injection attempts.
 */
export interface InjectionScanResult {
  blocked: boolean;
  injectionType: InjectionType | null;
  confidence: number;      // 0.0 to 1.0
  matchedPattern: string | null;
  inputFragment: string | null;
}

/**
 * Categories of PII (Personally Identifiable Information).
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'           // Social Security Number
  | 'credit_card'
  | 'ip_address'
  | 'name'
  | 'address';

/**
 * A detected PII occurrence.
 */
export interface PIIMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
  redactedValue: string;
}

/**
 * Result of PII scanning.
 */
export interface PIIScanResult {
  hasPII: boolean;
  matches: PIIMatch[];
  redactedText: string;
}

/**
 * Audit event types for compliance logging.
 */
export type AuditEventType =
  | 'request_received'
  | 'injection_blocked'
  | 'pii_redacted'
  | 'request_dispatched'
  | 'response_received'
  | 'response_filtered'
  | 'error_occurred';

/**
 * Audit log entry.
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  requestId: string;
  tenantId: string;
  userId: string | null;
  severity: Severity;
  details: Record<string, unknown>;
  inputHash: string | null;      // Hash of input, not plaintext
  outputHash: string | null;     // Hash of output, not plaintext
  piiRedacted: boolean;
  blocked: boolean;
  durationMs: number | null;
}

/**
 * Sanitization options.
 */
export interface SanitizeOptions {
  maxLength: number;
  stripControlChars: boolean;
  normalizeWhitespace: boolean;
  escapeDelimiters: boolean;
  removeInvisible: boolean;
}

/**
 * Result of input sanitization.
 */
export interface SanitizeResult {
  sanitized: string;
  modifications: SanitizeModification[];
  truncated: boolean;
  originalLength: number;
}

/**
 * A single sanitization modification.
 */
export interface SanitizeModification {
  type: 'truncated' | 'control_char' | 'whitespace' | 'delimiter' | 'invisible';
  position: number;
  original: string;
  replacement: string;
}

/**
 * Complete security scan result.
 */
export interface SecurityScanResult {
  passed: boolean;
  requestId: string;
  timestamp: number;
  injection: InjectionScanResult;
  pii: PIIScanResult;
  sanitization: SanitizeResult;
  auditEntry: AuditEntry;
  blockedReason: string | null;
}

/**
 * Security scanner configuration.
 */
export interface ScannerConfig {
  blockOnInjection: boolean;
  injectionThreshold: number;    // Confidence threshold to block
  redactPII: boolean;
  logInputHashes: boolean;
  maxInputLength: number;
  sanitizeOptions: SanitizeOptions;
}

/**
 * Default scanner configuration.
 */
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  blockOnInjection: true,
  injectionThreshold: 0.7,
  redactPII: true,
  logInputHashes: true,
  maxInputLength: 100_000,
  sanitizeOptions: {
    maxLength: 100_000,
    stripControlChars: true,
    normalizeWhitespace: false,
    escapeDelimiters: true,
    removeInvisible: true,
  },
};
