// Amount filtering: the fix for the canonicalization bug.
//
// The insight: a stated amount is a CONSTRAINT, not a hint. When someone
// asks "What happened with the $300,000 contract?", they want documents
// containing exactly $300,000 — not documents that happen to share digit
// patterns with that number.
//
// BM25 cannot enforce this. A canonicalized token like "money:30000000"
// competes with other tokens, and "money:300000000" (ten times larger)
// contains "money:30000000" as a prefix, so substring-based matching
// produces false positives.
//
// The fix: filter the corpus to documents containing the exact amount
// BEFORE searching. The amount is a hard constraint, not a soft signal.

import type { Chunk } from './types.ts';
import { extractAmounts, parseMoney } from './normalizer.ts';

/**
 * Extract an exact amount constraint from a query.
 * Returns null if no clear amount is specified.
 */
export function extractQueryAmount(query: string): number | null {
  const amounts = extractAmounts(query);
  // If exactly one amount is mentioned, use it as a filter.
  // Multiple amounts are ambiguous — which one is the constraint?
  if (amounts.length === 1) {
    return amounts[0];
  }
  return null;
}

/**
 * Filter chunks to those containing an exact amount.
 * This is the key insight: amounts are constraints, not hints.
 */
export function filterByAmount(chunks: Chunk[], amount: number): Chunk[] {
  return chunks.filter((chunk) => chunk.amounts.includes(amount));
}

/**
 * Demonstrate the prefix collision bug.
 * Returns true if token1 is a prefix of token2 (the bug condition).
 */
export function hasPrefixCollision(
  smallerAmount: number,
  largerAmount: number
): boolean {
  const smallerToken = `money:${smallerAmount}`;
  const largerToken = `money:${largerAmount}`;
  return largerToken.includes(smallerToken);
}

/**
 * Check if two amounts would collide in substring matching.
 * This is why .includes() matching on money tokens fails.
 */
export function checkSubstringCollision(
  targetCents: number,
  candidateCents: number
): {
  collides: boolean;
  targetToken: string;
  candidateToken: string;
} {
  const targetToken = `money:${targetCents}`;
  const candidateToken = `money:${candidateCents}`;

  // Check both directions: does either contain the other?
  const collides =
    candidateToken.includes(targetToken) ||
    targetToken.includes(candidateToken);

  return { collides, targetToken, candidateToken };
}
