// Compensation actions for saga rollback.
// Handles partial failure recovery in distributed transactions.

import type { SagaStepDefinition, StepResult, CompensationResult } from './types.ts';

/**
 * Compensation strategy types.
 */
export type CompensationStrategy =
  | 'immediate'      // Compensate immediately on failure
  | 'batch'          // Batch compensations for efficiency
  | 'scheduled'      // Schedule compensation for later
  | 'manual';        // Require manual intervention

/**
 * Compensation record for audit.
 */
export interface CompensationRecord {
  id: string;
  sagaId: string;
  stepName: string;
  strategy: CompensationStrategy;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  attempts: number;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
  context: Record<string, unknown>;
}

/**
 * Result of a compensation check.
 */
export interface CompensationCheck {
  required: boolean;
  reason: string;
  strategy: CompensationStrategy;
}

/**
 * Compensation handler that manages rollback actions.
 *
 * Key responsibilities:
 * 1. Determine if compensation is needed
 * 2. Execute compensations in the correct order
 * 3. Handle compensation failures (which are critical)
 * 4. Maintain audit trail for compliance
 */
export class CompensationHandler {
  private records: Map<string, CompensationRecord>;
  private strategies: Map<string, CompensationStrategy>;
  private retentionMs: number;

  constructor(retentionMs: number = 7 * 24 * 60 * 60 * 1000) {
    this.records = new Map();
    this.strategies = new Map();
    this.retentionMs = retentionMs;
  }

  /**
   * Register a compensation strategy for a step.
   */
  registerStrategy(stepName: string, strategy: CompensationStrategy): void {
    this.strategies.set(stepName, strategy);
  }

  /**
   * Check if compensation is required for a step.
   */
  checkCompensation(
    stepName: string,
    stepOutput: unknown,
    error: string | null
  ): CompensationCheck {
    // If step succeeded, no compensation needed
    if (!error) {
      return {
        required: false,
        reason: 'Step completed successfully',
        strategy: 'immediate',
      };
    }

    const strategy = this.strategies.get(stepName) ?? 'immediate';

    // Check if the step produced output that needs reversal
    if (stepOutput) {
      return {
        required: true,
        reason: 'Step produced output before failure',
        strategy,
      };
    }

    // Check specific error types
    if (error.includes('timeout')) {
      return {
        required: true,
        reason: 'Timeout may have left partial state',
        strategy: 'manual', // Timeouts need manual verification
      };
    }

    if (error.includes('network')) {
      return {
        required: true,
        reason: 'Network error may have left partial state',
        strategy: 'scheduled', // Retry after network recovery
      };
    }

    return {
      required: true,
      reason: 'Step failed after execution started',
      strategy,
    };
  }

  /**
   * Create a compensation record.
   */
  createRecord(
    sagaId: string,
    stepName: string,
    strategy: CompensationStrategy,
    context: Record<string, unknown>
  ): CompensationRecord {
    const id = `comp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const record: CompensationRecord = {
      id,
      sagaId,
      stepName,
      strategy,
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
      completedAt: null,
      error: null,
      context: { ...context },
    };

    this.records.set(id, record);
    return { ...record };
  }

  /**
   * Execute a compensation with retry logic.
   */
  async executeCompensation(
    recordId: string,
    compensate: (context: Record<string, unknown>) => Promise<CompensationResult>,
    maxAttempts: number = 3
  ): Promise<CompensationResult> {
    const record = this.records.get(recordId);
    if (!record) {
      return { success: false, error: 'Compensation record not found' };
    }

    record.status = 'in_progress';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      record.attempts++;

      try {
        const result = await compensate(record.context);

        if (result.success) {
          record.status = 'completed';
          record.completedAt = Date.now();
          return result;
        }

        record.error = result.error ?? 'Compensation returned false';
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
      }

      // Exponential backoff between retries
      if (attempt < maxAttempts - 1) {
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    record.status = 'failed';
    return { success: false, error: record.error ?? 'Max attempts exceeded' };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get all compensation records for a saga.
   */
  getRecordsForSaga(sagaId: string): CompensationRecord[] {
    return Array.from(this.records.values())
      .filter((r) => r.sagaId === sagaId)
      .map((r) => ({ ...r }));
  }

  /**
   * Get pending compensations.
   */
  getPendingCompensations(): CompensationRecord[] {
    return Array.from(this.records.values())
      .filter((r) => r.status === 'pending')
      .map((r) => ({ ...r }));
  }

  /**
   * Get failed compensations (require manual intervention).
   */
  getFailedCompensations(): CompensationRecord[] {
    return Array.from(this.records.values())
      .filter((r) => r.status === 'failed')
      .map((r) => ({ ...r }));
  }

  /**
   * Clean up old records.
   */
  cleanup(): number {
    const cutoff = Date.now() - this.retentionMs;
    let removed = 0;

    for (const [id, record] of this.records) {
      if (record.completedAt && record.completedAt < cutoff) {
        this.records.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get a compensation record.
   */
  getRecord(recordId: string): CompensationRecord | null {
    const record = this.records.get(recordId);
    return record ? { ...record } : null;
  }

  /**
   * Get all records.
   */
  getAllRecords(): CompensationRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }
}

/**
 * Idempotent compensation wrapper.
 * Ensures compensation actions are safe to retry.
 */
export class IdempotentCompensation {
  private executed: Map<string, { timestamp: number; result: CompensationResult }>;
  private ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.executed = new Map();
    this.ttlMs = ttlMs;
  }

  /**
   * Execute a compensation action idempotently.
   */
  async execute(
    key: string,
    action: () => Promise<CompensationResult>
  ): Promise<CompensationResult> {
    // Check if already executed
    const existing = this.executed.get(key);
    if (existing && Date.now() - existing.timestamp < this.ttlMs) {
      return existing.result;
    }

    const result = await action();

    if (result.success) {
      this.executed.set(key, { timestamp: Date.now(), result });
    }

    return result;
  }

  /**
   * Check if a compensation was already executed.
   */
  wasExecuted(key: string): boolean {
    const existing = this.executed.get(key);
    return existing !== undefined && Date.now() - existing.timestamp < this.ttlMs;
  }

  /**
   * Clear expired entries.
   */
  cleanup(): number {
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;

    for (const [key, value] of this.executed) {
      if (value.timestamp < cutoff) {
        this.executed.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get execution count (for testing).
   */
  getExecutionCount(): number {
    return this.executed.size;
  }
}

/**
 * Semantic compensation for LLM operations.
 *
 * Some LLM operations cannot be truly compensated (you cannot
 * "un-generate" text), but we can perform semantic compensations
 * that achieve the business goal.
 */
export class SemanticCompensation {
  /**
   * For a failed document processing saga, semantic compensation
   * might mean marking the document as unprocessed rather than
   * deleting any partial results.
   */
  static createDocumentCompensation(): SagaStepDefinition {
    return {
      name: 'process_document',
      execute: async (context) => {
        const documentId = context.documentId as string;
        const processor = context.processor as {
          process: (id: string) => Promise<{ chunks: number }>;
        };

        try {
          const result = await processor.process(documentId);
          return { success: true, output: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      compensate: async (context) => {
        const documentId = context.documentId as string;
        const statusUpdater = context.statusUpdater as {
          markFailed: (id: string, reason: string) => void;
        };

        // Semantic compensation: mark as failed, don't delete
        statusUpdater.markFailed(
          documentId,
          'Processing failed, compensation applied'
        );
        return { success: true };
      },
    };
  }

  /**
   * For a failed billing saga, semantic compensation ensures
   * the customer is not charged and any holds are released.
   */
  static createBillingCompensation(): SagaStepDefinition {
    return {
      name: 'charge_customer',
      execute: async (context) => {
        const customerId = context.customerId as string;
        const amount = context.amount as number;
        const billing = context.billing as {
          charge: (id: string, amount: number) => Promise<string>;
        };

        try {
          const chargeId = await billing.charge(customerId, amount);
          return { success: true, output: { chargeId } };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      compensate: async (context) => {
        const result = context.charge_customer_result as
          | { chargeId: string }
          | undefined;
        const billing = context.billing as {
          refund: (chargeId: string) => Promise<void>;
          releaseHold: (customerId: string) => Promise<void>;
        };
        const customerId = context.customerId as string;

        try {
          if (result?.chargeId) {
            await billing.refund(result.chargeId);
          } else {
            // No charge was made, but release any holds
            await billing.releaseHold(customerId);
          }
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }
}
