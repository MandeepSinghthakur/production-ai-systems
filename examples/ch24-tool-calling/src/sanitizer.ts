// Tool argument sanitization to prevent injection attacks.
// Cleans arguments before they reach business logic.
//
// Defense in depth: even if the model is tricked into generating
// malicious arguments, the sanitizer blocks them from executing.

import type {
  SanitizeModification,
  SanitizeResult,
  ToolDefinition,
} from './types.ts';

/**
 * Patterns that indicate injection attempts in string arguments.
 * These are heuristics, not a complete solution.
 */
const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  severity: 'block' | 'strip';
}> = [
  // SQL injection markers
  {
    pattern: /('|--|;|\bOR\b\s+\d+\s*=\s*\d+|\bUNION\b\s+\bSELECT\b)/i,
    name: 'sql_injection',
    severity: 'block',
  },
  // Command injection markers
  {
    pattern: /(\$\(|`|&&|\|\||;\s*\w+|>\s*\/)/,
    name: 'command_injection',
    severity: 'block',
  },
  // Path traversal
  {
    pattern: /(\.\.[\/\\]|%2e%2e[\/\\])/i,
    name: 'path_traversal',
    severity: 'block',
  },
  // Prompt injection markers (trying to escape tool context)
  {
    pattern:
      /(<\/?system>|<\/?user>|<\/?assistant>|\[INST\]|<<SYS>>|ignore\s+(?:previous|above|all)\s+instructions)/i,
    name: 'prompt_injection',
    severity: 'block',
  },
  // Control characters (except common whitespace)
  {
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/,
    name: 'control_chars',
    severity: 'strip',
  },
  // Zero-width and invisible characters
  {
    pattern: /[\u200B-\u200D\u2060\u2061\u2062\u2063\u2064\uFEFF]/,
    name: 'invisible_chars',
    severity: 'strip',
  },
];

/**
 * Maximum length for string arguments.
 */
const MAX_STRING_LENGTH = 1024;

/**
 * ToolArgumentSanitizer cleans tool arguments before execution.
 *
 * It does NOT validate schema (that's the validator's job).
 * It DOES block or strip dangerous content that might indicate
 * an injection attack.
 */
export class ToolArgumentSanitizer {
  private blockedPatterns: Array<{
    pattern: RegExp;
    name: string;
  }>;
  private stripPatterns: Array<{
    pattern: RegExp;
    name: string;
  }>;
  private maxStringLength: number;

  constructor(maxStringLength: number = MAX_STRING_LENGTH) {
    this.maxStringLength = maxStringLength;
    this.blockedPatterns = INJECTION_PATTERNS.filter(
      (p) => p.severity === 'block'
    ).map((p) => ({ pattern: p.pattern, name: p.name }));
    this.stripPatterns = INJECTION_PATTERNS.filter(
      (p) => p.severity === 'strip'
    ).map((p) => ({ pattern: p.pattern, name: p.name }));
  }

  /**
   * Sanitize tool arguments.
   * Returns sanitized arguments or indicates blocking.
   */
  sanitize(
    args: Record<string, unknown>,
    toolDef: ToolDefinition
  ): SanitizeResult {
    const modifications: SanitizeModification[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const propSchema = toolDef.parameters.properties[key];
      if (!propSchema) {
        // Unknown property - skip (validator will handle)
        sanitized[key] = value;
        continue;
      }

      if (propSchema.type === 'string' && typeof value === 'string') {
        const result = this.sanitizeString(value, key);

        if (result.blocked) {
          return {
            sanitized: {},
            blocked: true,
            blockReason: result.blockReason,
            modifications: [],
          };
        }

        if (result.modified) {
          modifications.push(...result.modifications);
          sanitized[key] = result.value;
        } else {
          sanitized[key] = value;
        }
      } else {
        // Non-string types pass through
        sanitized[key] = value;
      }
    }

    return {
      sanitized,
      blocked: false,
      modifications,
    };
  }

  /**
   * Sanitize a single string value.
   */
  private sanitizeString(
    value: string,
    path: string
  ): {
    value: string;
    blocked: boolean;
    blockReason?: string;
    modified: boolean;
    modifications: SanitizeModification[];
  } {
    const modifications: SanitizeModification[] = [];
    let current = value;
    let modified = false;

    // Check for blocking patterns first
    for (const { pattern, name } of this.blockedPatterns) {
      if (pattern.test(current)) {
        return {
          value: '',
          blocked: true,
          blockReason: `${name} detected in ${path}`,
          modified: false,
          modifications: [],
        };
      }
    }

    // Strip dangerous characters
    for (const { pattern, name } of this.stripPatterns) {
      if (pattern.test(current)) {
        const original = current;
        current = current.replace(pattern, '');
        if (current !== original) {
          modified = true;
          modifications.push({
            path,
            type: 'stripped',
            original: `[${name}]`,
            modified: '[removed]',
          });
        }
      }
    }

    // Truncate if too long
    if (current.length > this.maxStringLength) {
      modifications.push({
        path,
        type: 'truncated',
        original: `${current.length} chars`,
        modified: `${this.maxStringLength} chars`,
      });
      current = current.slice(0, this.maxStringLength);
      modified = true;
    }

    return {
      value: current,
      blocked: false,
      modified,
      modifications,
    };
  }
}

/**
 * Quick sanitize function for simple cases.
 */
export function sanitizeToolArguments(
  args: Record<string, unknown>,
  toolDef: ToolDefinition
): SanitizeResult {
  const sanitizer = new ToolArgumentSanitizer();
  return sanitizer.sanitize(args, toolDef);
}
