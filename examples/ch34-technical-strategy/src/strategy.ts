import type { StrategyDocument, StrategicGoal, StrategyMilestone, StrategicRisk } from './types.ts';
import { REQUIRED_STRATEGY_SECTIONS } from './types.ts';

export class StrategyBuilder {
  private doc: Partial<StrategyDocument>;

  constructor(title: string, author: string) {
    this.doc = {
      title,
      author,
      version: '1.0',
      createdAt: new Date(),
      vision: '',
      goals: [],
      milestones: [],
      risks: [],
      dependencies: [],
      metrics: []
    };
  }

  setVision(vision: string): StrategyBuilder {
    this.doc.vision = vision;
    return this;
  }

  addGoal(goal: StrategicGoal): StrategyBuilder {
    this.doc.goals = this.doc.goals || [];
    this.doc.goals.push(goal);
    return this;
  }

  addMilestone(milestone: StrategyMilestone): StrategyBuilder {
    this.doc.milestones = this.doc.milestones || [];
    this.doc.milestones.push(milestone);
    return this;
  }

  addRisk(risk: StrategicRisk): StrategyBuilder {
    this.doc.risks = this.doc.risks || [];
    this.doc.risks.push(risk);
    return this;
  }

  addDependency(dep: StrategyDocument['dependencies'][0]): StrategyBuilder {
    this.doc.dependencies = this.doc.dependencies || [];
    this.doc.dependencies.push(dep);
    return this;
  }

  addMetric(metric: StrategyDocument['metrics'][0]): StrategyBuilder {
    this.doc.metrics = this.doc.metrics || [];
    this.doc.metrics.push(metric);
    return this;
  }

  build(): StrategyDocument {
    return this.doc as StrategyDocument;
  }
}

export class StrategyValidator {
  validate(doc: StrategyDocument): StrategyValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required sections
    if (!doc.vision || doc.vision.trim().length === 0) {
      errors.push('Vision statement is required');
    }

    if (!doc.goals || doc.goals.length === 0) {
      errors.push('At least one strategic goal is required');
    }

    if (!doc.milestones || doc.milestones.length === 0) {
      errors.push('At least one milestone is required');
    }

    if (!doc.risks || doc.risks.length === 0) {
      warnings.push('No risks documented - consider adding risk assessment');
    }

    // Check goals are measurable
    for (const goal of doc.goals || []) {
      if (!goal.measurable) {
        warnings.push(`Goal "${goal.id}" is not measurable - consider adding metrics`);
      }
      if (!goal.keyResults || goal.keyResults.length === 0) {
        warnings.push(`Goal "${goal.id}" has no key results`);
      }
    }

    // Check milestone dependencies
    const milestoneIds = new Set((doc.milestones || []).map(m => m.id));
    for (const milestone of doc.milestones || []) {
      for (const depId of milestone.dependencies) {
        if (!milestoneIds.has(depId)) {
          errors.push(`Milestone "${milestone.id}" depends on unknown milestone "${depId}"`);
        }
      }
    }

    // Check for high-impact risks without mitigation
    for (const risk of doc.risks || []) {
      if (risk.impact === 'high' && (!risk.mitigation || risk.mitigation.trim().length === 0)) {
        errors.push(`High-impact risk "${risk.id}" has no mitigation strategy`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      completeness: this.calculateCompleteness(doc)
    };
  }

  private calculateCompleteness(doc: StrategyDocument): number {
    let score = 0;
    const total = 6;

    if (doc.vision && doc.vision.length > 50) score++;
    if (doc.goals && doc.goals.length >= 2) score++;
    if (doc.milestones && doc.milestones.length >= 2) score++;
    if (doc.risks && doc.risks.length >= 1) score++;
    if (doc.dependencies && doc.dependencies.length >= 1) score++;
    if (doc.metrics && doc.metrics.length >= 1) score++;

    return Math.round((score / total) * 100);
  }

  hasRequiredSections(doc: StrategyDocument): boolean {
    return (
      doc.vision.trim().length > 0 &&
      doc.goals.length > 0 &&
      doc.milestones.length > 0 &&
      doc.risks.length > 0
    );
  }
}

export interface StrategyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  completeness: number;
}
