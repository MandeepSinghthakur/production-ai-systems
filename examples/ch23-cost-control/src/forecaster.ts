// Budget forecasting: project when a tenant's budget will be exhausted
// based on observed burn rate.
//
// The key insight: track token consumption over time windows, compute
// burn rate, project exhaustion. Alert when exhaustion is imminent.

import type { BudgetForecast, SpendingRecord } from './types.ts';

export class BudgetForecaster {
  private records: SpendingRecord[];
  private windowMs: number;
  private urgencyThresholdSeconds: number;

  constructor(options?: {
    windowMs?: number;
    urgencyThresholdSeconds?: number;
  }) {
    this.records = [];
    // Default: 60 second window for burn rate calculation
    this.windowMs = options?.windowMs ?? 60_000;
    // Default: alert if exhaustion within 5 minutes
    this.urgencyThresholdSeconds = options?.urgencyThresholdSeconds ?? 300;
  }

  /**
   * Record a spending event.
   */
  record(entry: SpendingRecord): void {
    this.records.push(entry);
  }

  /**
   * Calculate burn rate for a tenant in tokens per second.
   * Uses a sliding window of recent spending.
   */
  getBurnRate(tenant: string, now?: number): number {
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - this.windowMs;

    const tenantRecords = this.records.filter(
      (r) => r.tenant === tenant && r.timestamp >= windowStart
    );

    if (tenantRecords.length === 0) {
      return 0;
    }

    const totalTokens = tenantRecords.reduce((sum, r) => sum + r.tokens, 0);
    const windowSeconds = this.windowMs / 1000;

    return totalTokens / windowSeconds;
  }

  /**
   * Forecast budget exhaustion for a tenant.
   */
  forecast(
    tenant: string,
    currentSpent: number,
    tokenLimit: number,
    now?: number
  ): BudgetForecast {
    const currentTime = now ?? Date.now();
    const burnRate = this.getBurnRate(tenant, currentTime);
    const remainingTokens = tokenLimit - currentSpent;

    let exhaustionTimestamp: number | null = null;
    let secondsUntilExhaustion: number | null = null;

    if (burnRate > 0 && remainingTokens > 0) {
      secondsUntilExhaustion = remainingTokens / burnRate;
      exhaustionTimestamp = currentTime + secondsUntilExhaustion * 1000;
    } else if (remainingTokens <= 0) {
      // Already exhausted
      secondsUntilExhaustion = 0;
      exhaustionTimestamp = currentTime;
    }
    // If burnRate is 0 and tokens remain, never exhausts (null)

    const isUrgent =
      secondsUntilExhaustion !== null &&
      secondsUntilExhaustion <= this.urgencyThresholdSeconds;

    return {
      tenant,
      currentSpent,
      tokenLimit,
      burnRatePerSecond: burnRate,
      remainingTokens,
      exhaustionTimestamp,
      secondsUntilExhaustion,
      isUrgent,
    };
  }

  /**
   * Get all records (for testing/debugging).
   */
  getRecords(): SpendingRecord[] {
    return [...this.records];
  }

  /**
   * Clear all records (for testing).
   */
  reset(): void {
    this.records = [];
  }
}
