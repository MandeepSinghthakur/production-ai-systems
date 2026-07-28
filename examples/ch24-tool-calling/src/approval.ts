// Approval workflow for high-value tool operations.
// Implements human-in-the-loop for transfers above a threshold.
//
// The pattern: model proposes, human disposes. For high-stakes operations,
// the model can initiate but not complete. A human must approve.

import type {
  ApprovalRequest,
  ApprovalThresholds,
  TransferRequest,
} from './types.ts';

/**
 * Generate a unique approval ID.
 */
function generateApprovalId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `apr_${timestamp}_${random}`;
}

/**
 * ApprovalManager handles human-in-the-loop workflows.
 *
 * Workflow:
 * 1. Tool executor checks if operation requires approval
 * 2. If yes, creates an ApprovalRequest and returns "pending"
 * 3. Human reviews and approves/rejects via separate channel
 * 4. On approval, original operation completes
 * 5. On rejection, operation is cancelled
 */
export class ApprovalManager {
  private requests: Map<string, ApprovalRequest>;
  private thresholds: ApprovalThresholds;
  private onApprovalNeeded: ((request: ApprovalRequest) => void) | null;

  constructor(
    thresholds: ApprovalThresholds,
    onApprovalNeeded?: (request: ApprovalRequest) => void
  ) {
    this.requests = new Map();
    this.thresholds = thresholds;
    this.onApprovalNeeded = onApprovalNeeded ?? null;
  }

  /**
   * Check if a transfer requires approval.
   */
  requiresApproval(request: TransferRequest): boolean {
    // Transfers above threshold require approval
    if (
      request.currency === this.thresholds.currency &&
      request.amount > this.thresholds.transferAmount
    ) {
      return true;
    }

    // Could add other rules here:
    // - First-time recipients
    // - International transfers
    // - Unusual patterns

    return false;
  }

  /**
   * Create an approval request.
   */
  createRequest(
    transfer: TransferRequest,
    requestedBy: string
  ): ApprovalRequest {
    const id = generateApprovalId();
    const request: ApprovalRequest = {
      id,
      type: 'transfer',
      transferRequest: { ...transfer },
      requestedBy,
      requestedAt: Date.now(),
      status: 'pending',
    };

    this.requests.set(id, request);

    // Notify listener (in production, this sends to a queue or UI)
    if (this.onApprovalNeeded) {
      this.onApprovalNeeded(request);
    }

    return request;
  }

  /**
   * Get an approval request by ID.
   */
  getRequest(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }

  /**
   * Approve a pending request.
   */
  approve(id: string, decidedBy: string, reason?: string): ApprovalRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new Error(`Approval request not found: ${id}`);
    }

    if (request.status !== 'pending') {
      throw new Error(
        `Approval request ${id} is not pending, status: ${request.status}`
      );
    }

    request.status = 'approved';
    request.decidedBy = decidedBy;
    request.decidedAt = Date.now();
    request.reason = reason;

    return request;
  }

  /**
   * Reject a pending request.
   */
  reject(id: string, decidedBy: string, reason: string): ApprovalRequest {
    const request = this.requests.get(id);
    if (!request) {
      throw new Error(`Approval request not found: ${id}`);
    }

    if (request.status !== 'pending') {
      throw new Error(
        `Approval request ${id} is not pending, status: ${request.status}`
      );
    }

    request.status = 'rejected';
    request.decidedBy = decidedBy;
    request.decidedAt = Date.now();
    request.reason = reason;

    return request;
  }

  /**
   * Get all pending requests.
   */
  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.status === 'pending'
    );
  }

  /**
   * Get all requests (for testing).
   */
  getAllRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }

  /**
   * Clear all requests (for testing).
   */
  clear(): void {
    this.requests.clear();
  }
}
