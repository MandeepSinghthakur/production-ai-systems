import type {
  Initiative,
  PrioritizationResult,
  ScoredInitiative,
  PrioritizationFactor,
  ResourceAllocation
} from './types.ts';
import { EFFORT_WEEKS, IMPACT_MULTIPLIERS } from './types.ts';

export class InitiativePrioritizer {
  private weights: PrioritizationWeights;

  constructor(weights?: Partial<PrioritizationWeights>) {
    this.weights = {
      impact: 0.35,
      effort: 0.25,
      dependencies: 0.15,
      priority: 0.15,
      status: 0.10,
      ...weights
    };
  }

  prioritize(initiatives: Initiative[]): PrioritizationResult {
    const scored = initiatives.map(init => this.scoreInitiative(init, initiatives));
    scored.sort((a, b) => b.score - a.score);

    const topPriorities = scored.slice(0, 5).map(s => s.initiative.id);
    const resourceAllocation = this.allocateResources(scored);

    return {
      initiatives: scored,
      topPriorities,
      resourceAllocation
    };
  }

  private scoreInitiative(initiative: Initiative, all: Initiative[]): ScoredInitiative {
    const factors: PrioritizationFactor[] = [];

    // Impact score (higher impact = higher score)
    const impactScore = IMPACT_MULTIPLIERS[initiative.impact] * 20;
    factors.push({
      name: 'impact',
      weight: this.weights.impact,
      score: impactScore,
      contribution: impactScore * this.weights.impact
    });

    // Effort score (lower effort = higher score)
    const effortWeeks = EFFORT_WEEKS[initiative.effort];
    const effortScore = Math.max(0, 100 - effortWeeks * 3);
    factors.push({
      name: 'effort',
      weight: this.weights.effort,
      score: effortScore,
      contribution: effortScore * this.weights.effort
    });

    // Dependency score (fewer blockers = higher score)
    const blockedBy = initiative.dependencies.length;
    const depScore = Math.max(0, 100 - blockedBy * 20);
    factors.push({
      name: 'dependencies',
      weight: this.weights.dependencies,
      score: depScore,
      contribution: depScore * this.weights.dependencies
    });

    // Priority score (1 = highest, 5 = lowest)
    const priorityScore = (6 - initiative.priority) * 20;
    factors.push({
      name: 'priority',
      weight: this.weights.priority,
      score: priorityScore,
      contribution: priorityScore * this.weights.priority
    });

    // Status score (in_progress > planned > blocked)
    const statusScores: Record<string, number> = {
      in_progress: 80,
      planned: 60,
      blocked: 20,
      completed: 0,
      cancelled: 0
    };
    const statusScore = statusScores[initiative.status] || 50;
    factors.push({
      name: 'status',
      weight: this.weights.status,
      score: statusScore,
      contribution: statusScore * this.weights.status
    });

    const totalScore = factors.reduce((sum, f) => sum + f.contribution, 0);

    return {
      initiative,
      score: Math.round(totalScore),
      factors
    };
  }

  private allocateResources(scored: ScoredInitiative[]): ResourceAllocation[] {
    const allocations: ResourceAllocation[] = [];
    const quarters = new Set(scored.map(s => s.initiative.quarter));

    for (const quarter of quarters) {
      const quarterInitiatives = scored
        .filter(s => s.initiative.quarter === quarter)
        .filter(s => s.initiative.status !== 'completed' && s.initiative.status !== 'cancelled');

      // Estimate headcount based on effort
      let headcount = 0;
      for (const scored of quarterInitiatives) {
        const weeks = EFFORT_WEEKS[scored.initiative.effort];
        headcount += Math.ceil(weeks / 12); // Assume 12 weeks per quarter
      }

      allocations.push({
        quarter,
        initiatives: quarterInitiatives.map(s => s.initiative.id),
        headcount,
        budget: headcount * 50000 // Rough estimate per quarter
      });
    }

    return allocations.sort((a, b) => a.quarter.localeCompare(b.quarter));
  }

  validatePrioritization(result: PrioritizationResult): boolean {
    // Check that top priorities are actually the highest scored
    const sortedByScore = [...result.initiatives].sort((a, b) => b.score - a.score);
    const actualTop5 = sortedByScore.slice(0, 5).map(s => s.initiative.id);

    for (const id of result.topPriorities) {
      if (!actualTop5.includes(id)) {
        return false;
      }
    }

    // Check that scoring is consistent
    for (const scored of result.initiatives) {
      const recalculated = scored.factors.reduce((sum, f) => sum + f.contribution, 0);
      if (Math.abs(recalculated - scored.score) > 1) {
        return false;
      }
    }

    return true;
  }

  reorderByDependencies(scored: ScoredInitiative[]): ScoredInitiative[] {
    // Ensure dependencies come before dependents
    const result: ScoredInitiative[] = [];
    const remaining = [...scored];
    const added = new Set<string>();

    while (remaining.length > 0) {
      let addedThisRound = false;

      for (let i = remaining.length - 1; i >= 0; i--) {
        const item = remaining[i];
        const deps = item.initiative.dependencies;
        const allDepsResolved = deps.every(d => added.has(d));

        if (allDepsResolved) {
          result.push(item);
          added.add(item.initiative.id);
          remaining.splice(i, 1);
          addedThisRound = true;
        }
      }

      // Break cycle if no progress made
      if (!addedThisRound && remaining.length > 0) {
        result.push(remaining.shift()!);
        addedThisRound = true;
      }
    }

    return result;
  }
}

export interface PrioritizationWeights {
  impact: number;
  effort: number;
  dependencies: number;
  priority: number;
  status: number;
}
