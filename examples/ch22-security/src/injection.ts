// Prompt injection detection.
// Detects common injection patterns including direct overrides,
// role escapes, delimiter attacks, and instruction extraction attempts.
//
// This is a heuristic-based scanner. It catches known patterns but
// will not catch novel attacks. Defense in depth is required:
// injection detection is one layer, not the only layer.

import type { InjectionScanResult, InjectionType } from './types.ts';

/**
 * Pattern definition for injection detection.
 */
interface InjectionPattern {
  type: InjectionType;
  pattern: RegExp;
  confidence: number;
  description: string;
}

/**
 * Known injection patterns. Ordered by severity/confidence.
 * These patterns are intentionally broad to minimize false negatives
 * at the cost of some false positives. Production systems should
 * tune these thresholds based on observed traffic.
 */
const INJECTION_PATTERNS: InjectionPattern[] = [
  // Direct instruction overrides
  {
    type: 'direct_override',
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)?\s*(instructions?|prompts?|rules?|guidelines?)/i,
    confidence: 0.95,
    description: 'Direct instruction override attempt',
  },
  {
    type: 'direct_override',
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|programming)/i,
    confidence: 0.95,
    description: 'Direct instruction override attempt',
  },
  {
    type: 'direct_override',
    pattern: /forget\s+(everything|all|what)\s+(you\s+)?(know|were told|learned)/i,
    confidence: 0.90,
    description: 'Memory wipe attempt',
  },
  {
    type: 'direct_override',
    pattern: /new\s+instructions?:?\s/i,
    confidence: 0.85,
    description: 'New instruction injection',
  },

  // Role escape attempts
  {
    type: 'role_escape',
    pattern: /you\s+are\s+(now|no longer|actually)\s+(a|an|my)/i,
    confidence: 0.90,
    description: 'Role reassignment attempt',
  },
  {
    type: 'role_escape',
    pattern: /pretend\s+(to\s+be|you('re| are))\s/i,
    confidence: 0.85,
    description: 'Role pretense attempt',
  },
  {
    type: 'role_escape',
    pattern: /act\s+as\s+(if\s+)?(you('re| are)|a|an)/i,
    confidence: 0.80,
    description: 'Role acting attempt',
  },
  {
    type: 'role_escape',
    pattern: /roleplay\s+as/i,
    confidence: 0.85,
    description: 'Roleplay attempt',
  },
  {
    type: 'role_escape',
    pattern: /enter\s+(developer|admin|god|sudo|root)\s*mode/i,
    confidence: 0.95,
    description: 'Privileged mode attempt',
  },

  // Delimiter attacks
  {
    type: 'delimiter_attack',
    pattern: /\[\/?(system|user|assistant|inst|INST)\]/i,
    confidence: 0.90,
    description: 'Chat format delimiter injection',
  },
  {
    type: 'delimiter_attack',
    pattern: /<\/?system>|<\/?user>|<\/?assistant>/i,
    confidence: 0.90,
    description: 'XML delimiter injection',
  },
  {
    type: 'delimiter_attack',
    pattern: /```\s*(system|instructions?|prompt)/i,
    confidence: 0.85,
    description: 'Code block delimiter attack',
  },
  {
    type: 'delimiter_attack',
    pattern: /---+\s*(system|instructions?|end)/i,
    confidence: 0.80,
    description: 'Markdown delimiter attack',
  },

  // Instruction leak attempts
  {
    type: 'instruction_leak',
    pattern: /(what|show|reveal|repeat|print|display|tell)\s+(are\s+)?(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?|rules?|guidelines?)/i,
    confidence: 0.90,
    description: 'System prompt extraction attempt',
  },
  {
    type: 'instruction_leak',
    pattern: /output\s+(your|the)\s+(entire\s+)?(system\s+)?(prompt|instructions?)/i,
    confidence: 0.95,
    description: 'System prompt output attempt',
  },
  {
    type: 'instruction_leak',
    pattern: /beginning\s+of\s+(your|the)\s+(conversation|prompt)/i,
    confidence: 0.85,
    description: 'Prompt beginning extraction',
  },

  // Jailbreak patterns
  {
    type: 'jailbreak',
    pattern: /DAN\s*(mode)?|Do\s+Anything\s+Now/i,
    confidence: 0.95,
    description: 'DAN jailbreak attempt',
  },
  {
    type: 'jailbreak',
    pattern: /jailbreak|bypass\s+(safety|filter|restriction)/i,
    confidence: 0.90,
    description: 'Explicit jailbreak mention',
  },
  {
    type: 'jailbreak',
    pattern: /hypothetically|theoretically|for\s+(educational|research)\s+purposes/i,
    confidence: 0.60, // Lower confidence - often legitimate
    description: 'Hypothetical framing (potential jailbreak)',
  },

  // Indirect injection markers
  {
    type: 'indirect_injection',
    pattern: /\[hidden\]|\[invisible\]|<!--.*instruction/i,
    confidence: 0.95,
    description: 'Hidden instruction marker',
  },
  {
    type: 'indirect_injection',
    pattern: /when\s+you\s+(see|read|process)\s+this/i,
    confidence: 0.75,
    description: 'Trigger-based injection',
  },
];

/**
 * InjectionScanner detects prompt injection attempts.
 *
 * Usage:
 *   const scanner = new InjectionScanner();
 *   const result = scanner.scan(userInput);
 *   if (result.blocked) { reject(result.injectionType); }
 */
export class InjectionScanner {
  private patterns: InjectionPattern[];
  private blockThreshold: number;

  constructor(blockThreshold: number = 0.7) {
    this.patterns = INJECTION_PATTERNS;
    this.blockThreshold = blockThreshold;
  }

  /**
   * Scan input for injection attempts.
   */
  scan(input: string): InjectionScanResult {
    // Normalize input for matching
    const normalized = this.normalize(input);

    let highestConfidence = 0;
    let detectedType: InjectionType | null = null;
    let matchedPattern: string | null = null;
    let inputFragment: string | null = null;

    for (const pattern of this.patterns) {
      const match = normalized.match(pattern.pattern);
      if (match && pattern.confidence > highestConfidence) {
        highestConfidence = pattern.confidence;
        detectedType = pattern.type;
        matchedPattern = pattern.description;
        inputFragment = this.extractFragment(input, match.index ?? 0, match[0].length);
      }
    }

    return {
      blocked: highestConfidence >= this.blockThreshold,
      injectionType: detectedType,
      confidence: highestConfidence,
      matchedPattern,
      inputFragment,
    };
  }

  /**
   * Scan multiple inputs (e.g., conversation history).
   * Returns the highest-confidence result.
   */
  scanAll(inputs: string[]): InjectionScanResult {
    let worst: InjectionScanResult = {
      blocked: false,
      injectionType: null,
      confidence: 0,
      matchedPattern: null,
      inputFragment: null,
    };

    for (const input of inputs) {
      const result = this.scan(input);
      if (result.confidence > worst.confidence) {
        worst = result;
      }
    }

    return worst;
  }

  /**
   * Normalize input for pattern matching.
   * Removes extra whitespace and normalizes unicode.
   */
  private normalize(input: string): string {
    return input
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract a fragment around a match for logging.
   * Includes context but limits length.
   */
  private extractFragment(input: string, index: number, matchLength: number): string {
    const contextChars = 30;
    const start = Math.max(0, index - contextChars);
    const end = Math.min(input.length, index + matchLength + contextChars);

    let fragment = input.slice(start, end);
    if (start > 0) fragment = '...' + fragment;
    if (end < input.length) fragment = fragment + '...';

    return fragment;
  }
}

/**
 * Quick check function for simple cases.
 */
export function detectInjection(input: string, threshold: number = 0.7): InjectionScanResult {
  const scanner = new InjectionScanner(threshold);
  return scanner.scan(input);
}
