// Token-based rate limiting for LLM workloads.
//
// The key difference from request-based rate limiting: two requests to
// the same endpoint can differ in cost by three orders of magnitude.
// A 100-token classification and a 4000-token summary are not the same
// request, and should not count the same against the budget.
//
// This implements the sliding window log algorithm, which Redis can
// execute atomically with MULTI/EXEC or a Lua script.

import type {
  RateLimitResult,
  TokenBudgetConfig,
} from './types.ts';

interface TokenRecord {
  timestamp: number;
  tokens: number;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  tokensPerWindow: 100_000,
  windowMs: 60_000, // 1 minute
  burstMultiplier: 1.5,
};

export class TokenRateLimiter {
  private config: TokenBudgetConfig;
  private tenantRecords: Map<string, TokenRecord[]>;
  private effectiveBudget: number;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tenantRecords = new Map();
    this.effectiveBudget =
      this.config.tokensPerWindow * this.config.burstMultiplier;
  }

  /**
   * Check if a request with the given token count is allowed.
   * Does NOT consume tokens - use consume() after the request completes.
   */
  check(tenantId: string, estimatedTokens: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create records for this tenant
    let records = this.tenantRecords.get(tenantId);
    if (!records) {
      records = [];
      this.tenantRecords.set(tenantId, records);
    }

    // Prune expired records
    const validRecords = records.filter((r) => r.timestamp > windowStart);
    this.tenantRecords.set(tenantId, validRecords);

    // Sum tokens in current window
    const tokensUsed = validRecords.reduce((sum, r) => sum + r.tokens, 0);
    const tokensRemaining = Math.max(0, this.effectiveBudget - tokensUsed);

    // Check if request would fit
    if (estimatedTokens > tokensRemaining) {
      // Find when the window will have enough room
      let windowResetMs = this.config.windowMs;
      let accumulated = 0;
      for (const record of validRecords) {
        accumulated += record.tokens;
        if (tokensUsed - accumulated + estimatedTokens <= this.effectiveBudget) {
          windowResetMs = record.timestamp + this.config.windowMs - now;
          break;
        }
      }

      return {
        allowed: false,
        tokensRemaining,
        tokensRequested: estimatedTokens,
        windowResetMs: Math.max(0, windowResetMs),
        reason: 'token_budget_exhausted',
      };
    }

    return {
      allowed: true,
      tokensRemaining: tokensRemaining - estimatedTokens,
      tokensRequested: estimatedTokens,
      windowResetMs: this.config.windowMs,
    };
  }

  /**
   * Consume tokens after a request completes.
   * Use the actual token count, not the estimate.
   */
  consume(tenantId: string, actualTokens: number): void {
    let records = this.tenantRecords.get(tenantId);
    if (!records) {
      records = [];
      this.tenantRecords.set(tenantId, records);
    }

    records.push({
      timestamp: Date.now(),
      tokens: actualTokens,
    });
  }

  /**
   * Reserve tokens at admission time.
   * Returns true if reservation succeeded.
   */
  reserve(tenantId: string, estimatedTokens: number): boolean {
    const result = this.check(tenantId, estimatedTokens);
    if (result.allowed) {
      this.consume(tenantId, estimatedTokens);
      return true;
    }
    return false;
  }

  /**
   * Reconcile a reservation with actual usage.
   * Call this when the request completes to adjust the consumed amount.
   */
  reconcile(
    tenantId: string,
    estimatedTokens: number,
    actualTokens: number
  ): void {
    const records = this.tenantRecords.get(tenantId);
    if (!records || records.length === 0) return;

    // Find the most recent record matching the estimate and adjust it
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].tokens === estimatedTokens) {
        records[i].tokens = actualTokens;
        break;
      }
    }
  }

  /**
   * Get current token usage for a tenant.
   */
  getUsage(tenantId: string): { used: number; remaining: number; limit: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const records = this.tenantRecords.get(tenantId) ?? [];
    const validRecords = records.filter((r) => r.timestamp > windowStart);
    const tokensUsed = validRecords.reduce((sum, r) => sum + r.tokens, 0);

    return {
      used: tokensUsed,
      remaining: Math.max(0, this.effectiveBudget - tokensUsed),
      limit: this.effectiveBudget,
    };
  }

  /**
   * Clear all records for testing.
   */
  clear(): void {
    this.tenantRecords.clear();
  }

  /**
   * Get config for inspection.
   */
  getConfig(): TokenBudgetConfig {
    return { ...this.config };
  }
}

/**
 * Request-based rate limiter for comparison.
 * Shows why request counting fails for LLM workloads.
 */
export class RequestRateLimiter {
  private requestsPerWindow: number;
  private windowMs: number;
  private tenantRecords: Map<string, number[]>;

  constructor(requestsPerWindow: number = 100, windowMs: number = 60_000) {
    this.requestsPerWindow = requestsPerWindow;
    this.windowMs = windowMs;
    this.tenantRecords = new Map();
  }

  check(tenantId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let records = this.tenantRecords.get(tenantId);
    if (!records) {
      records = [];
      this.tenantRecords.set(tenantId, records);
    }

    // Prune expired
    const validRecords = records.filter((t) => t > windowStart);
    this.tenantRecords.set(tenantId, validRecords);

    const remaining = this.requestsPerWindow - validRecords.length;

    if (remaining <= 0) {
      return { allowed: false, remaining: 0 };
    }

    validRecords.push(now);
    return { allowed: true, remaining: remaining - 1 };
  }

  clear(): void {
    this.tenantRecords.clear();
  }
}
