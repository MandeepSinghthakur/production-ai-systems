// Usage records. Written from a `finally`, so an aborted stream still
// produces a row — flagged `estimated` when the provider's trailing
// usage frame never arrived.

import type { LedgerRecord } from './types.ts';

const records: LedgerRecord[] = [];

export const ledger = {
  write(r: LedgerRecord): void {
    records.push(r);
    if (records.length > 50_000) records.shift(); // bounded, drops oldest
  },

  report(): Record<string, unknown> {
    const byTenant = new Map<string, { in: number; out: number; n: number }>();
    let estimated = 0;

    for (const r of records) {
      const cur = byTenant.get(r.tenant) ?? { in: 0, out: 0, n: 0 };
      cur.in += r.usage.inputTokens;
      cur.out += r.usage.outputTokens;
      cur.n += 1;
      byTenant.set(r.tenant, cur);
      if (r.usage.estimated) estimated += 1;
    }

    return {
      totalRecords: records.length,
      estimatedRecords: estimated,
      byTenant: Object.fromEntries(byTenant),
      byStop: records.reduce<Record<string, number>>((acc, r) => {
        acc[r.stop] = (acc[r.stop] ?? 0) + 1;
        return acc;
      }, {}),
    };
  },

  reset(): void {
    records.length = 0;
  },
};
