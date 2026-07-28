// Idempotency key tracking for tool operations.
// Ensures the same operation is not executed twice.
//
// The key insight: idempotency is about the *outcome*, not the *request*.
// If you see the same idempotency key, return the same result, even if
// the underlying state has changed since the first execution.

import type { TransferResult } from './types.ts';

/**
 * Stored result for idempotency replay.
 */
interface StoredResult {
  key: string;
  result: TransferResult;
  createdAt: number;
  expiresAt: number;
}

/**
 * IdempotencyStore tracks executed operations by key.
 *
 * In production this would be a database table:
 * CREATE TABLE idempotency_keys (
 *   key VARCHAR(128) PRIMARY KEY,
 *   result JSONB NOT NULL,
 *   created_at TIMESTAMP NOT NULL,
 *   expires_at TIMESTAMP NOT NULL
 * );
 *
 * The TTL should be long enough to cover retry windows but short enough
 * to not accumulate forever. 24 hours is typical.
 */
export class IdempotencyStore {
  private store: Map<string, StoredResult>;
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.store = new Map();
    this.ttlMs = ttlMs;
  }

  /**
   * Check if a key has already been processed.
   * Returns the stored result if found, null otherwise.
   */
  get(key: string): TransferResult | null {
    const stored = this.store.get(key);

    if (!stored) {
      return null;
    }

    // Check TTL
    if (Date.now() > stored.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return stored.result;
  }

  /**
   * Store a result for an idempotency key.
   * Returns false if the key already exists (race condition).
   */
  set(key: string, result: TransferResult): boolean {
    // Check for existing key first
    if (this.store.has(key)) {
      const existing = this.store.get(key);
      if (existing && Date.now() <= existing.expiresAt) {
        return false; // Key already exists
      }
    }

    const now = Date.now();
    this.store.set(key, {
      key,
      result,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });

    return true;
  }

  /**
   * Attempt to acquire a lock on a key before processing.
   * Returns true if lock acquired, false if key already locked or completed.
   *
   * In production, use a distributed lock (Redis SETNX or database row lock)
   * with a short TTL (e.g., 30 seconds) to handle in-flight requests.
   */
  tryLock(key: string): boolean {
    if (this.store.has(key)) {
      return false;
    }

    // Mark as in-progress with a special sentinel value
    const now = Date.now();
    this.store.set(key, {
      key,
      result: {
        transferId: '',
        status: 'pending_approval', // sentinel for "in progress"
        fromAccount: '',
        toAccount: '',
        amount: 0,
        currency: '',
        memo: '',
        idempotencyKey: key,
        createdAt: now,
      },
      createdAt: now,
      expiresAt: now + 30_000, // 30 second lock timeout
    });

    return true;
  }

  /**
   * Release a lock without storing a result (on error).
   */
  releaseLock(key: string): void {
    const stored = this.store.get(key);
    if (stored && stored.result.transferId === '') {
      this.store.delete(key);
    }
  }

  /**
   * Get count of stored keys (for testing).
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all stored keys (for testing).
   */
  clear(): void {
    this.store.clear();
  }
}
