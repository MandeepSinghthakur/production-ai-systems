// Outbox pattern implementation for reliable messaging.
// Ensures atomicity between database writes and message publishing.

import type {
  OutboxEntry,
  OutboxState,
  OutboxConfig,
  DeliveryAttempt,
  TransactionMetrics,
  DEFAULT_OUTBOX_CONFIG,
} from './types.ts';

/**
 * Result of creating an outbox entry.
 */
export interface CreateEntryResult {
  success: boolean;
  entryId: string;
  idempotencyKey: string;
}

/**
 * Result of publishing an outbox entry.
 */
export interface PublishResult {
  success: boolean;
  entryId: string;
  attempts: number;
  error: string | null;
  durationMs: number;
}

/**
 * Message handler for published events.
 */
export type MessageHandler = (entry: OutboxEntry) => Promise<boolean>;

/**
 * Simulated database for outbox pattern demonstration.
 * In production, this would be your actual database.
 */
class OutboxDatabase {
  private entries: Map<string, OutboxEntry>;
  private domainData: Map<string, unknown>;
  private transactionLog: Array<{
    type: string;
    entryId: string;
    domainId: string;
    timestamp: number;
  }>;
  private inTransaction: boolean;
  private pendingEntries: OutboxEntry[];
  private pendingDomainData: Map<string, unknown>;

  constructor() {
    this.entries = new Map();
    this.domainData = new Map();
    this.transactionLog = [];
    this.inTransaction = false;
    this.pendingEntries = [];
    this.pendingDomainData = new Map();
  }

  /**
   * Begin a transaction. All writes until commit/rollback are staged.
   */
  beginTransaction(): void {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }
    this.inTransaction = true;
    this.pendingEntries = [];
    this.pendingDomainData = new Map();
  }

  /**
   * Commit the transaction atomically.
   */
  commit(): void {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    // Atomically apply all pending changes
    for (const entry of this.pendingEntries) {
      this.entries.set(entry.id, entry);
      this.transactionLog.push({
        type: 'outbox_entry',
        entryId: entry.id,
        domainId: entry.aggregateId,
        timestamp: Date.now(),
      });
    }

    for (const [key, value] of this.pendingDomainData) {
      this.domainData.set(key, value);
    }

    this.inTransaction = false;
    this.pendingEntries = [];
    this.pendingDomainData = new Map();
  }

  /**
   * Rollback the transaction.
   */
  rollback(): void {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }
    this.inTransaction = false;
    this.pendingEntries = [];
    this.pendingDomainData = new Map();
  }

  /**
   * Insert an outbox entry (within transaction).
   */
  insertEntry(entry: OutboxEntry): void {
    if (!this.inTransaction) {
      throw new Error('Must be in transaction');
    }
    this.pendingEntries.push({ ...entry });
  }

  /**
   * Insert domain data (within transaction).
   */
  insertDomainData(id: string, data: unknown): void {
    if (!this.inTransaction) {
      throw new Error('Must be in transaction');
    }
    this.pendingDomainData.set(id, data);
  }

  /**
   * Get pending outbox entries ready for publishing.
   */
  getPendingEntries(limit: number): OutboxEntry[] {
    const pending: OutboxEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.state === 'pending' && pending.length < limit) {
        pending.push({ ...entry });
      }
    }
    // Sort by creation time for ordering
    pending.sort((a, b) => a.createdAt - b.createdAt);
    return pending;
  }

  /**
   * Mark an entry as published.
   */
  markPublished(entryId: string): void {
    const entry = this.entries.get(entryId);
    if (entry) {
      entry.state = 'published';
      entry.publishedAt = Date.now();
    }
  }

  /**
   * Mark an entry as failed.
   */
  markFailed(entryId: string, error: string): void {
    const entry = this.entries.get(entryId);
    if (entry) {
      entry.attempts++;
      entry.lastError = error;
      if (entry.attempts >= 5) {
        entry.state = 'failed';
      }
    }
  }

  /**
   * Get an entry by ID.
   */
  getEntry(entryId: string): OutboxEntry | null {
    const entry = this.entries.get(entryId);
    return entry ? { ...entry } : null;
  }

  /**
   * Get domain data by ID.
   */
  getDomainData(id: string): unknown {
    return this.domainData.get(id);
  }

  /**
   * Get all entries for testing.
   */
  getAllEntries(): OutboxEntry[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }

  /**
   * Get transaction log for verification.
   */
  getTransactionLog(): typeof this.transactionLog {
    return [...this.transactionLog];
  }

  /**
   * Check if transaction is active.
   */
  isInTransaction(): boolean {
    return this.inTransaction;
  }
}

/**
 * Outbox pattern implementation.
 *
 * The outbox pattern ensures exactly-once message delivery by:
 * 1. Writing the message to an outbox table in the same transaction
 *    as the domain data change.
 * 2. A separate publisher polls the outbox and publishes messages.
 * 3. After successful publish, the outbox entry is marked as published.
 *
 * This guarantees that either:
 * - Both the domain change and the message are persisted, or
 * - Neither is persisted (transaction rollback).
 */
export class Outbox {
  private db: OutboxDatabase;
  private config: OutboxConfig;
  private handler: MessageHandler | null;
  private metrics: TransactionMetrics;
  private deliveryAttempts: DeliveryAttempt[];
  private idempotencyStore: Map<string, string>;
  private running: boolean;
  private pollTimeout: ReturnType<typeof setTimeout> | null;

  constructor(config?: Partial<OutboxConfig>) {
    this.db = new OutboxDatabase();
    this.config = {
      pollIntervalMs: config?.pollIntervalMs ?? 1000,
      batchSize: config?.batchSize ?? 100,
      maxAttempts: config?.maxAttempts ?? 5,
      retryDelayMs: config?.retryDelayMs ?? 1000,
    };
    this.handler = null;
    this.metrics = this.createEmptyMetrics();
    this.deliveryAttempts = [];
    this.idempotencyStore = new Map();
    this.running = false;
    this.pollTimeout = null;
  }

  private createEmptyMetrics(): TransactionMetrics {
    return {
      outboxEntriesCreated: 0,
      outboxEntriesPublished: 0,
      outboxEntriesFailed: 0,
      sagasStarted: 0,
      sagasCompleted: 0,
      sagasFailed: 0,
      compensationsTriggered: 0,
      compensationsCompleted: 0,
      duplicatesDetected: 0,
      avgPublishLatencyMs: 0,
      avgSagaDurationMs: 0,
    };
  }

  /**
   * Execute a transactional operation that writes both domain data
   * and an outbox entry atomically.
   */
  executeTransaction<T>(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    domainData: T,
    idempotencyKey: string
  ): CreateEntryResult {
    // Check for idempotent duplicate
    const existingId = this.idempotencyStore.get(idempotencyKey);
    if (existingId) {
      this.metrics.duplicatesDetected++;
      return {
        success: true,
        entryId: existingId,
        idempotencyKey,
      };
    }

    const entryId = `outbox_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const entry: OutboxEntry = {
      id: entryId,
      aggregateType,
      aggregateId,
      eventType,
      payload: domainData,
      state: 'pending',
      createdAt: Date.now(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
      idempotencyKey,
    };

    try {
      this.db.beginTransaction();
      this.db.insertDomainData(aggregateId, domainData);
      this.db.insertEntry(entry);
      this.db.commit();

      this.idempotencyStore.set(idempotencyKey, entryId);
      this.metrics.outboxEntriesCreated++;

      return {
        success: true,
        entryId,
        idempotencyKey,
      };
    } catch (error) {
      this.db.rollback();
      throw error;
    }
  }

  /**
   * Register a message handler for publishing.
   */
  setHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Start the outbox publisher.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  /**
   * Stop the outbox publisher.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Poll for pending entries and publish them.
   */
  private poll(): void {
    if (!this.running) return;

    this.publishPending();

    this.pollTimeout = setTimeout(
      () => this.poll(),
      this.config.pollIntervalMs
    );
  }

  /**
   * Publish all pending entries.
   */
  async publishPending(): Promise<PublishResult[]> {
    const entries = this.db.getPendingEntries(this.config.batchSize);
    const results: PublishResult[] = [];

    for (const entry of entries) {
      const result = await this.publishEntry(entry);
      results.push(result);
    }

    return results;
  }

  /**
   * Publish a single outbox entry.
   */
  private async publishEntry(entry: OutboxEntry): Promise<PublishResult> {
    if (!this.handler) {
      return {
        success: false,
        entryId: entry.id,
        attempts: entry.attempts + 1,
        error: 'No handler registered',
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      const success = await this.handler(entry);
      const durationMs = Date.now() - startTime;

      const attempt: DeliveryAttempt = {
        outboxEntryId: entry.id,
        attemptNumber: entry.attempts + 1,
        timestamp: Date.now(),
        success,
        error: success ? null : 'Handler returned false',
        durationMs,
      };
      this.deliveryAttempts.push(attempt);

      if (success) {
        this.db.markPublished(entry.id);
        this.metrics.outboxEntriesPublished++;
        this.updateAvgLatency(durationMs);

        return {
          success: true,
          entryId: entry.id,
          attempts: entry.attempts + 1,
          error: null,
          durationMs,
        };
      } else {
        this.db.markFailed(entry.id, 'Handler returned false');
        const updatedEntry = this.db.getEntry(entry.id);
        if (updatedEntry?.state === 'failed') {
          this.metrics.outboxEntriesFailed++;
        }

        return {
          success: false,
          entryId: entry.id,
          attempts: entry.attempts + 1,
          error: 'Handler returned false',
          durationMs,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const attempt: DeliveryAttempt = {
        outboxEntryId: entry.id,
        attemptNumber: entry.attempts + 1,
        timestamp: Date.now(),
        success: false,
        error: errorMessage,
        durationMs,
      };
      this.deliveryAttempts.push(attempt);

      this.db.markFailed(entry.id, errorMessage);
      const updatedEntry = this.db.getEntry(entry.id);
      if (updatedEntry?.state === 'failed') {
        this.metrics.outboxEntriesFailed++;
      }

      return {
        success: false,
        entryId: entry.id,
        attempts: entry.attempts + 1,
        error: errorMessage,
        durationMs,
      };
    }
  }

  private updateAvgLatency(latencyMs: number): void {
    const alpha = 0.1;
    this.metrics.avgPublishLatencyMs =
      alpha * latencyMs + (1 - alpha) * this.metrics.avgPublishLatencyMs;
  }

  /**
   * Force publish a specific entry (for testing/recovery).
   */
  async forcePublish(entryId: string): Promise<PublishResult> {
    const entry = this.db.getEntry(entryId);
    if (!entry) {
      return {
        success: false,
        entryId,
        attempts: 0,
        error: 'Entry not found',
        durationMs: 0,
      };
    }
    return this.publishEntry(entry);
  }

  /**
   * Get an outbox entry by ID.
   */
  getEntry(entryId: string): OutboxEntry | null {
    return this.db.getEntry(entryId);
  }

  /**
   * Get all outbox entries.
   */
  getAllEntries(): OutboxEntry[] {
    return this.db.getAllEntries();
  }

  /**
   * Get pending entries.
   */
  getPendingEntries(): OutboxEntry[] {
    return this.db.getPendingEntries(this.config.batchSize);
  }

  /**
   * Get domain data.
   */
  getDomainData(id: string): unknown {
    return this.db.getDomainData(id);
  }

  /**
   * Get transaction log for verification.
   */
  getTransactionLog(): Array<{
    type: string;
    entryId: string;
    domainId: string;
    timestamp: number;
  }> {
    return this.db.getTransactionLog();
  }

  /**
   * Get delivery attempts for an entry.
   */
  getDeliveryAttempts(entryId: string): DeliveryAttempt[] {
    return this.deliveryAttempts.filter((a) => a.outboxEntryId === entryId);
  }

  /**
   * Get metrics.
   */
  getMetrics(): TransactionMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if database is in transaction.
   */
  isInTransaction(): boolean {
    return this.db.isInTransaction();
  }
}
