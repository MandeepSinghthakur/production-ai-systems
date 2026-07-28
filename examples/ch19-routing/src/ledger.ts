// Records target per request. The "13-day archaeology" problem from Chapter 19:
// without target labels, debugging a quality regression requires correlating
// timestamps across systems.

import type { LedgerRecord } from './types.ts';

const records: LedgerRecord[] = [];

export const ledger = {
  write(r: LedgerRecord): void {
    records.push(r);
    if (records.length > 50_000) records.shift(); // bounded, drops oldest
  },

  // Query with target label - one query, immediate answer
  queryByTarget(target: string): LedgerRecord[] {
    return records.filter((r) => r.target === target);
  },

  // Query without target label - requires timestamp correlation
  // This simulates the "archaeology" problem: you know WHEN quality dropped,
  // but not WHICH provider was serving traffic at that time.
  queryByTimeRange(startMs: number, endMs: number): LedgerRecord[] {
    return records.filter((r) => r.at >= startMs && r.at <= endMs);
  },

  // Count records that would require timestamp correlation to attribute
  countRecordsWithoutTargetQuery(): {
    total: number;
    uniqueTargets: number;
    requiresCorrelation: boolean;
  } {
    const targets = new Set(records.map((r) => r.target));
    return {
      total: records.length,
      uniqueTargets: targets.size,
      // If there's more than one target, you need the label to filter
      requiresCorrelation: targets.size > 1,
    };
  },

  report(): Record<string, unknown> {
    const byTarget = new Map<string, { count: number; successes: number; schemaValid: number }>();

    for (const r of records) {
      const cur = byTarget.get(r.target) ?? { count: 0, successes: 0, schemaValid: 0 };
      cur.count += 1;
      if (r.success) cur.successes += 1;
      if (r.schemaValid) cur.schemaValid += 1;
      byTarget.set(r.target, cur);
    }

    return {
      totalRecords: records.length,
      byTarget: Object.fromEntries(byTarget),
      // Field population breakdown
      fieldPopulation: {
        inCoverage: records.filter((r) => r.fieldPopulation.effective_date_in_coverage).length,
        total: records.length,
      },
    };
  },

  getRecords(): LedgerRecord[] {
    return [...records];
  },

  reset(): void {
    records.length = 0;
  },
};
