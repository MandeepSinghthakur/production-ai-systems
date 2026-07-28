// Syntax and safety validation for generated code.
// Validates code before execution to catch dangerous patterns.

import type {
  CodeGenResult,
  SafetyViolation,
  SafetyViolationType,
  ValidationError,
} from './types.ts';
import { DESTRUCTIVE_PATTERNS, PATH_ESCAPE_PATTERNS } from './types.ts';

/**
 * CodeValidator checks generated code for syntax and safety issues.
 *
 * Two-phase validation:
 * 1. Syntax check: is the code parseable?
 * 2. Safety check: does the code contain dangerous patterns?
 *
 * Both must pass before code can be executed.
 */
export class CodeValidator {
  private customPatterns: Array<{
    pattern: RegExp;
    type: SafetyViolationType;
    severity: 'block' | 'warn';
  }>;

  constructor() {
    this.customPatterns = [];
  }

  /**
   * Validate code for both syntax and safety.
   */
  validate(
    code: string,
    language: string
  ): { valid: boolean; errors: ValidationError[]; violations: SafetyViolation[] } {
    const syntaxErrors = this.validateSyntax(code, language);
    const safetyViolations = this.checkSafety(code);

    const blockingViolations = safetyViolations.filter(
      (v) => v.severity === 'block'
    );

    return {
      valid: syntaxErrors.length === 0 && blockingViolations.length === 0,
      errors: syntaxErrors,
      violations: safetyViolations,
    };
  }

  /**
   * Add a custom safety pattern.
   */
  addPattern(
    pattern: RegExp,
    type: SafetyViolationType,
    severity: 'block' | 'warn'
  ): void {
    this.customPatterns.push({ pattern, type, severity });
  }

  /**
   * Validate syntax only.
   */
  validateSyntax(code: string, language: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check for empty code
    if (!code.trim()) {
      errors.push({
        line: 1,
        column: 1,
        message: 'Empty code block',
        severity: 'error',
      });
      return errors;
    }

    // Language-specific validation
    if (language === 'typescript' || language === 'javascript') {
      errors.push(...this.validateJSSyntax(code));
    } else if (language === 'python') {
      errors.push(...this.validatePythonSyntax(code));
    }

    return errors;
  }

  /**
   * Check code for safety violations.
   */
  checkSafety(code: string): SafetyViolation[] {
    const violations: SafetyViolation[] = [];

    // Check destructive patterns
    for (const { pattern, name, description } of DESTRUCTIVE_PATTERNS) {
      const match = code.match(pattern);
      if (match) {
        violations.push({
          type: 'destructive_command',
          pattern: name,
          location: this.findLocation(code, match.index ?? 0),
          severity: 'block',
        });
      }
    }

    // Check path escape patterns
    for (const pattern of PATH_ESCAPE_PATTERNS) {
      const match = code.match(pattern);
      if (match) {
        violations.push({
          type: 'file_escape',
          pattern: pattern.source,
          location: this.findLocation(code, match.index ?? 0),
          severity: 'block',
        });
      }
    }

    // Check for infinite loops
    const infiniteLoopViolations = this.checkInfiniteLoops(code);
    violations.push(...infiniteLoopViolations);

    // Check for network access
    const networkViolations = this.checkNetworkAccess(code);
    violations.push(...networkViolations);

    // Check for credential exposure
    const credentialViolations = this.checkCredentialExposure(code);
    violations.push(...credentialViolations);

    // Check custom patterns
    for (const { pattern, type, severity } of this.customPatterns) {
      const match = code.match(pattern);
      if (match) {
        violations.push({
          type,
          pattern: pattern.source,
          location: this.findLocation(code, match.index ?? 0),
          severity,
        });
      }
    }

    return violations;
  }

  /**
   * Check for potential infinite loops.
   */
  private checkInfiniteLoops(code: string): SafetyViolation[] {
    const violations: SafetyViolation[] = [];

    // while(true) without break
    const whileTruePattern = /while\s*\(\s*true\s*\)\s*\{[^}]*\}/g;
    let match;

    while ((match = whileTruePattern.exec(code)) !== null) {
      const block = match[0];
      if (!block.includes('break') && !block.includes('return')) {
        violations.push({
          type: 'infinite_loop',
          pattern: 'while(true) without break',
          location: this.findLocation(code, match.index),
          severity: 'block',
        });
      }
    }

    // for(;;) without break
    const foreverPattern = /for\s*\(\s*;;\s*\)\s*\{[^}]*\}/g;
    while ((match = foreverPattern.exec(code)) !== null) {
      const block = match[0];
      if (!block.includes('break') && !block.includes('return')) {
        violations.push({
          type: 'infinite_loop',
          pattern: 'for(;;) without break',
          location: this.findLocation(code, match.index),
          severity: 'block',
        });
      }
    }

    // Recursive call without base case (simple heuristic)
    const recursivePattern = /function\s+(\w+)[^{]*\{[^}]*\1\s*\([^}]*\}/g;
    while ((match = recursivePattern.exec(code)) !== null) {
      const block = match[0];
      if (!block.includes('if') && !block.includes('return')) {
        violations.push({
          type: 'infinite_loop',
          pattern: 'Recursive function without visible base case',
          location: this.findLocation(code, match.index),
          severity: 'warn',
        });
      }
    }

    return violations;
  }

  /**
   * Check for network access patterns.
   */
  private checkNetworkAccess(code: string): SafetyViolation[] {
    const violations: SafetyViolation[] = [];

    const networkPatterns = [
      { pattern: /fetch\s*\(/, name: 'fetch' },
      { pattern: /axios\s*\./, name: 'axios' },
      { pattern: /http\.request/, name: 'http.request' },
      { pattern: /https\.request/, name: 'https.request' },
      { pattern: /net\.connect/, name: 'net.connect' },
      { pattern: /WebSocket\s*\(/, name: 'WebSocket' },
      { pattern: /XMLHttpRequest/, name: 'XMLHttpRequest' },
    ];

    for (const { pattern, name } of networkPatterns) {
      const match = code.match(pattern);
      if (match) {
        violations.push({
          type: 'network_access',
          pattern: name,
          location: this.findLocation(code, match.index ?? 0),
          severity: 'warn', // Warn, not block - some network access is valid
        });
      }
    }

    return violations;
  }

  /**
   * Check for credential exposure patterns.
   */
  private checkCredentialExposure(code: string): SafetyViolation[] {
    const violations: SafetyViolation[] = [];

    const credentialPatterns = [
      { pattern: /process\.env\.\w*KEY/i, name: 'API key from env' },
      { pattern: /process\.env\.\w*SECRET/i, name: 'Secret from env' },
      { pattern: /process\.env\.\w*PASSWORD/i, name: 'Password from env' },
      { pattern: /process\.env\.\w*TOKEN/i, name: 'Token from env' },
      { pattern: /(['"])[a-zA-Z0-9]{32,}\1/, name: 'Hardcoded key-like string' },
      { pattern: /Bearer\s+[a-zA-Z0-9._-]+/, name: 'Bearer token' },
    ];

    for (const { pattern, name } of credentialPatterns) {
      const match = code.match(pattern);
      if (match) {
        violations.push({
          type: 'credential_exposure',
          pattern: name,
          location: this.findLocation(code, match.index ?? 0),
          severity: 'warn',
        });
      }
    }

    return violations;
  }

  /**
   * Basic JavaScript syntax validation.
   */
  private validateJSSyntax(code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let templateDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prev = j > 0 ? line[j - 1] : '';

        // Handle template literals
        if (char === '`' && prev !== '\\') {
          if (!inTemplate) {
            inTemplate = true;
            templateDepth = 1;
          } else {
            inTemplate = false;
            templateDepth = 0;
          }
          continue;
        }

        // Handle strings
        if ((char === '"' || char === "'") && prev !== '\\' && !inTemplate) {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }

        if (inString) continue;

        // Count brackets
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;

        // Check for negative counts
        if (braceCount < 0) {
          errors.push({
            line: i + 1,
            column: j + 1,
            message: 'Unexpected closing brace',
            severity: 'error',
          });
          braceCount = 0;
        }
      }
    }

    // Check unclosed at end
    if (braceCount > 0) {
      errors.push({
        line: lines.length,
        column: 1,
        message: `Unclosed braces: ${braceCount} remaining`,
        severity: 'error',
      });
    }
    if (parenCount !== 0) {
      errors.push({
        line: lines.length,
        column: 1,
        message: `Unbalanced parentheses: ${Math.abs(parenCount)} ${parenCount > 0 ? 'unclosed' : 'extra'}`,
        severity: 'error',
      });
    }

    return errors;
  }

  /**
   * Basic Python syntax validation.
   */
  private validatePythonSyntax(code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      // Check for mixed tabs and spaces
      if (line.match(/^\t+ /) || line.match(/^ +\t/)) {
        errors.push({
          line: i + 1,
          column: 1,
          message: 'Mixed tabs and spaces in indentation',
          severity: 'error',
        });
      }
    }

    return errors;
  }

  /**
   * Find line:column location for a character index.
   */
  private findLocation(code: string, index: number): string {
    const before = code.substring(0, index);
    const lines = before.split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    return `line ${line}, column ${column}`;
  }
}

/**
 * Validate that generated code result is safe to execute.
 */
export function isCodeSafeToExecute(result: CodeGenResult): boolean {
  // Must be syntactically valid
  if (!result.valid) return false;

  // Must have no blocking safety violations
  const blockingViolations = result.safetyViolations.filter(
    (v) => v.severity === 'block'
  );
  if (blockingViolations.length > 0) return false;

  return true;
}

/**
 * Get a human-readable summary of validation issues.
 */
export function summarizeValidationIssues(
  errors: ValidationError[],
  violations: SafetyViolation[]
): string {
  const parts: string[] = [];

  if (errors.length > 0) {
    parts.push(`${errors.length} syntax error(s)`);
  }

  const blocking = violations.filter((v) => v.severity === 'block');
  const warnings = violations.filter((v) => v.severity === 'warn');

  if (blocking.length > 0) {
    parts.push(`${blocking.length} blocked pattern(s)`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s)`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No issues';
}
