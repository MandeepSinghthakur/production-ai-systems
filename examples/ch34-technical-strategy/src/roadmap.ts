import type { Roadmap, Initiative, Milestone } from './types.ts';

export class RoadmapPlanner {
  private roadmaps: Map<string, Roadmap>;

  constructor() {
    this.roadmaps = new Map();
  }

  create(id: string, name: string, timeframe: string): Roadmap {
    const roadmap: Roadmap = {
      id,
      name,
      timeframe,
      initiatives: [],
      milestones: []
    };
    this.roadmaps.set(id, roadmap);
    return roadmap;
  }

  get(id: string): Roadmap | undefined {
    return this.roadmaps.get(id);
  }

  addInitiative(roadmapId: string, initiative: Initiative): void {
    const roadmap = this.roadmaps.get(roadmapId);
    if (roadmap) {
      roadmap.initiatives.push(initiative);
    }
  }

  addMilestone(roadmapId: string, milestone: Milestone): void {
    const roadmap = this.roadmaps.get(roadmapId);
    if (roadmap) {
      roadmap.milestones.push(milestone);
    }
  }

  validateDependencies(roadmap: Roadmap): DependencyValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const initiativeIds = new Set(roadmap.initiatives.map(i => i.id));

    // Check for missing dependencies
    for (const initiative of roadmap.initiatives) {
      for (const depId of initiative.dependencies) {
        if (!initiativeIds.has(depId)) {
          errors.push(`Initiative "${initiative.id}" depends on unknown initiative "${depId}"`);
        }
      }
    }

    // Check for circular dependencies
    const cycles = this.findCycles(roadmap.initiatives);
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        errors.push(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }
    }

    // Check for blocked paths
    for (const initiative of roadmap.initiatives) {
      if (initiative.status === 'blocked') {
        const dependents = roadmap.initiatives.filter(i =>
          i.dependencies.includes(initiative.id)
        );
        if (dependents.length > 0) {
          warnings.push(
            `Blocked initiative "${initiative.id}" is blocking: ${dependents.map(d => d.id).join(', ')}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      hasCycles: cycles.length > 0
    };
  }

  private findCycles(initiatives: Initiative[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (id: string): boolean => {
      visited.add(id);
      recursionStack.add(id);
      path.push(id);

      const initiative = initiatives.find(i => i.id === id);
      if (initiative) {
        for (const depId of initiative.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            // Found cycle
            const cycleStart = path.indexOf(depId);
            cycles.push([...path.slice(cycleStart), depId]);
            return true;
          }
        }
      }

      path.pop();
      recursionStack.delete(id);
      return false;
    };

    for (const initiative of initiatives) {
      if (!visited.has(initiative.id)) {
        dfs(initiative.id);
      }
    }

    return cycles;
  }

  getExecutionOrder(roadmap: Roadmap): Initiative[] {
    // Topological sort
    const result: Initiative[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (initiative: Initiative): void => {
      if (temp.has(initiative.id)) {
        return; // Cycle, skip
      }
      if (visited.has(initiative.id)) {
        return;
      }

      temp.add(initiative.id);

      for (const depId of initiative.dependencies) {
        const dep = roadmap.initiatives.find(i => i.id === depId);
        if (dep) {
          visit(dep);
        }
      }

      temp.delete(initiative.id);
      visited.add(initiative.id);
      result.push(initiative);
    };

    for (const initiative of roadmap.initiatives) {
      visit(initiative);
    }

    return result;
  }

  getMilestoneStatus(roadmap: Roadmap, milestoneId: string): MilestoneStatus {
    const milestone = roadmap.milestones.find(m => m.id === milestoneId);
    if (!milestone) {
      return { status: 'unknown', completedInitiatives: 0, totalInitiatives: 0, percentage: 0 };
    }

    const linkedInitiatives = roadmap.initiatives.filter(i =>
      milestone.initiatives.includes(i.id)
    );

    const completed = linkedInitiatives.filter(i => i.status === 'completed').length;
    const total = linkedInitiatives.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    let status: 'on_track' | 'at_risk' | 'delayed' | 'completed';
    if (completed === total) {
      status = 'completed';
    } else if (linkedInitiatives.some(i => i.status === 'blocked')) {
      status = 'at_risk';
    } else if (percentage >= 50) {
      status = 'on_track';
    } else {
      status = 'delayed';
    }

    return {
      status,
      completedInitiatives: completed,
      totalInitiatives: total,
      percentage
    };
  }
}

export interface DependencyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hasCycles: boolean;
}

export interface MilestoneStatus {
  status: 'on_track' | 'at_risk' | 'delayed' | 'completed' | 'unknown';
  completedInitiatives: number;
  totalInitiatives: number;
  percentage: number;
}
