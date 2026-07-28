// Rate limiting and quota enforcement for multi-tenant AI platform.
// Provides per-tenant rate limits, concurrency limits, and token budgets.

import type {
  ModelTier,
  NoisyNeighborState,
  RateLimitWindow,
  TenantConfig,
  TenantQuotas,
  TenantRequest,
  TIER_COST_MULTIPLIER,
} from './types.ts';

/**
 * Result of a quota check.
 */
export interface QuotaCheckResult {
  allowed: boolean;
  reason: string | null;
  quotaType: 'rate' | 'concurrency' | 'token' | 'storage' | null;
  remaining: number;
  resetAt: number | null;
}

/**
 * QuotaManager enforces per-tenant resource quotas.
 *
 * Quotas are checked in priority order:
 * 1. Tenant status (is the tenant active?)
 * 2. Rate limits (requests per second/minute)
 * 3. Concurrency limits (in-flight requests)
 * 4. Token budgets (daily/monthly)
 * 5. Storage limits
 *
 * This order reflects the cost of each check and the likelihood
 * of rejection. Rate limits are cheapest to check and most likely
 * to reject during bursts.
 */
export class QuotaManager {
  // Rate limit windows by tenant
  private secondWindows: Map<string, RateLimitWindow>;
  private minuteWindows: Map<string, RateLimitWindow>;

  // Concurrency tracking
  private inFlightRequests: Map<string, Set<string>>;

  // Token usage tracking
  private dailyTokens: Map<string, { date: string; tokens: number }>;
  private monthlyTokens: Map<string, { month: string; tokens: number }>;

  // Storage tracking
  private storageUsed: Map<string, number>;

  // Rejection counters for metrics
  private rejections: Map<string, {
    rate: number;
    concurrency: number;
    token: number;
    storage: number;
  }>;

  constructor() {
    this.secondWindows = new Map();
    this.minuteWindows = new Map();
    this.inFlightRequests = new Map();
    this.dailyTokens = new Map();
    this.monthlyTokens = new Map();
    this.storageUsed = new Map();
    this.rejections = new Map();
  }

  /**
   * Check all quotas for a request. Returns first failing quota.
   */
  checkQuotas(
    tenantConfig: TenantConfig,
    estimatedTokens: number
  ): QuotaCheckResult {
    const tenantId = tenantConfig.id;
    const quotas = tenantConfig.quotas;

    // 1. Check tenant status
    if (tenantConfig.status !== 'active') {
      return {
        allowed: false,
        reason: `tenant_${tenantConfig.status}`,
        quotaType: null,
        remaining: 0,
        resetAt: null,
      };
    }

    // 2. Check rate limit (requests per second)
    const secondWindow = this.getOrCreateWindow(
      tenantId,
      this.secondWindows,
      1000
    );
    if (secondWindow.requestCount >= quotas.requestsPerSecond) {
      this.recordRejection(tenantId, 'rate');
      return {
        allowed: false,
        reason: 'rate_limit_second',
        quotaType: 'rate',
        remaining: 0,
        resetAt: secondWindow.windowEnd,
      };
    }

    // 3. Check rate limit (requests per minute)
    const minuteWindow = this.getOrCreateWindow(
      tenantId,
      this.minuteWindows,
      60_000
    );
    if (minuteWindow.requestCount >= quotas.requestsPerMinute) {
      this.recordRejection(tenantId, 'rate');
      return {
        allowed: false,
        reason: 'rate_limit_minute',
        quotaType: 'rate',
        remaining: quotas.requestsPerMinute - minuteWindow.requestCount,
        resetAt: minuteWindow.windowEnd,
      };
    }

    // 4. Check concurrency limit
    const inFlight = this.inFlightRequests.get(tenantId)?.size ?? 0;
    if (inFlight >= quotas.maxConcurrentRequests) {
      this.recordRejection(tenantId, 'concurrency');
      return {
        allowed: false,
        reason: 'concurrency_limit',
        quotaType: 'concurrency',
        remaining: 0,
        resetAt: null, // No reset time - depends on request completion
      };
    }

    // 5. Check daily token budget
    const today = new Date().toISOString().split('T')[0];
    const dailyUsage = this.dailyTokens.get(tenantId);
    const dailyUsed =
      dailyUsage?.date === today ? dailyUsage.tokens : 0;
    if (dailyUsed + estimatedTokens > quotas.tokensPerDay) {
      this.recordRejection(tenantId, 'token');
      return {
        allowed: false,
        reason: 'daily_token_limit',
        quotaType: 'token',
        remaining: Math.max(0, quotas.tokensPerDay - dailyUsed),
        resetAt: this.endOfDay(),
      };
    }

    // 6. Check monthly token budget
    const month = today.slice(0, 7); // YYYY-MM
    const monthlyUsage = this.monthlyTokens.get(tenantId);
    const monthlyUsed =
      monthlyUsage?.month === month ? monthlyUsage.tokens : 0;
    if (monthlyUsed + estimatedTokens > quotas.tokensPerMonth) {
      this.recordRejection(tenantId, 'token');
      return {
        allowed: false,
        reason: 'monthly_token_limit',
        quotaType: 'token',
        remaining: Math.max(0, quotas.tokensPerMonth - monthlyUsed),
        resetAt: this.endOfMonth(),
      };
    }

    // All checks passed
    return {
      allowed: true,
      reason: null,
      quotaType: null,
      remaining: Math.min(
        quotas.requestsPerSecond - secondWindow.requestCount - 1,
        quotas.tokensPerDay - dailyUsed - estimatedTokens
      ),
      resetAt: null,
    };
  }

  /**
   * Reserve quota for a request. Call after checkQuotas returns allowed.
   */
  reserve(tenantId: string, requestId: string): void {
    // Increment rate limit counters
    const secondWindow = this.secondWindows.get(tenantId);
    if (secondWindow) {
      secondWindow.requestCount++;
    }

    const minuteWindow = this.minuteWindows.get(tenantId);
    if (minuteWindow) {
      minuteWindow.requestCount++;
    }

    // Track in-flight request
    if (!this.inFlightRequests.has(tenantId)) {
      this.inFlightRequests.set(tenantId, new Set());
    }
    this.inFlightRequests.get(tenantId)!.add(requestId);
  }

  /**
   * Release a reserved request (on completion or failure).
   */
  release(
    tenantId: string,
    requestId: string,
    actualTokens: number
  ): void {
    // Remove from in-flight
    this.inFlightRequests.get(tenantId)?.delete(requestId);

    // Record token usage
    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    const dailyUsage = this.dailyTokens.get(tenantId);
    if (!dailyUsage || dailyUsage.date !== today) {
      this.dailyTokens.set(tenantId, { date: today, tokens: actualTokens });
    } else {
      dailyUsage.tokens += actualTokens;
    }

    const monthlyUsage = this.monthlyTokens.get(tenantId);
    if (!monthlyUsage || monthlyUsage.month !== month) {
      this.monthlyTokens.set(tenantId, { month, tokens: actualTokens });
    } else {
      monthlyUsage.tokens += actualTokens;
    }
  }

  /**
   * Get current concurrency for a tenant.
   */
  getConcurrency(tenantId: string): number {
    return this.inFlightRequests.get(tenantId)?.size ?? 0;
  }

  /**
   * Get current rate (requests in current second window).
   */
  getCurrentRate(tenantId: string): number {
    this.cleanupWindow(tenantId, this.secondWindows, 1000);
    return this.secondWindows.get(tenantId)?.requestCount ?? 0;
  }

  /**
   * Get daily token usage.
   */
  getDailyUsage(tenantId: string): number {
    const today = new Date().toISOString().split('T')[0];
    const usage = this.dailyTokens.get(tenantId);
    return usage?.date === today ? usage.tokens : 0;
  }

  /**
   * Get monthly token usage.
   */
  getMonthlyUsage(tenantId: string): number {
    const month = new Date().toISOString().slice(0, 7);
    const usage = this.monthlyTokens.get(tenantId);
    return usage?.month === month ? usage.tokens : 0;
  }

  /**
   * Get rejection stats for a tenant.
   */
  getRejections(tenantId: string): {
    rate: number;
    concurrency: number;
    token: number;
    storage: number;
  } {
    return this.rejections.get(tenantId) ?? {
      rate: 0,
      concurrency: 0,
      token: 0,
      storage: 0,
    };
  }

  /**
   * Update storage used for a tenant.
   */
  setStorageUsed(tenantId: string, bytes: number): void {
    this.storageUsed.set(tenantId, bytes);
  }

  /**
   * Check if tenant would exceed storage limit.
   */
  checkStorageLimit(
    tenantId: string,
    quotas: TenantQuotas,
    additionalBytes: number
  ): boolean {
    const current = this.storageUsed.get(tenantId) ?? 0;
    return current + additionalBytes <= quotas.maxStorageBytes;
  }

  private getOrCreateWindow(
    tenantId: string,
    windowMap: Map<string, RateLimitWindow>,
    windowMs: number
  ): RateLimitWindow {
    this.cleanupWindow(tenantId, windowMap, windowMs);

    let window = windowMap.get(tenantId);
    if (!window) {
      window = {
        tenantId,
        windowStart: Date.now(),
        windowEnd: Date.now() + windowMs,
        requestCount: 0,
        tokenCount: 0,
      };
      windowMap.set(tenantId, window);
    }

    return window;
  }

  private cleanupWindow(
    tenantId: string,
    windowMap: Map<string, RateLimitWindow>,
    windowMs: number
  ): void {
    const window = windowMap.get(tenantId);
    if (window && Date.now() >= window.windowEnd) {
      // Window expired, create new one
      windowMap.set(tenantId, {
        tenantId,
        windowStart: Date.now(),
        windowEnd: Date.now() + windowMs,
        requestCount: 0,
        tokenCount: 0,
      });
    }
  }

  private recordRejection(
    tenantId: string,
    type: 'rate' | 'concurrency' | 'token' | 'storage'
  ): void {
    if (!this.rejections.has(tenantId)) {
      this.rejections.set(tenantId, {
        rate: 0,
        concurrency: 0,
        token: 0,
        storage: 0,
      });
    }
    this.rejections.get(tenantId)![type]++;
  }

  private endOfDay(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    return tomorrow.getTime();
  }

  private endOfMonth(): number {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.getTime();
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.secondWindows.clear();
    this.minuteWindows.clear();
    this.inFlightRequests.clear();
    this.dailyTokens.clear();
    this.monthlyTokens.clear();
    this.storageUsed.clear();
    this.rejections.clear();
  }
}

/**
 * NoisyNeighborDetector identifies tenants consuming disproportionate
 * resources and applies throttling to protect other tenants.
 *
 * A noisy neighbor is detected when a tenant's resource consumption
 * score exceeds a threshold relative to their fair share.
 */
export class NoisyNeighborDetector {
  private tenantScores: Map<string, NoisyNeighborState>;
  private windowMs: number;
  private throttleDurationMs: number;
  private threshold: number; // Score threshold for throttling

  constructor(options: {
    windowMs?: number;
    throttleDurationMs?: number;
    threshold?: number;
  } = {}) {
    this.tenantScores = new Map();
    this.windowMs = options.windowMs ?? 60_000; // 1 minute window
    this.throttleDurationMs = options.throttleDurationMs ?? 30_000; // 30s throttle
    this.threshold = options.threshold ?? 80; // Score 0-100
  }

  /**
   * Record resource usage for a tenant.
   * Returns true if the tenant is being throttled.
   */
  recordUsage(
    tenantId: string,
    resourceUnits: number,
    totalTenants: number
  ): boolean {
    const now = Date.now();
    let state = this.tenantScores.get(tenantId);

    // Check if currently throttled
    if (state?.isThrottled) {
      if (now < (state.throttleUntil ?? 0)) {
        return true; // Still throttled
      }
      // Throttle expired, reset
      state.isThrottled = false;
      state.throttleUntil = null;
    }

    // Initialize or reset state if window expired
    if (!state || now - state.windowStart > this.windowMs) {
      state = {
        tenantId,
        windowStart: now,
        resourceScore: 0,
        isThrottled: false,
        throttleUntil: null,
      };
      this.tenantScores.set(tenantId, state);
    }

    // Simple accumulating score model:
    // Each unit of resource usage adds to the score.
    // When score exceeds threshold, tenant is throttled.
    // This rewards fair usage and penalizes heavy usage.
    state.resourceScore += resourceUnits;

    // Check if threshold exceeded
    if (state.resourceScore >= this.threshold) {
      state.isThrottled = true;
      state.throttleUntil = now + this.throttleDurationMs;
      return true;
    }

    return false;
  }

  /**
   * Check if a tenant is currently throttled.
   */
  isThrottled(tenantId: string): boolean {
    const state = this.tenantScores.get(tenantId);
    if (!state || !state.isThrottled) return false;

    if (Date.now() >= (state.throttleUntil ?? 0)) {
      state.isThrottled = false;
      state.throttleUntil = null;
      return false;
    }

    return true;
  }

  /**
   * Get the resource score for a tenant.
   */
  getScore(tenantId: string): number {
    return this.tenantScores.get(tenantId)?.resourceScore ?? 0;
  }

  /**
   * Get state for a tenant.
   */
  getState(tenantId: string): NoisyNeighborState | undefined {
    return this.tenantScores.get(tenantId);
  }

  /**
   * Get all throttled tenants.
   */
  getThrottledTenants(): string[] {
    const throttled: string[] = [];
    for (const [tenantId, state] of this.tenantScores) {
      if (state.isThrottled && Date.now() < (state.throttleUntil ?? 0)) {
        throttled.push(tenantId);
      }
    }
    return throttled;
  }

  /**
   * Clear all state (for testing).
   */
  clear(): void {
    this.tenantScores.clear();
  }
}
