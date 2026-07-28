// Money normalization: $0.3M, $300K, $300,000 all become money:300000.
// This chapter demonstrates why this *seems* like it should fix numeric
// recall, and why it actually does not — BM25 scores the canonical token
// as one term among many, so distractors with similar digit patterns
// outrank the correct document.

const MONEY_PATTERN =
  /\$\s*([\d,]+(?:\.\d+)?)\s*(m|mm|mil|million|k|thousand)?/gi;

/**
 * Parse a money string to cents (integer). Returns null if unparseable.
 * Examples:
 *   "$300,000" -> 30000000
 *   "$0.3M"    -> 30000000
 *   "$300K"    -> 30000000
 *   "$3,000,000" -> 300000000
 */
export function parseMoney(raw: string): number | null {
  const match = raw.match(
    /^\$\s*([\d,]+(?:\.\d+)?)\s*(m|mm|mil|million|k|thousand)?$/i
  );
  if (!match) return null;

  const numPart = match[1].replace(/,/g, '');
  let value = parseFloat(numPart);
  if (Number.isNaN(value)) return null;

  const suffix = (match[2] ?? '').toLowerCase();
  if (suffix === 'm' || suffix === 'mm' || suffix === 'mil' ||
      suffix === 'million') {
    value *= 1_000_000;
  } else if (suffix === 'k' || suffix === 'thousand') {
    value *= 1_000;
  }

  // Convert to cents, round to integer
  return Math.round(value * 100);
}

/**
 * Extract all money amounts from text as cents.
 */
export function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  MONEY_PATTERN.lastIndex = 0;
  while ((match = MONEY_PATTERN.exec(text)) !== null) {
    const parsed = parseMoney(match[0]);
    if (parsed !== null) {
      amounts.push(parsed);
    }
  }

  return amounts;
}

/**
 * Canonicalize money amounts in text: "$300,000" -> "money:30000000".
 * This is the approach that LOOKS right but fails in BM25 — the chapter
 * demonstrates why.
 */
export function canonicalizeMoney(text: string): string {
  return text.replace(MONEY_PATTERN, (match) => {
    const cents = parseMoney(match);
    if (cents === null) return match;
    return `money:${cents}`;
  });
}

/**
 * Normalize text for search: lowercase, strip punctuation, canonicalize
 * money if requested.
 */
export function normalizeForSearch(
  text: string,
  canonicalizeAmounts: boolean
): string {
  let result = text.toLowerCase();
  if (canonicalizeAmounts) {
    result = canonicalizeMoney(result);
  }
  // Remove punctuation except colons (for money:X tokens)
  result = result.replace(/[^\w\s:]/g, ' ');
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}
