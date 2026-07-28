// Tool execution with all security guards in place.
// This is the entry point for executing tool calls safely.
//
// Execution order:
// 1. Schema validation (reject malformed calls)
// 2. Argument sanitization (block or clean dangerous content)
// 3. Idempotency check (return cached result if duplicate)
// 4. Approval check (defer high-value operations)
// 5. Business logic execution
// 6. Audit logging (record everything)

import type {
  ActorContext,
  ToolCall,
  ToolResult,
  TransferRequest,
  TransferResult,
  ToolDefinition,
} from './types.ts';
import { TRANSFER_TOOL, BALANCE_TOOL } from './types.ts';
import { Bank } from './bank.ts';
import { IdempotencyStore } from './idempotency.ts';
import { ApprovalManager } from './approval.ts';
import { AuditLogger } from './audit.ts';
import { ToolArgumentSanitizer } from './sanitizer.ts';
import { ToolValidator } from './validator.ts';

/**
 * Generate a unique ID.
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * ToolExecutor coordinates all security guards and executes tools.
 */
export class ToolExecutor {
  private bank: Bank;
  private idempotency: IdempotencyStore;
  private approvals: ApprovalManager;
  private audit: AuditLogger;
  private sanitizer: ToolArgumentSanitizer;
  private validator: ToolValidator;
  private tools: Map<string, ToolDefinition>;

  constructor(
    bank: Bank,
    idempotency: IdempotencyStore,
    approvals: ApprovalManager,
    audit: AuditLogger
  ) {
    this.bank = bank;
    this.idempotency = idempotency;
    this.approvals = approvals;
    this.audit = audit;
    this.sanitizer = new ToolArgumentSanitizer();
    this.validator = new ToolValidator([TRANSFER_TOOL, BALANCE_TOOL]);
    this.tools = new Map([
      [TRANSFER_TOOL.name, TRANSFER_TOOL],
      [BALANCE_TOOL.name, BALANCE_TOOL],
    ]);
  }

  /**
   * Execute a tool call with all security guards.
   */
  execute(toolCall: ToolCall, actor: ActorContext): ToolResult {
    const startTime = Date.now();

    // Log receipt
    this.audit.logToolCallReceived(actor.userId, toolCall);

    // Step 1: Validate schema
    const validation = this.validator.validate(toolCall.name, toolCall.arguments);
    if (!validation.valid) {
      this.audit.logValidationFailed(actor.userId, toolCall, validation.errors);
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
      };
    }

    // Step 2: Sanitize arguments
    const toolDef = this.tools.get(toolCall.name);
    if (!toolDef) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    const sanitizeResult = this.sanitizer.sanitize(toolCall.arguments, toolDef);
    if (sanitizeResult.blocked) {
      this.audit.logInjectionBlocked(
        actor.userId,
        toolCall,
        sanitizeResult.blockReason ?? 'unknown',
        'arguments'
      );
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Request blocked: ${sanitizeResult.blockReason}`,
      };
    }

    // Step 3-6: Dispatch to tool-specific handler
    const args = sanitizeResult.sanitized;

    switch (toolCall.name) {
      case 'transfer_funds':
        return this.executeTransfer(toolCall.id, args, actor, startTime);

      case 'check_balance':
        return this.executeBalanceCheck(toolCall.id, args, actor);

      default:
        return {
          toolCallId: toolCall.id,
          success: false,
          error: `Unimplemented tool: ${toolCall.name}`,
        };
    }
  }

  /**
   * Execute a transfer with idempotency and approval checks.
   */
  private executeTransfer(
    toolCallId: string,
    args: Record<string, unknown>,
    actor: ActorContext,
    startTime: number
  ): ToolResult {
    const idempotencyKey = args.idempotency_key as string;

    // Step 3: Check idempotency
    const cached = this.idempotency.get(idempotencyKey);
    if (cached) {
      this.audit.logIdempotencyHit(actor.userId, toolCallId, idempotencyKey);
      return {
        toolCallId,
        success: true,
        result: cached,
      };
    }

    // Build the transfer request
    const request: TransferRequest = {
      fromAccount: args.from_account as string,
      toAccount: args.to_account as string,
      amount: args.amount as number,
      currency: args.currency as string,
      memo: (args.memo as string) ?? '',
      idempotencyKey,
    };

    // Log initiation
    this.audit.logTransferInitiated(
      actor.userId,
      toolCallId,
      idempotencyKey,
      request.fromAccount,
      request.toAccount,
      request.amount,
      request.currency
    );

    // Step 4: Check if approval required
    if (this.approvals.requiresApproval(request)) {
      const transferId = generateId('txn');
      const approval = this.approvals.createRequest(request, actor.userId);

      // Record pending transfer
      const pendingResult = this.bank.recordPendingTransfer(
        request,
        transferId,
        approval.id
      );

      // Store in idempotency (pending state)
      this.idempotency.set(idempotencyKey, pendingResult);

      this.audit.logApprovalRequested(
        actor.userId,
        toolCallId,
        approval.id,
        request.amount,
        request.currency
      );

      return {
        toolCallId,
        success: true,
        result: pendingResult,
        requiresApproval: true,
        approvalId: approval.id,
      };
    }

    // Step 5: Execute transfer
    try {
      const transferId = generateId('txn');
      const result = this.bank.executeTransfer(request, transferId);

      // Store in idempotency
      this.idempotency.set(idempotencyKey, result);

      const durationMs = Date.now() - startTime;
      this.audit.logTransferCompleted(
        actor.userId,
        toolCallId,
        idempotencyKey,
        transferId,
        durationMs
      );

      return {
        toolCallId,
        success: true,
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.audit.logTransferRejected(
        actor.userId,
        toolCallId,
        idempotencyKey,
        message
      );

      return {
        toolCallId,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Execute a balance check.
   */
  private executeBalanceCheck(
    toolCallId: string,
    args: Record<string, unknown>,
    actor: ActorContext
  ): ToolResult {
    const accountId = args.account_id as string;
    const account = this.bank.getAccount(accountId);

    if (!account) {
      return {
        toolCallId,
        success: false,
        error: `Account not found: ${accountId}`,
      };
    }

    return {
      toolCallId,
      success: true,
      result: {
        accountId: account.id,
        name: account.name,
        balance: account.balance,
        currency: account.currency,
      },
    };
  }

  /**
   * Process an approval decision.
   * Called when a human approves or rejects a pending transfer.
   */
  processApproval(
    approvalId: string,
    approved: boolean,
    decidedBy: string,
    reason?: string
  ): TransferResult {
    const approval = this.approvals.getRequest(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    const idempotencyKey = approval.transferRequest.idempotencyKey;

    if (approved) {
      // Approve and execute
      this.approvals.approve(approvalId, decidedBy, reason);
      this.audit.logApprovalGranted(decidedBy, approvalId, idempotencyKey);

      // Find the pending transfer and complete it
      const transfers = this.bank.getAllTransfers();
      const pending = transfers.find(
        (t) => t.approvalId === approvalId && t.status === 'pending_approval'
      );

      if (!pending) {
        throw new Error(`Pending transfer not found for approval: ${approvalId}`);
      }

      const result = this.bank.completePendingTransfer(pending.transferId);

      // Update idempotency with completed result
      this.idempotency.set(idempotencyKey, result);

      return result;
    } else {
      // Reject
      this.approvals.reject(approvalId, decidedBy, reason ?? 'Rejected by approver');
      this.audit.logApprovalDenied(
        decidedBy,
        approvalId,
        idempotencyKey,
        reason ?? 'Rejected by approver'
      );

      // Find and reject the pending transfer
      const transfers = this.bank.getAllTransfers();
      const pending = transfers.find(
        (t) => t.approvalId === approvalId && t.status === 'pending_approval'
      );

      if (!pending) {
        throw new Error(`Pending transfer not found for approval: ${approvalId}`);
      }

      const result = this.bank.rejectPendingTransfer(
        pending.transferId,
        reason ?? 'Rejected by approver'
      );

      // Update idempotency with rejected result
      this.idempotency.set(idempotencyKey, result);

      return result;
    }
  }

  /**
   * Get the bank instance (for testing).
   */
  getBank(): Bank {
    return this.bank;
  }

  /**
   * Get the audit logger (for testing).
   */
  getAudit(): AuditLogger {
    return this.audit;
  }

  /**
   * Get the idempotency store (for testing).
   */
  getIdempotency(): IdempotencyStore {
    return this.idempotency;
  }

  /**
   * Get the approval manager (for testing).
   */
  getApprovals(): ApprovalManager {
    return this.approvals;
  }
}

/**
 * Create a fully configured ToolExecutor.
 */
export function createToolExecutor(
  approvalThreshold: number = 1_000_000 // $10,000 in cents
): ToolExecutor {
  const bank = new Bank();
  const idempotency = new IdempotencyStore();
  const approvals = new ApprovalManager({
    transferAmount: approvalThreshold,
    currency: 'USD',
  });
  const audit = new AuditLogger();

  return new ToolExecutor(bank, idempotency, approvals, audit);
}
