// Input sanitization for LLM requests.
// Cleans user input before sending to the model to prevent:
// - Control character injection
// - Invisible character attacks
// - Delimiter manipulation
// - Excessively long inputs
//
// Sanitization is not a substitute for prompt injection detection.
// It's a defense-in-depth layer that normalizes input.

import type {
  SanitizeModification,
  SanitizeOptions,
  SanitizeResult,
} from './types.ts';

/**
 * Common invisible/control characters to remove.
 * These can be used to hide malicious content.
 */
const INVISIBLE_CHARS: RegExp = /[\u200B-\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF]/g;

/**
 * Control characters (except newline, tab, carriage return).
 */
const CONTROL_CHARS: RegExp = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Common delimiters used in prompt templates.
 * Escaping these prevents delimiter injection attacks.
 */
const DELIMITER_PATTERNS: Array<{ pattern: RegExp; escape: string }> = [
  { pattern: /```/g, escape: '\\`\\`\\`' },
  { pattern: /<\/?system>/gi, escape: '[system]' },
  { pattern: /<\/?user>/gi, escape: '[user]' },
  { pattern: /<\/?assistant>/gi, escape: '[assistant]' },
  { pattern: /\[INST\]/gi, escape: '(INST)' },
  { pattern: /\[\/INST\]/gi, escape: '(/INST)' },
  { pattern: /<<SYS>>/gi, escape: '((SYS))' },
  { pattern: /<</gi, escape: '(' },
  { pattern: />>/gi, escape: ')' },
];

/**
 * Default sanitization options.
 */
const DEFAULT_OPTIONS: SanitizeOptions = {
  maxLength: 100_000,
  stripControlChars: true,
  normalizeWhitespace: false,
  escapeDelimiters: true,
  removeInvisible: true,
};

/**
 * InputSanitizer cleans user input before LLM processing.
 *
 * Usage:
 *   const sanitizer = new InputSanitizer();
 *   const result = sanitizer.sanitize(userInput);
 *   sendToLLM(result.sanitized);
 */
export class InputSanitizer {
  private options: SanitizeOptions;

  constructor(options: Partial<SanitizeOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Sanitize input according to configured options.
   */
  sanitize(input: string): SanitizeResult {
    const modifications: SanitizeModification[] = [];
    let sanitized = input;
    let truncated = false;

    // 1. Remove invisible characters
    if (this.options.removeInvisible) {
      sanitized = this.removeMatches(
        sanitized,
        INVISIBLE_CHARS,
        'invisible',
        modifications
      );
    }

    // 2. Strip control characters
    if (this.options.stripControlChars) {
      sanitized = this.removeMatches(
        sanitized,
        CONTROL_CHARS,
        'control_char',
        modifications
      );
    }

    // 3. Normalize whitespace
    if (this.options.normalizeWhitespace) {
      const before = sanitized;
      sanitized = sanitized.replace(/\s+/g, ' ').trim();
      if (before !== sanitized) {
        modifications.push({
          type: 'whitespace',
          position: 0,
          original: `(${before.length} chars)`,
          replacement: `(${sanitized.length} chars)`,
        });
      }
    }

    // 4. Escape delimiters
    if (this.options.escapeDelimiters) {
      for (const { pattern, escape } of DELIMITER_PATTERNS) {
        sanitized = this.escapeMatches(
          sanitized,
          pattern,
          escape,
          modifications
        );
      }
    }

    // 5. Truncate if too long
    if (sanitized.length > this.options.maxLength) {
      const originalLength = sanitized.length;
      sanitized = sanitized.slice(0, this.options.maxLength);
      truncated = true;
      modifications.push({
        type: 'truncated',
        position: this.options.maxLength,
        original: `(${originalLength} chars)`,
        replacement: `(${this.options.maxLength} chars)`,
      });
    }

    return {
      sanitized,
      modifications,
      truncated,
      originalLength: input.length,
    };
  }

  /**
   * Remove matches of a pattern and record modifications.
   */
  private removeMatches(
    input: string,
    pattern: RegExp,
    modType: SanitizeModification['type'],
    modifications: SanitizeModification[]
  ): string {
    let result = input;
    let match: RegExpExecArray | null;

    // Reset pattern
    pattern.lastIndex = 0;

    while ((match = pattern.exec(input)) !== null) {
      modifications.push({
        type: modType,
        position: match.index,
        original: this.charDescription(match[0]),
        replacement: '',
      });
    }

    result = input.replace(pattern, '');
    return result;
  }

  /**
   * Escape matches of a pattern and record modifications.
   */
  private escapeMatches(
    input: string,
    pattern: RegExp,
    escape: string,
    modifications: SanitizeModification[]
  ): string {
    let match: RegExpExecArray | null;

    // Reset pattern
    pattern.lastIndex = 0;

    while ((match = pattern.exec(input)) !== null) {
      modifications.push({
        type: 'delimiter',
        position: match.index,
        original: match[0],
        replacement: escape,
      });
    }

    return input.replace(pattern, escape);
  }

  /**
   * Human-readable description of a character.
   */
  private charDescription(char: string): string {
    if (char.length === 1) {
      const code = char.charCodeAt(0);
      if (code < 32 || code === 127) {
        return `\\x${code.toString(16).padStart(2, '0')}`;
      }
      if (code >= 0x200b && code <= 0x200d) {
        return `\\u${code.toString(16)}`;
      }
    }
    return char;
  }
}

/**
 * Quick sanitize function for simple cases.
 */
export function sanitizeInput(
  input: string,
  options?: Partial<SanitizeOptions>
): string {
  const sanitizer = new InputSanitizer(options);
  return sanitizer.sanitize(input).sanitized;
}

/**
 * Output sanitizer for model responses.
 * Checks for leaked system content or dangerous patterns.
 */
export class OutputSanitizer {
  private systemPromptMarkers: string[];

  constructor(systemPromptMarkers: string[] = []) {
    this.systemPromptMarkers = systemPromptMarkers;
  }

  /**
   * Check if output contains potential system prompt leakage.
   */
  checkForLeakage(output: string): {
    leaked: boolean;
    markers: string[];
  } {
    const leaked: string[] = [];

    for (const marker of this.systemPromptMarkers) {
      if (output.toLowerCase().includes(marker.toLowerCase())) {
        leaked.push(marker);
      }
    }

    return {
      leaked: leaked.length > 0,
      markers: leaked,
    };
  }

  /**
   * Check for potentially dangerous content in output.
   * This is a simple heuristic check, not a content policy filter.
   */
  checkForDangerousContent(output: string): {
    flagged: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // Check for code execution patterns
    if (/eval\s*\(|exec\s*\(|system\s*\(/.test(output)) {
      reasons.push('code_execution_pattern');
    }

    // Check for URL patterns that might be phishing
    if (/https?:\/\/[^\s]+@[^\s]+/.test(output)) {
      reasons.push('suspicious_url');
    }

    // Check for base64 encoded content (potential exfiltration)
    if (/[A-Za-z0-9+/]{100,}={0,2}/.test(output)) {
      reasons.push('base64_content');
    }

    return {
      flagged: reasons.length > 0,
      reasons,
    };
  }
}
