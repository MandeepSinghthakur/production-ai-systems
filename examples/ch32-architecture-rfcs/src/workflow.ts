import type { RFC, RFCStatus, StatusTransition } from './types.ts';
import { VALID_TRANSITIONS } from './types.ts';

export class RFCWorkflow {
  private transitions: StatusTransition[];

  constructor() {
    this.transitions = [];
  }

  canTransition(from: RFCStatus, to: RFCStatus): boolean {
    const validTargets = VALID_TRANSITIONS[from];
    return validTargets.includes(to);
  }

  transition(rfc: RFC, to: RFCStatus, actor: string, reason?: string): boolean {
    if (!this.canTransition(rfc.status, to)) {
      return false;
    }

    const transition: StatusTransition = {
      from: rfc.status,
      to,
      timestamp: new Date(),
      actor,
      reason
    };

    this.transitions.push(transition);
    rfc.status = to;
    rfc.updated = new Date();

    return true;
  }

  getTransitionHistory(): StatusTransition[] {
    return [...this.transitions];
  }

  getValidNextStates(currentStatus: RFCStatus): RFCStatus[] {
    return VALID_TRANSITIONS[currentStatus];
  }

  submitForReview(rfc: RFC, actor: string): boolean {
    // Validate RFC is ready for review
    if (!rfc.context || !rfc.decision || rfc.consequences.length === 0) {
      return false;
    }

    return this.transition(rfc, 'review', actor, 'Submitted for review');
  }

  approve(rfc: RFC, actor: string): boolean {
    if (rfc.status !== 'review') {
      return false;
    }

    // Check if all required reviewers approved
    const requiredApprovals = rfc.reviewers.filter(r => r.approved === true);
    if (requiredApprovals.length === 0) {
      return false;
    }

    return this.transition(rfc, 'approved', actor, 'Approved by reviewers');
  }

  reject(rfc: RFC, actor: string, reason: string): boolean {
    if (rfc.status !== 'review') {
      return false;
    }

    return this.transition(rfc, 'rejected', actor, reason);
  }

  sendBackToDraft(rfc: RFC, actor: string, reason: string): boolean {
    if (rfc.status !== 'review' && rfc.status !== 'rejected') {
      return false;
    }

    return this.transition(rfc, 'draft', actor, reason);
  }

  supersede(oldRfc: RFC, newRfcId: string, actor: string): boolean {
    if (oldRfc.status !== 'approved') {
      return false;
    }

    return this.transition(
      oldRfc,
      'superseded',
      actor,
      `Superseded by RFC ${newRfcId}`
    );
  }
}

export class RFCRepository {
  private rfcs: Map<string, RFC>;
  private workflows: Map<string, RFCWorkflow>;

  constructor() {
    this.rfcs = new Map();
    this.workflows = new Map();
  }

  save(rfc: RFC): void {
    this.rfcs.set(rfc.id, rfc);
    if (!this.workflows.has(rfc.id)) {
      this.workflows.set(rfc.id, new RFCWorkflow());
    }
  }

  get(id: string): RFC | undefined {
    return this.rfcs.get(id);
  }

  getWorkflow(rfcId: string): RFCWorkflow | undefined {
    return this.workflows.get(rfcId);
  }

  list(): RFC[] {
    return Array.from(this.rfcs.values());
  }

  findByStatus(status: RFCStatus): RFC[] {
    return this.list().filter(rfc => rfc.status === status);
  }

  findByAuthor(author: string): RFC[] {
    return this.list().filter(rfc => rfc.author === author);
  }

  findPendingReview(): RFC[] {
    return this.findByStatus('review').filter(rfc => {
      const pendingReviewers = rfc.reviewers.filter(r => r.approved === null);
      return pendingReviewers.length > 0;
    });
  }

  getStatistics(): {
    total: number;
    byStatus: Record<RFCStatus, number>;
    avgReviewTime: number;
  } {
    const rfcs = this.list();
    const byStatus: Record<RFCStatus, number> = {
      draft: 0,
      review: 0,
      approved: 0,
      rejected: 0,
      superseded: 0
    };

    for (const rfc of rfcs) {
      byStatus[rfc.status]++;
    }

    // Calculate average review time for approved RFCs
    let totalReviewTime = 0;
    let reviewedCount = 0;

    for (const rfc of rfcs) {
      if (rfc.status === 'approved') {
        const reviewTime = rfc.updated.getTime() - rfc.created.getTime();
        totalReviewTime += reviewTime;
        reviewedCount++;
      }
    }

    const avgReviewTime = reviewedCount > 0
      ? totalReviewTime / reviewedCount
      : 0;

    return {
      total: rfcs.length,
      byStatus,
      avgReviewTime
    };
  }
}
