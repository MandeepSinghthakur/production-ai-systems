// Multi-tenant cost allocation and attribution.
//
// Tracks spending by tenant, workload, and model tier.
// Enables cost attribution for chargeback and analysis.

import type {
  Attribution,
  ModelTier,
  SpendingRecord,
  TIER_COST_MULTIPLIER,
} from './types.ts';

export class CostAllocator {
  private records: SpendingRecord[];
  private tierCosts: Record<ModelTier, number>;

  constructor(tierCosts: Record<ModelTier, number>) {
    this.records = [];
    this.tierCosts = tierCosts;
  }

  /**
   * Record a spending event.
   */
  record(
    tenant: string,
    workload: string,
    tier: ModelTier,
    tokens: number
  ): SpendingRecord {
    const costUnits = tokens * this.tierCosts[tier];
    const entry: SpendingRecord = {
      timestamp: Date.now(),
      tenant,
      workload,
      tier,
      tokens,
      costUnits,
    };
    this.records.push(entry);
    return entry;
  }

  /**
   * Get attribution breakdown by all dimensions.
   */
  getAttribution(): Attribution {
    const byTenant: Record<string, { tokens: number; costUnits: number }> = {};
    const byWorkload: Record<string, { tokens: number; costUnits: number }> = {};
    const byTier: Record<ModelTier, { tokens: number; costUnits: number }> = {
      frontier: { tokens: 0, costUnits: 0 },
      mid: { tokens: 0, costUnits: 0 },
      small: { tokens: 0, costUnits: 0 },
    };

    for (const record of this.records) {
      // By tenant
      if (!byTenant[record.tenant]) {
        byTenant[record.tenant] = { tokens: 0, costUnits: 0 };
      }
      byTenant[record.tenant].tokens += record.tokens;
      byTenant[record.tenant].costUnits += record.costUnits;

      // By workload
      if (!byWorkload[record.workload]) {
        byWorkload[record.workload] = { tokens: 0, costUnits: 0 };
      }
      byWorkload[record.workload].tokens += record.tokens;
      byWorkload[record.workload].costUnits += record.costUnits;

      // By tier
      byTier[record.tier].tokens += record.tokens;
      byTier[record.tier].costUnits += record.costUnits;
    }

    return { byTenant, byWorkload, byTier };
  }

  /**
   * Get total tokens consumed.
   */
  getTotalTokens(): number {
    return this.records.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get total cost units.
   */
  getTotalCostUnits(): number {
    return this.records.reduce((sum, r) => sum + r.costUnits, 0);
  }

  /**
   * Get all records.
   */
  getRecords(): SpendingRecord[] {
    return [...this.records];
  }

  /**
   * Reset all records (for testing).
   */
  reset(): void {
    this.records = [];
  }
}
