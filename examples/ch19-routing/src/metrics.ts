// Per-target field population tracking. The key insight from Chapter 19:
// availability metrics stay green while output quality degrades silently.

import type { FieldPopulationMetrics } from './types.ts';

const counters = new Map<string, number>();
const gauges = new Map<string, number>();

// Per-target field population metrics
const fieldPopulationByTarget = new Map<string, FieldPopulationMetrics>();

// Global tracking mode - when false, per-target breakdown is not available
let perTargetTrackingEnabled = false;

export const metrics = {
  inc(name: string, by = 1): void {
    counters.set(name, (counters.get(name) ?? 0) + by);
  },

  gauge(name: string, v: number): void {
    gauges.set(name, v);
  },

  recordFieldPopulation(target: string, effectiveDateInCoverage: boolean): void {
    // Always record global
    this.inc('total_extractions');
    if (effectiveDateInCoverage) {
      this.inc('effective_date_populated');
    }

    // Record per-target if enabled
    if (perTargetTrackingEnabled) {
      const m = fieldPopulationByTarget.get(target) ?? { total: 0, effective_date_populated: 0 };
      m.total += 1;
      if (effectiveDateInCoverage) {
        m.effective_date_populated += 1;
      }
      fieldPopulationByTarget.set(target, m);
    }
  },

  enablePerTargetTracking(): void {
    perTargetTrackingEnabled = true;
  },

  disablePerTargetTracking(): void {
    perTargetTrackingEnabled = false;
  },

  isPerTargetTrackingEnabled(): boolean {
    return perTargetTrackingEnabled;
  },

  getFieldPopulationRate(): number {
    const total = counters.get('total_extractions') ?? 0;
    const populated = counters.get('effective_date_populated') ?? 0;
    return total === 0 ? 1.0 : populated / total;
  },

  getFieldPopulationRateByTarget(target: string): number {
    const m = fieldPopulationByTarget.get(target);
    if (!m || m.total === 0) return 1.0;
    return m.effective_date_populated / m.total;
  },

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of counters) out[k] = v;
    for (const [k, v] of gauges) out[k] = v;

    out.field_population_rate = this.getFieldPopulationRate();
    out.per_target_tracking_enabled = perTargetTrackingEnabled;

    if (perTargetTrackingEnabled) {
      const byTarget: Record<string, unknown> = {};
      for (const [target, m] of fieldPopulationByTarget) {
        byTarget[target] = {
          total: m.total,
          effective_date_populated: m.effective_date_populated,
          rate: m.total === 0 ? 1.0 : m.effective_date_populated / m.total,
        };
      }
      out.field_population_by_target = byTarget;
    }

    return out;
  },

  reset(): void {
    counters.clear();
    gauges.clear();
    fieldPopulationByTarget.clear();
    perTargetTrackingEnabled = false;
  },
};
