import type {
  Incident,
  PostIncidentReport,
  ActionItem,
  RootCause,
  ImpactAssessment,
  TimelineEvent
} from './types.ts';
import { REQUIRED_POSTMORTEM_SECTIONS } from './types.ts';

export class PostmortemGenerator {
  generate(incident: Incident, rootCause: RootCause, impact: ImpactAssessment): PostIncidentReport {
    const actionItems = this.generateActionItems(incident, rootCause);
    const lessonsLearned = this.extractLessonsLearned(rootCause);

    return {
      incidentId: incident.id,
      title: `Postmortem: ${incident.title}`,
      summary: this.generateSummary(incident, rootCause, impact),
      timeline: [...incident.timeline],
      rootCause,
      impact,
      actionItems,
      lessonsLearned,
      generatedAt: new Date()
    };
  }

  private generateSummary(
    incident: Incident,
    rootCause: RootCause,
    impact: ImpactAssessment
  ): string {
    const duration = impact.duration;
    const users = impact.usersAffected;

    return `On ${incident.detectedAt.toISOString().split('T')[0]}, a ${incident.severity} ` +
      `${incident.type} incident occurred affecting ${users} users for ${duration} minutes. ` +
      `Root cause: ${rootCause.description}. ` +
      `The incident was resolved at ${incident.resolvedAt?.toISOString() || 'N/A'}.`;
  }

  private generateActionItems(incident: Incident, rootCause: RootCause): ActionItem[] {
    const items: ActionItem[] = [];
    const baseDate = new Date();

    // Always add monitoring improvement
    items.push({
      id: `${incident.id}-ai-1`,
      description: `Add alerting for ${incident.type} incidents to reduce MTTD`,
      owner: 'platform-team',
      dueDate: new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
      priority: 'high',
      status: 'open'
    });

    // Add runbook improvement
    items.push({
      id: `${incident.id}-ai-2`,
      description: `Update runbook based on lessons learned from this incident`,
      owner: 'on-call-lead',
      dueDate: new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 1 week
      priority: 'medium',
      status: 'open'
    });

    // Add root cause specific action
    if (rootCause.category === 'process') {
      items.push({
        id: `${incident.id}-ai-3`,
        description: `Review and update deployment process to prevent recurrence`,
        owner: 'engineering-lead',
        dueDate: new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000), // 1 month
        priority: 'high',
        status: 'open'
      });
    } else if (rootCause.category === 'technology') {
      items.push({
        id: `${incident.id}-ai-3`,
        description: `Implement technical fix for: ${rootCause.description}`,
        owner: 'tech-lead',
        dueDate: new Date(baseDate.getTime() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
        priority: 'high',
        status: 'open'
      });
    }

    return items;
  }

  private extractLessonsLearned(rootCause: RootCause): string[] {
    const lessons: string[] = [];

    // Generic lessons based on category
    const categoryLessons: Record<string, string[]> = {
      human: [
        'Human error can be reduced with better tooling and automation',
        'Consider requiring peer review for high-risk operations'
      ],
      process: [
        'Process gaps should be documented and addressed in runbooks',
        'Regular process reviews can prevent future incidents'
      ],
      technology: [
        'Technical debt contributed to this incident',
        'Consider adding redundancy to prevent single points of failure'
      ],
      external: [
        'External dependencies require fallback strategies',
        'Consider multi-provider approach for critical services'
      ]
    };

    lessons.push(...(categoryLessons[rootCause.category] || []));

    // Add lessons from contributing factors
    for (const factor of rootCause.contributingFactors) {
      if (factor.toLowerCase().includes('monitoring')) {
        lessons.push('Improve monitoring coverage for earlier detection');
      }
      if (factor.toLowerCase().includes('documentation')) {
        lessons.push('Update documentation to prevent knowledge gaps');
      }
    }

    return lessons;
  }

  validate(report: PostIncidentReport): { valid: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!report.summary || report.summary.length === 0) {
      missing.push('summary');
    }
    if (!report.timeline || report.timeline.length === 0) {
      missing.push('timeline');
    }
    if (!report.rootCause || !report.rootCause.description) {
      missing.push('rootCause');
    }
    if (!report.impact) {
      missing.push('impact');
    }
    if (!report.actionItems || report.actionItems.length === 0) {
      missing.push('actionItems');
    }

    return {
      valid: missing.length === 0,
      missing
    };
  }

  hasRequiredSections(report: PostIncidentReport): boolean {
    return (
      report.summary.length > 0 &&
      report.timeline.length > 0 &&
      report.rootCause !== undefined &&
      report.impact !== undefined &&
      report.actionItems.length > 0
    );
  }
}

export class ActionItemTracker {
  private items: Map<string, ActionItem>;

  constructor() {
    this.items = new Map();
  }

  add(item: ActionItem): void {
    this.items.set(item.id, item);
  }

  addFromReport(report: PostIncidentReport): void {
    for (const item of report.actionItems) {
      this.add(item);
    }
  }

  get(id: string): ActionItem | undefined {
    return this.items.get(id);
  }

  updateStatus(id: string, status: ActionItem['status']): void {
    const item = this.items.get(id);
    if (item) {
      item.status = status;
    }
  }

  getOverdue(): ActionItem[] {
    const now = new Date();
    return Array.from(this.items.values()).filter(
      item => item.status !== 'completed' && item.dueDate < now
    );
  }

  getByOwner(owner: string): ActionItem[] {
    return Array.from(this.items.values()).filter(item => item.owner === owner);
  }

  getOpenItems(): ActionItem[] {
    return Array.from(this.items.values()).filter(
      item => item.status === 'open' || item.status === 'in_progress'
    );
  }

  getCompletionRate(): number {
    const all = Array.from(this.items.values());
    if (all.length === 0) return 100;

    const completed = all.filter(i => i.status === 'completed').length;
    return Math.round((completed / all.length) * 100);
  }
}
