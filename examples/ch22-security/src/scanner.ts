// Security scanner combining injection detection, PII handling,
// sanitization, and audit logging into a single pipeline.
//
// This is the integration point: each component runs independently,
// and the scanner coordinates them into a before/after hook pattern.

import type {
  AuditEntry,
  ScannerConfig,
  SecurityScanResult,
  DEFAULT_SCANNER_CONFIG,
} from './types.ts';
import { InjectionScanner } from './injection.ts';
import { PIIScanner } from './pii.ts';
import { InputSanitizer } from './sanitizer.ts';
import { AuditLogger } from './audit.ts';

/**
 * Generate a request ID for tracking.
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}_${random}`;
}

/**
 * SecurityScanner coordinates all security checks.
 *
 * Usage:
 *   const scanner = new SecurityScanner(config, auditLogger);
 *   const result = scanner.scanInput(userInput, tenantId);
 *   if (!result.passed) {
 *     reject(result.blockedReason);
 *     return;
 *   }
 *   const safeInput = result.sanitization.sanitized;
 *   // send safeInput to LLM
 */
export class SecurityScanner {
  private config: ScannerConfig;
  private injectionScanner: InjectionScanner;
  private piiScanner: PIIScanner;
  private inputSanitizer: InputSanitizer;
  private auditLogger: AuditLogger;

  constructor(config: ScannerConfig, auditLogger: AuditLogger) {
    this.config = config;
    this.injectionScanner = new InjectionScanner(config.injectionThreshold);
    this.piiScanner = new PIIScanner();
    this.inputSanitizer = new InputSanitizer(config.sanitizeOptions);
    this.auditLogger = auditLogger;
  }

  /**
   * Scan input before sending to LLM.
   * Returns a result indicating whether to proceed.
   */
  scanInput(
    input: string,
    tenantId: string,
    userId?: string
  ): SecurityScanResult {
    const requestId = generateRequestId();
    const timestamp = Date.now();

    // 1. Log request received
    this.auditLogger.logRequestReceived(requestId, tenantId, input, userId);

    // 2. Check for prompt injection
    const injectionResult = this.injectionScanner.scan(input);

    if (injectionResult.blocked && this.config.blockOnInjection) {
      // Log the blocked request
      this.auditLogger.logInjectionBlocked(
        requestId,
        tenantId,
        injectionResult.injectionType ?? 'unknown',
        injectionResult.confidence,
        injectionResult.inputFragment ?? ''
      );

      return {
        passed: false,
        requestId,
        timestamp,
        injection: injectionResult,
        pii: { hasPII: false, matches: [], redactedText: input },
        sanitization: {
          sanitized: input,
          modifications: [],
          truncated: false,
          originalLength: input.length,
        },
        auditEntry: this.auditLogger.getEntriesByRequest(requestId)[0],
        blockedReason: `Injection detected: ${injectionResult.injectionType}`,
      };
    }

    // 3. Detect and redact PII
    const piiResult = this.piiScanner.scan(input);
    let processedInput = input;

    if (piiResult.hasPII && this.config.redactPII) {
      processedInput = piiResult.redactedText;

      // Log PII redaction
      this.auditLogger.logPIIRedacted(
        requestId,
        tenantId,
        piiResult.matches.map((m) => m.type),
        piiResult.matches.length
      );
    }

    // 4. Sanitize input
    const sanitizeResult = this.inputSanitizer.sanitize(processedInput);

    // 5. Log dispatch
    this.auditLogger.logRequestDispatched(
      requestId,
      tenantId,
      sanitizeResult.sanitized
    );

    return {
      passed: true,
      requestId,
      timestamp,
      injection: injectionResult,
      pii: piiResult,
      sanitization: sanitizeResult,
      auditEntry: this.auditLogger.getEntriesByRequest(requestId)[0],
      blockedReason: null,
    };
  }

  /**
   * Scan multiple messages (e.g., conversation history).
   * Blocks if any message contains injection.
   */
  scanConversation(
    messages: Array<{ role: string; content: string }>,
    tenantId: string,
    userId?: string
  ): SecurityScanResult {
    // Concatenate user messages for injection scanning
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content);

    // Scan combined input
    const combined = userMessages.join('\n---\n');
    return this.scanInput(combined, tenantId, userId);
  }

  /**
   * Get the audit logger for external access.
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }
}

/**
 * Create a scanner with default configuration.
 */
export function createScanner(
  config?: Partial<ScannerConfig>,
  auditLogger?: AuditLogger
): SecurityScanner {
  const fullConfig: ScannerConfig = {
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
    ...config,
  };

  return new SecurityScanner(fullConfig, auditLogger ?? new AuditLogger());
}

/**
 * Quick scan function for simple cases.
 */
export function quickScan(
  input: string,
  tenantId: string = 'default'
): SecurityScanResult {
  const scanner = createScanner();
  return scanner.scanInput(input, tenantId);
}
