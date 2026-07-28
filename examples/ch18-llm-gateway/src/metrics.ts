// Deliberately tiny. In production this is OpenTelemetry (Chapter 9);
// here it is enough to make the lab's claims checkable.

type Hist = { count: number; sum: number; values: number[] };

const hists = new Map<string, Hist>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round(sorted[i]);
}

export const metrics = {
  observe(name: string, ms: number): void {
    let h = hists.get(name);
    if (!h) {
      h = { count: 0, sum: 0, values: [] };
      hists.set(name, h);
    }
    h.count += 1;
    h.sum += ms;
    h.values.push(ms);
    if (h.values.length > 5000) h.values.shift();
  },

  inc(name: string, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },

  gauge(name: string, v: number): void {
    gauges.set(name, v);
  },

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of counters) out[k] = v;
    for (const [k, v] of gauges) out[k] = v;
    for (const [k, h] of hists) {
      const sorted = [...h.values].sort((a, b) => a - b);
      out[k] = {
        count: h.count,
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
      };
    }
    const gw = (counters.get('gateway_requests') ?? 0) || 1;
    out.amplification =
      Math.round(((counters.get('provider_requests') ?? 0) / gw) * 100) / 100;
    return out;
  },

  reset(): void {
    hists.clear();
    counters.clear();
    gauges.clear();
  },
};
