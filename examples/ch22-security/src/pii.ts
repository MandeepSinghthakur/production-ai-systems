// PII (Personally Identifiable Information) detection and redaction.
// Finds and redacts sensitive data before logging or external transmission.
//
// This uses regex patterns which catch common formats but miss edge cases.
// Production systems handling regulated data (HIPAA, GDPR, PCI) should
// use dedicated PII detection services or libraries.

import type { PIIMatch, PIIScanResult, PIIType } from './types.ts';

/**
 * PII pattern definition.
 */
interface PIIPattern {
  type: PIIType;
  pattern: RegExp;
  redactor: (match: string) => string;
  validator?: (match: string) => boolean;
}

/**
 * Luhn algorithm for credit card validation.
 * Returns true if the number passes the Luhn check.
 */
function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * PII patterns with type-specific redaction.
 */
const PII_PATTERNS: PIIPattern[] = [
  // Email addresses
  {
    type: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    redactor: (match) => {
      const [local, domain] = match.split('@');
      const redactedLocal = local[0] + '***';
      const domainParts = domain.split('.');
      const redactedDomain = '***.' + domainParts[domainParts.length - 1];
      return `[EMAIL:${redactedLocal}@${redactedDomain}]`;
    },
  },

  // US phone numbers (various formats)
  {
    type: 'phone',
    pattern: /(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    redactor: (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10) return match; // Not a full phone number
      const lastFour = digits.slice(-4);
      return `[PHONE:***-***-${lastFour}]`;
    },
    validator: (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 11;
    },
  },

  // US Social Security Numbers
  {
    type: 'ssn',
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    redactor: (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 9) return match;
      return `[SSN:***-**-${digits.slice(-4)}]`;
    },
    validator: (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 9) return false;
      // Basic validation: SSNs don't start with 9, 000, or have 00 in middle
      const area = parseInt(digits.slice(0, 3), 10);
      const group = parseInt(digits.slice(3, 5), 10);
      return area > 0 && area < 900 && group > 0;
    },
  },

  // Credit card numbers (13-19 digits with optional separators)
  {
    type: 'credit_card',
    pattern: /\b(?:\d{4}[-.\s]?){3,4}\d{1,4}\b/g,
    redactor: (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 13 || digits.length > 19) return match;
      return `[CARD:****-****-****-${digits.slice(-4)}]`;
    },
    validator: luhnCheck,
  },

  // IPv4 addresses
  {
    type: 'ip_address',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    redactor: (match) => {
      const parts = match.split('.');
      return `[IP:${parts[0]}.${parts[1]}.*.*]`;
    },
    validator: (match) => {
      // Exclude common non-PII IPs like localhost
      return match !== '127.0.0.1' && match !== '0.0.0.0';
    },
  },
];

/**
 * PIIScanner finds and redacts PII in text.
 *
 * Usage:
 *   const scanner = new PIIScanner();
 *   const result = scanner.scan(text);
 *   console.log(result.redactedText); // PII replaced with placeholders
 */
export class PIIScanner {
  private patterns: PIIPattern[];
  private enabledTypes: Set<PIIType>;

  constructor(enabledTypes?: PIIType[]) {
    this.patterns = PII_PATTERNS;
    this.enabledTypes = enabledTypes
      ? new Set(enabledTypes)
      : new Set(PII_PATTERNS.map((p) => p.type));
  }

  /**
   * Scan text for PII and return matches with redacted version.
   */
  scan(text: string): PIIScanResult {
    const matches: PIIMatch[] = [];
    let redactedText = text;

    // Track replacements to adjust indices
    const replacements: Array<{
      start: number;
      end: number;
      replacement: string;
    }> = [];

    for (const patternDef of this.patterns) {
      if (!this.enabledTypes.has(patternDef.type)) continue;

      // Reset regex lastIndex
      patternDef.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = patternDef.pattern.exec(text)) !== null) {
        const value = match[0];
        const startIndex = match.index;
        const endIndex = startIndex + value.length;

        // Run validator if present
        if (patternDef.validator && !patternDef.validator(value)) {
          continue;
        }

        // Check for overlapping matches (keep the longer one)
        const overlapping = matches.find(
          (m) =>
            (startIndex >= m.startIndex && startIndex < m.endIndex) ||
            (endIndex > m.startIndex && endIndex <= m.endIndex)
        );
        if (overlapping) {
          if (value.length <= overlapping.value.length) continue;
          // Remove the shorter match
          const idx = matches.indexOf(overlapping);
          matches.splice(idx, 1);
        }

        const redactedValue = patternDef.redactor(value);

        matches.push({
          type: patternDef.type,
          value,
          startIndex,
          endIndex,
          redactedValue,
        });

        replacements.push({
          start: startIndex,
          end: endIndex,
          replacement: redactedValue,
        });
      }
    }

    // Sort replacements by position (descending) to replace from end to start
    replacements.sort((a, b) => b.start - a.start);

    for (const rep of replacements) {
      redactedText =
        redactedText.slice(0, rep.start) +
        rep.replacement +
        redactedText.slice(rep.end);
    }

    // Sort matches by position for consistent output
    matches.sort((a, b) => a.startIndex - b.startIndex);

    return {
      hasPII: matches.length > 0,
      matches,
      redactedText,
    };
  }

  /**
   * Redact PII and return only the redacted text.
   */
  redact(text: string): string {
    return this.scan(text).redactedText;
  }

  /**
   * Check if text contains any PII without returning details.
   * Faster than full scan when you only need a boolean.
   */
  hasPII(text: string): boolean {
    for (const patternDef of this.patterns) {
      if (!this.enabledTypes.has(patternDef.type)) continue;

      patternDef.pattern.lastIndex = 0;
      const match = patternDef.pattern.exec(text);
      if (match) {
        if (!patternDef.validator || patternDef.validator(match[0])) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Quick redact function for simple cases.
 */
export function redactPII(text: string, types?: PIIType[]): string {
  const scanner = new PIIScanner(types);
  return scanner.redact(text);
}

/**
 * Check if text contains PII.
 */
export function containsPII(text: string, types?: PIIType[]): boolean {
  const scanner = new PIIScanner(types);
  return scanner.hasPII(text);
}
