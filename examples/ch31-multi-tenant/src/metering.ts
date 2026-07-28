// Usage metering for multi-tenant AI platform.
// Tracks and aggregates resource consumption for billing and analytics.

import type {
  ModelTier,
  UsageRecord,
  UsageSummary,
  TenantConfig,
  TIER_COST_MULTIPLIER,
} from './types.ts';

/**
 * Generates a unique usage record ID.
 */
function generateRecordId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `usage_${timestamp}_${random}`;
}

/**
 * UsageMeter tracks per-request usage and aggregates for billing.
 *
 * Key design decisions:
 * - Every request is recorded, even failures (they consume resources)
 * - Records are immutable after creation
 * - Aggregations are computed on demand or by periodic jobs
 */
export class UsageMeter {
  private records: UsageRecord[];
  private recordsByTenant: Map<string, UsageRecord[]>;
  private tierCosts: Record<ModelTier, number>;

  constructor(tierCosts: Record<ModelTier, number>) {
    this.records = [];
    this.recordsByTenant = new Map();
    this.tierCosts = tierCosts;
  }

  /**
   * Record usage for a completed request.
   */
  record(
    tenantId: string,
    requestId: string,
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
    durationMs: number
  ): UsageRecord {
    const record: UsageRecord = {
      id: generateRecordId(),
      tenantId,
      timestamp: Date.now(),
      tier,
      inputTokens,
      outputTokens,
      durationMs,
      requestId,
    };

    this.records.push(record);

    // Index by tenant for efficient queries
    if (!this.recordsByTenant.has(tenantId)) {
      this.recordsByTenant.set(tenantId, []);
    }
    this.recordsByTenant.get(tenantId)!.push(record);

    return record;
  }

  /**
   * Get all records for a tenant in a time range.
   */
  getRecords(
    tenantId: string,
    startTime?: number,
    endTime?: number
  ): UsageRecord[] {
    const records = this.recordsByTenant.get(tenantId) ?? [];

    if (!startTime && !endTime) {
      return [...records];
    }

    return records.filter((r) => {
      if (startTime && r.timestamp < startTime) return false;
      if (endTime && r.timestamp > endTime) return false;
      return true;
    });
  }

  /**
   * Compute usage summary for a tenant in a time period.
   */
  summarize(
    tenantId: string,
    periodStart: number,
    periodEnd: number
  ): UsageSummary {
    const records = this.getRecords(tenantId, periodStart, periodEnd);

    const tokensByTier: Record<ModelTier, number> = {
      frontier: 0,
      mid: 0,
      small: 0,
    };

    let totalTokens = 0;
    let totalDurationMs = 0;
    let maxConcurrentSeen = 0;

    // Track concurrent requests
    const activeRequests: Array<{ start: number; end: number }> = [];

    for (const record of records) {
      const tokens = record.inputTokens + record.outputTokens;
      totalTokens += tokens;
      tokensByTier[record.tier] += tokens;
      totalDurationMs += record.durationMs;

      // Track for peak concurrency
      activeRequests.push({
        start: record.timestamp - record.durationMs,
        end: record.timestamp,
      });
    }

    // Calculate peak concurrency
    // Sort by start time and scan for overlaps
    activeRequests.sort((a, b) => a.start - b.start);
    for (let i = 0; i < activeRequests.length; i++) {
      let concurrent = 1;
      for (let j = 0; j < i; j++) {
        if (activeRequests[j].end > activeRequests[i].start) {
          concurrent++;
        }
      }
      maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrent);
    }

    return {
      tenantId,
      periodStart,
      periodEnd,
      totalTokens,
      tokensByTier,
      totalRequests: records.length,
      totalDurationMs,
      peakConcurrency: maxConcurrentSeen,
    };
  }

  /**
   * Compute cost for a usage summary.
   */
  computeCost(summary: UsageSummary): number {
    let cost = 0;
    for (const [tier, tokens] of Object.entries(summary.tokensByTier)) {
      cost += tokens * this.tierCosts[tier as ModelTier];
    }
    return cost;
  }

  /**
   * Get total tokens used by a tenant today.
   */
  getTodayUsage(tenantId: string): number {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    const records = this.getRecords(tenantId, startOfDay);
    return records.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0
    );
  }

  /**
   * Get total tokens used by a tenant this month.
   */
  getMonthUsage(tenantId: string): number {
    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    ).getTime();

    const records = this.getRecords(tenantId, startOfMonth);
    return records.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0
    );
  }

  /**
   * Get request count for a tenant in a time range.
   */
  getRequestCount(
    tenantId: string,
    startTime?: number,
    endTime?: number
  ): number {
    return this.getRecords(tenantId, startTime, endTime).length;
  }

  /**
   * Get average request duration for a tenant.
   */
  getAverageDuration(tenantId: string): number {
    const records = this.recordsByTenant.get(tenantId) ?? [];
    if (records.length === 0) return 0;

    const total = records.reduce((sum, r) => sum + r.durationMs, 0);
    return total / records.length;
  }

  /**
   * Get usage breakdown by tier for a tenant.
   */
  getTierBreakdown(
    tenantId: string
  ): Record<ModelTier, { tokens: number; requests: number; cost: number }> {
    const records = this.recordsByTenant.get(tenantId) ?? [];

    const breakdown: Record<
      ModelTier,
      { tokens: number; requests: number; cost: number }
    > = {
      frontier: { tokens: 0, requests: 0, cost: 0 },
      mid: { tokens: 0, requests: 0, cost: 0 },
      small: { tokens: 0, requests: 0, cost: 0 },
    };

    for (const record of records) {
      const tokens = record.inputTokens + record.outputTokens;
      breakdown[record.tier].tokens += tokens;
      breakdown[record.tier].requests++;
      breakdown[record.tier].cost += tokens * this.tierCosts[record.tier];
    }

    return breakdown;
  }

  /**
   * Get total record count.
   */
  getTotalRecords(): number {
    return this.records.length;
  }

  /**
   * Get record count by tenant.
   */
  getRecordCountByTenant(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [tenantId, records] of this.recordsByTenant) {
      counts.set(tenantId, records.length);
    }
    return counts;
  }

  /**
   * Clear all records (for testing).
   */
  clear(): void {
    this.records = [];
    this.recordsByTenant.clear();
  }
}

/**
 * UsageAggregator computes periodic rollups for reporting.
 *
 * In production this would be a scheduled job that:
 * 1. Reads from the raw usage log
 * 2. Computes hourly/daily/monthly rollups
 * 3. Writes to a time-series store for dashboards
 */
export class UsageAggregator {
  private hourlyRollups: Map<string, Map<string, UsageSummary>>;
  private dailyRollups: Map<string, Map<string, UsageSummary>>;

  constructor() {
    this.hourlyRollups = new Map();
    this.dailyRollups = new Map();
  }

  /**
   * Compute hourly rollup for a tenant.
   */
  computeHourlyRollup(
    tenantId: string,
    hour: Date,
    meter: UsageMeter
  ): UsageSummary {
    const periodStart = new Date(
      hour.getFullYear(),
      hour.getMonth(),
      hour.getDate(),
      hour.getHours()
    ).getTime();
    const periodEnd = periodStart + 3600_000; // 1 hour

    const summary = meter.summarize(tenantId, periodStart, periodEnd);

    // Store the rollup
    const hourKey = new Date(periodStart).toISOString();
    if (!this.hourlyRollups.has(tenantId)) {
      this.hourlyRollups.set(tenantId, new Map());
    }
    this.hourlyRollups.get(tenantId)!.set(hourKey, summary);

    return summary;
  }

  /**
   * Compute daily rollup for a tenant.
   */
  computeDailyRollup(
    tenantId: string,
    day: Date,
    meter: UsageMeter
  ): UsageSummary {
    const periodStart = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate()
    ).getTime();
    const periodEnd = periodStart + 86400_000; // 24 hours

    const summary = meter.summarize(tenantId, periodStart, periodEnd);

    // Store the rollup
    const dayKey = new Date(periodStart).toISOString().split('T')[0];
    if (!this.dailyRollups.has(tenantId)) {
      this.dailyRollups.set(tenantId, new Map());
    }
    this.dailyRollups.get(tenantId)!.set(dayKey, summary);

    return summary;
  }

  /**
   * Get hourly rollups for a tenant.
   */
  getHourlyRollups(tenantId: string): Map<string, UsageSummary> | undefined {
    return this.hourlyRollups.get(tenantId);
  }

  /**
   * Get daily rollups for a tenant.
   */
  getDailyRollups(tenantId: string): Map<string, UsageSummary> | undefined {
    return this.dailyRollups.get(tenantId);
  }

  /**
   * Clear all rollups (for testing).
   */
  clear(): void {
    this.hourlyRollups.clear();
    this.dailyRollups.clear();
  }
}
