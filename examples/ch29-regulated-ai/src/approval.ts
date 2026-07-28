// Human-in-the-loop approval workflows.
// See Chapter 29, "Building Production AI Systems".

import type {
  ApprovalRequest,
  ApprovalStatus,
  ActionType,
  RiskLevel,
  UserRole,
} from './types.ts';

/**
 * Generate a unique ID.
 */
function generateId(): string {
  return 'apr_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Configuration for approval thresholds.
 */
export interface ApprovalConfig {
  // Risk levels that require approval
  requireApprovalForRisk: RiskLevel[];
  // Actions that always require approval regardless of risk
  alwaysRequireApproval: ActionType[];
  // Approval timeout in milliseconds
  approvalTimeoutMs: number;
  // Roles that can approve requests
  approverRoles: UserRole[];
}

/**
 * Default approval configuration.
 */
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  requireApprovalForRisk: ['high', 'critical'],
  alwaysRequireApproval: ['prescription', 'diagnosis'],
  approvalTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  approverRoles: ['clinician', 'admin'],
};

/**
 * Approval workflow manager.
 */
export class ApprovalManager {
  private requests: Map<string, ApprovalRequest>;
  private config: ApprovalConfig;

  constructor(config?: Partial<ApprovalConfig>) {
    this.requests = new Map();
    this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
  }

  /**
   * Check if an action requires approval.
   */
  requiresApproval(actionType: ActionType, riskLevel: RiskLevel): boolean {
    // Check if action always requires approval
    if (this.config.alwaysRequireApproval.includes(actionType)) {
      return true;
    }

    // Check if risk level requires approval
    if (this.config.requireApprovalForRisk.includes(riskLevel)) {
      return true;
    }

    return false;
  }

  /**
   * Create an approval request.
   */
  createRequest(
    sessionId: string,
    userId: string,
    userRole: UserRole,
    actionType: ActionType,
    riskLevel: RiskLevel,
    redactedInput: string,
    redactedOutput: string
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: generateId(),
      timestamp: Date.now(),
      sessionId,
      userId,
      userRole,
      actionType,
      riskLevel,
      redactedInput,
      redactedOutput,
      status: 'pending',
      reviewerId: null,
      reviewedAt: null,
      reviewNotes: null,
      expiresAt: Date.now() + this.config.approvalTimeoutMs,
    };

    this.requests.set(request.id, request);
    return request;
  }

  /**
   * Get a pending approval request.
   */
  getRequest(approvalId: string): ApprovalRequest | null {
    return this.requests.get(approvalId) ?? null;
  }

  /**
   * Get all pending requests.
   */
  getPendingRequests(): ApprovalRequest[] {
    const result: ApprovalRequest[] = [];
    for (const request of this.requests.values()) {
      if (request.status === 'pending') {
        result.push(request);
      }
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Approve a request.
   */
  approve(
    approvalId: string,
    reviewerId: string,
    reviewerRole: UserRole,
    notes: string | null
  ): { success: boolean; error: string | null } {
    const request = this.requests.get(approvalId);

    if (!request) {
      return { success: false, error: 'Approval request not found' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: `Request already ${request.status}` };
    }

    if (!this.config.approverRoles.includes(reviewerRole)) {
      return {
        success: false,
        error: `Role ${reviewerRole} cannot approve requests`,
      };
    }

    if (Date.now() >= request.expiresAt) {
      request.status = 'expired';
      this.requests.set(approvalId, request);
      return { success: false, error: 'Approval request has expired' };
    }

    request.status = 'approved';
    request.reviewerId = reviewerId;
    request.reviewedAt = Date.now();
    request.reviewNotes = notes;
    this.requests.set(approvalId, request);

    return { success: true, error: null };
  }

  /**
   * Reject a request.
   */
  reject(
    approvalId: string,
    reviewerId: string,
    reviewerRole: UserRole,
    notes: string
  ): { success: boolean; error: string | null } {
    const request = this.requests.get(approvalId);

    if (!request) {
      return { success: false, error: 'Approval request not found' };
    }

    if (request.status !== 'pending') {
      return { success: false, error: `Request already ${request.status}` };
    }

    if (!this.config.approverRoles.includes(reviewerRole)) {
      return {
        success: false,
        error: `Role ${reviewerRole} cannot reject requests`,
      };
    }

    request.status = 'rejected';
    request.reviewerId = reviewerId;
    request.reviewedAt = Date.now();
    request.reviewNotes = notes;
    this.requests.set(approvalId, request);

    return { success: true, error: null };
  }

  /**
   * Expire pending requests that have timed out.
   */
  expirePending(currentTime: number): string[] {
    const expired: string[] = [];

    for (const [id, request] of this.requests) {
      if (request.status === 'pending' && currentTime >= request.expiresAt) {
        request.status = 'expired';
        this.requests.set(id, request);
        expired.push(id);
      }
    }

    return expired;
  }

  /**
   * Get approval statistics.
   */
  getStatistics(): {
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
  } {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let expired = 0;

    for (const request of this.requests.values()) {
      switch (request.status) {
        case 'pending':
          pending++;
          break;
        case 'approved':
          approved++;
          break;
        case 'rejected':
          rejected++;
          break;
        case 'expired':
          expired++;
          break;
      }
    }

    return { pending, approved, rejected, expired };
  }

  /**
   * Check if approval has been granted for a request.
   */
  isApproved(approvalId: string): boolean {
    const request = this.requests.get(approvalId);
    return request?.status === 'approved';
  }

  /**
   * Clear all requests (for testing).
   */
  clear(): void {
    this.requests.clear();
  }
}
