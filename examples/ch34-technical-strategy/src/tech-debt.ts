import type { TechDebt, TechDebtScore } from './types.ts';

export class TechDebtTracker {
  private items: Map<string, TechDebt>;

  constructor() {
    this.items = new Map();
  }

  add(item: TechDebt): void {
    this.items.set(item.id, item);
  }

  get(id: string): TechDebt | undefined {
    return this.items.get(id);
  }

  list(): TechDebt[] {
    return Array.from(this.items.values());
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  linkIncident(debtId: string, incidentId: string): void {
    const item = this.items.get(debtId);
    if (item && !item.linkedIncidents.includes(incidentId)) {
      item.linkedIncidents.push(incidentId);
    }
  }

  getByCategory(category: TechDebt['category']): TechDebt[] {
    return this.list().filter(item => item.category === category);
  }

  getHighImpact(): TechDebt[] {
    return this.list().filter(item => item.impact >= 4);
  }
}

export class TechDebtScorer {
  score(item: TechDebt): TechDebtScore {
    // Priority = Impact / Effort (higher is better ROI)
    const payoffRatio = item.impact / item.effort;

    // Factor in interest rate (compounding cost)
    const interestMultiplier = 1 + (item.interestRate - 1) * 0.5;

    // Factor in incident links (more incidents = higher priority)
    const incidentBoost = Math.min(item.linkedIncidents.length * 0.2, 1);

    const priority = (payoffRatio * interestMultiplier) + incidentBoost;

    return {
      item,
      priority: Math.round(priority * 100) / 100,
      payoffRatio: Math.round(payoffRatio * 100) / 100
    };
  }

  scoreAll(items: TechDebt[]): TechDebtScore[] {
    return items
      .map(item => this.score(item))
      .sort((a, b) => b.priority - a.priority);
  }

  getPrioritized(items: TechDebt[], limit?: number): TechDebtScore[] {
    const scored = this.scoreAll(items);
    return limit ? scored.slice(0, limit) : scored;
  }

  calculateTotalDebt(items: TechDebt[]): DebtSummary {
    const byCategory: Record<string, number> = {};
    let totalImpact = 0;
    let totalEffort = 0;

    for (const item of items) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      totalImpact += item.impact;
      totalEffort += item.effort;
    }

    return {
      totalItems: items.length,
      byCategory,
      averageImpact: items.length > 0 ? totalImpact / items.length : 0,
      averageEffort: items.length > 0 ? totalEffort / items.length : 0,
      totalImpact,
      totalEffort
    };
  }

  validateScoring(scores: TechDebtScore[]): boolean {
    // Verify scores are sorted by priority descending
    for (let i = 1; i < scores.length; i++) {
      if (scores[i].priority > scores[i - 1].priority) {
        return false;
      }
    }

    // Verify all items have valid priority scores
    for (const score of scores) {
      if (score.priority < 0 || isNaN(score.priority)) {
        return false;
      }
    }

    return true;
  }
}

export interface DebtSummary {
  totalItems: number;
  byCategory: Record<string, number>;
  averageImpact: number;
  averageEffort: number;
  totalImpact: number;
  totalEffort: number;
}
