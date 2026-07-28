// Bank account management and transfer logic.
// Simulates a simple banking system for demonstrating tool security.

import type { BankAccount, TransferRequest, TransferResult } from './types.ts';

/**
 * In-memory bank for the lab.
 * In production this would be a database with ACID transactions.
 */
export class Bank {
  private accounts: Map<string, BankAccount>;
  private transfers: Map<string, TransferResult>;

  constructor() {
    this.accounts = new Map();
    this.transfers = new Map();
  }

  /**
   * Create or update an account.
   */
  setAccount(account: BankAccount): void {
    this.accounts.set(account.id, { ...account });
  }

  /**
   * Get an account by ID.
   */
  getAccount(id: string): BankAccount | null {
    const account = this.accounts.get(id);
    return account ? { ...account } : null;
  }

  /**
   * Get all accounts.
   */
  getAllAccounts(): BankAccount[] {
    return Array.from(this.accounts.values()).map((a) => ({ ...a }));
  }

  /**
   * Execute a transfer between accounts.
   * This is the core banking operation.
   *
   * Returns a completed transfer or throws on insufficient funds.
   */
  executeTransfer(
    request: TransferRequest,
    transferId: string
  ): TransferResult {
    const fromAccount = this.accounts.get(request.fromAccount);
    const toAccount = this.accounts.get(request.toAccount);

    if (!fromAccount) {
      throw new Error(`Source account not found: ${request.fromAccount}`);
    }

    if (!toAccount) {
      throw new Error(`Destination account not found: ${request.toAccount}`);
    }

    if (fromAccount.currency !== request.currency) {
      throw new Error(
        `Currency mismatch: account is ${fromAccount.currency}, ` +
          `transfer is ${request.currency}`
      );
    }

    if (toAccount.currency !== request.currency) {
      throw new Error(
        `Currency mismatch: destination account is ${toAccount.currency}, ` +
          `transfer is ${request.currency}`
      );
    }

    if (fromAccount.balance < request.amount) {
      throw new Error(
        `Insufficient funds: balance ${fromAccount.balance}, ` +
          `transfer ${request.amount}`
      );
    }

    // Execute the transfer atomically (in real code, this is a transaction)
    const now = Date.now();
    fromAccount.balance -= request.amount;
    toAccount.balance += request.amount;

    const result: TransferResult = {
      transferId,
      status: 'completed',
      fromAccount: request.fromAccount,
      toAccount: request.toAccount,
      amount: request.amount,
      currency: request.currency,
      memo: request.memo,
      idempotencyKey: request.idempotencyKey,
      createdAt: now,
      completedAt: now,
    };

    this.transfers.set(transferId, result);
    return result;
  }

  /**
   * Record a pending transfer (awaiting approval).
   */
  recordPendingTransfer(
    request: TransferRequest,
    transferId: string,
    approvalId: string
  ): TransferResult {
    const result: TransferResult = {
      transferId,
      status: 'pending_approval',
      fromAccount: request.fromAccount,
      toAccount: request.toAccount,
      amount: request.amount,
      currency: request.currency,
      memo: request.memo,
      idempotencyKey: request.idempotencyKey,
      createdAt: Date.now(),
      approvalId,
    };

    this.transfers.set(transferId, result);
    return result;
  }

  /**
   * Complete a pending transfer after approval.
   */
  completePendingTransfer(transferId: string): TransferResult {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    if (transfer.status !== 'pending_approval') {
      throw new Error(
        `Transfer ${transferId} is not pending, status: ${transfer.status}`
      );
    }

    // Execute the actual transfer
    const fromAccount = this.accounts.get(transfer.fromAccount);
    const toAccount = this.accounts.get(transfer.toAccount);

    if (!fromAccount || !toAccount) {
      throw new Error('Account not found');
    }

    if (fromAccount.balance < transfer.amount) {
      transfer.status = 'rejected';
      transfer.rejectionReason = 'Insufficient funds at time of approval';
      return transfer;
    }

    fromAccount.balance -= transfer.amount;
    toAccount.balance += transfer.amount;
    transfer.status = 'completed';
    transfer.completedAt = Date.now();

    return transfer;
  }

  /**
   * Reject a pending transfer.
   */
  rejectPendingTransfer(transferId: string, reason: string): TransferResult {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    transfer.status = 'rejected';
    transfer.rejectionReason = reason;
    return transfer;
  }

  /**
   * Get a transfer by ID.
   */
  getTransfer(transferId: string): TransferResult | null {
    return this.transfers.get(transferId) ?? null;
  }

  /**
   * Get all transfers.
   */
  getAllTransfers(): TransferResult[] {
    return Array.from(this.transfers.values());
  }

  /**
   * Reset state (for testing).
   */
  reset(): void {
    this.accounts.clear();
    this.transfers.clear();
  }
}
