// Alerting for AI systems.
//
// The key insight: alerting on the wrong metrics creates noise or misses
// real problems. AI systems need alerts on tokens, cost, and latency
// percentiles, not just request counts and error rates.
//
// This implements a Prometheus-style alerting engine without external deps.

import type { AlertRule, AlertState, Metric, MetricDataPoint } from './types.ts';

/**
 * Alert manager evaluates rules against metrics and fires alerts.
 */
export class AlertManager {
  private rules: AlertRule[];
  private states: Map<string, AlertState>;
  private history: AlertState[];

  constructor() {
    this.rules = [];
    this.states = new Map();
    this.history = [];
  }

  /**
   * Register an alert rule.
   */
  addRule(rule: AlertRule): void {
    this.rules.push(rule);
    this.states.set(rule.name, {
      rule,
      firing: false,
      firedAt: null,
      resolvedAt: null,
      value: 0,
      message: '',
    });
  }

  /**
   * Remove an alert rule.
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter((r) => r.name !== name);
    this.states.delete(name);
  }

  /**
   * Evaluate all rules against current metrics.
   */
  evaluate(metrics: Metric[]): AlertState[] {
    const now = Date.now();
    const firingAlerts: AlertState[] = [];

    for (const rule of this.rules) {
      const metric = metrics.find((m) => m.name === rule.metric);
      if (!metric) continue;

      // Find data points matching the rule's labels
      const matchingPoints = this.filterByLabels(
        metric.dataPoints,
        rule.labels
      );

      // Aggregate values in the window
      const windowStart = now - rule.windowMs;
      const valuesInWindow = matchingPoints
        .filter((p) => p.timestampMs >= windowStart)
        .map((p) => p.value);

      if (valuesInWindow.length === 0) continue;

      // Use the latest value for evaluation
      const latestValue = valuesInWindow[valuesInWindow.length - 1];
      const shouldFire = this.evaluateCondition(
        latestValue,
        rule.condition,
        rule.threshold
      );

      const state = this.states.get(rule.name)!;
      const wasFiring = state.firing;

      state.value = latestValue;

      if (shouldFire && !wasFiring) {
        // Transition to firing
        state.firing = true;
        state.firedAt = now;
        state.resolvedAt = null;
        state.message = this.formatAlertMessage(rule, latestValue, 'firing');
        this.history.push({ ...state });
        firingAlerts.push(state);
      } else if (!shouldFire && wasFiring) {
        // Transition to resolved
        state.firing = false;
        state.resolvedAt = now;
        state.message = this.formatAlertMessage(rule, latestValue, 'resolved');
        this.history.push({ ...state });
      } else if (shouldFire) {
        // Still firing
        state.message = this.formatAlertMessage(rule, latestValue, 'firing');
        firingAlerts.push(state);
      }
    }

    return firingAlerts;
  }

  /**
   * Get all currently firing alerts.
   */
  getFiringAlerts(): AlertState[] {
    return Array.from(this.states.values()).filter((s) => s.firing);
  }

  /**
   * Get alert state by rule name.
   */
  getState(ruleName: string): AlertState | undefined {
    return this.states.get(ruleName);
  }

  /**
   * Get all registered rules.
   */
  getRules(): AlertRule[] {
    return this.rules.slice();
  }

  /**
   * Get alert history.
   */
  getHistory(): AlertState[] {
    return this.history.slice();
  }

  /**
   * Clear all state and history.
   */
  clear(): void {
    this.rules = [];
    this.states.clear();
    this.history = [];
  }

  private filterByLabels(
    dataPoints: MetricDataPoint[],
    labels: Record<string, string>
  ): MetricDataPoint[] {
    return dataPoints.filter((p) => {
      for (const [key, value] of Object.entries(labels)) {
        if (p.labels[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  private evaluateCondition(
    value: number,
    condition: AlertRule['condition'],
    threshold: number
  ): boolean {
    switch (condition) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  }

  private formatAlertMessage(
    rule: AlertRule,
    value: number,
    status: 'firing' | 'resolved'
  ): string {
    const conditionStr = this.conditionToString(rule.condition);
    if (status === 'firing') {
      return (
        `[${rule.severity.toUpperCase()}] ${rule.name}: ` +
        `${rule.metric} is ${value.toFixed(2)}, ` +
        `expected ${conditionStr} ${rule.threshold}. ` +
        `${rule.description}`
      );
    } else {
      return (
        `[RESOLVED] ${rule.name}: ` +
        `${rule.metric} is now ${value.toFixed(2)}, ` +
        `threshold ${conditionStr} ${rule.threshold}`
      );
    }
  }

  private conditionToString(condition: AlertRule['condition']): string {
    switch (condition) {
      case 'gt':
        return '>';
      case 'lt':
        return '<';
      case 'gte':
        return '>=';
      case 'lte':
        return '<=';
      case 'eq':
        return '=';
      default:
        return '?';
    }
  }
}

/**
 * Create common alert rules for LLM systems.
 */
export function createDefaultAlertRules(): AlertRule[] {
  return [
    {
      name: 'high_error_rate',
      description: 'Error rate exceeds 5% of requests',
      metric: 'llm_errors_total',
      condition: 'gt',
      threshold: 50, // Absolute count, adjust based on traffic
      windowMs: 300_000, // 5 minutes
      labels: {},
      severity: 'critical',
    },
    {
      name: 'high_latency_p99',
      description: 'P99 latency exceeds 30 seconds',
      metric: 'llm_request_duration_ms',
      condition: 'gt',
      threshold: 30000,
      windowMs: 300_000,
      labels: {},
      severity: 'warning',
    },
    {
      name: 'token_budget_exceeded',
      description: 'Token usage exceeds budget',
      metric: 'llm_output_tokens_total',
      condition: 'gt',
      threshold: 1_000_000, // 1M tokens
      windowMs: 3600_000, // 1 hour
      labels: {},
      severity: 'warning',
    },
    {
      name: 'low_cache_hit_rate',
      description: 'Cache hit rate below 50%',
      metric: 'llm_cache_hits_total',
      condition: 'lt',
      threshold: 100, // Adjust based on expected traffic
      windowMs: 600_000, // 10 minutes
      labels: {},
      severity: 'warning',
    },
    {
      name: 'cost_spike',
      description: 'Estimated cost spike detected',
      metric: 'llm_estimated_cost_usd',
      condition: 'gt',
      threshold: 100, // $100 in relative units
      windowMs: 3600_000,
      labels: {},
      severity: 'critical',
    },
  ];
}

/**
 * Create a tenant-specific alert rule.
 */
export function createTenantAlertRule(
  tenant: string,
  metric: string,
  threshold: number,
  severity: 'warning' | 'critical' = 'warning'
): AlertRule {
  return {
    name: `${tenant}_${metric}_alert`,
    description: `Alert for tenant ${tenant} on ${metric}`,
    metric,
    condition: 'gt',
    threshold,
    windowMs: 300_000,
    labels: { tenant },
    severity,
  };
}
