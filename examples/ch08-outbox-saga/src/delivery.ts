// Delivery guarantees for distributed AI systems.
// Implements at-least-once with idempotency for effective exactly-once.

import type { IdempotencyRecord, TransactionMetrics } from './types.ts';

/**
 * Result of processing with delivery guarantees.
 */
export interface DeliveryResult {
  success: boolean;
  isNew: boolean;
  isDuplicate: boolean;
  response: unknown;
  error: string | null;
  processingTimeMs: number;
}

/**
 * Idempotency store for deduplication.
 *
 * The key insight: true exactly-once is impossible in distributed systems.
 * What we can achieve is "effectively exactly-once" through:
 * 1. At-least-once delivery (retries ensure delivery)
 * 2. Idempotent processing (duplicates produce same result)
 *
 * The store tracks processed requests by idempotency key and returns
 * the cached response for duplicates.
 */
export class IdempotencyStore {
  private records: Map<string, IdempotencyRecord>;
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 24 * 60 * 60 * 1000) {
    this.records = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Check if a request was already processed.
   */
  get(key: string): IdempotencyRecord | null {
    const record = this.records.get(key);
    if (!record) {
      return null;
    }

    // Check expiration
    if (Date.now() > record.expiresAt) {
      this.records.delete(key);
      return null;
    }

    return { ...record };
  }

  /**
   * Store a processed request.
   */
  set(key: string, response: unknown, ttlMs?: number): void {
    const now = Date.now();
    this.records.set(key, {
      key,
      response,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /**
   * Check if a key exists (without returning the full record).
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete a record.
   */
  delete(key: string): boolean {
    return this.records.delete(key);
  }

  /**
   * Clean up expired records.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, record] of this.records) {
      if (now > record.expiresAt) {
        this.records.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the count of active records.
   */
  size(): number {
    return this.records.size;
  }
}

/**
 * Request handler type.
 */
export type RequestHandler<T, R> = (request: T) => Promise<R>;

/**
 * Idempotency key generator type.
 */
export type KeyGenerator<T> = (request: T) => string;

/**
 * Idempotent processor that wraps request handling.
 *
 * Usage pattern:
 * 1. Generate idempotency key from request content
 * 2. Check if key exists in store (duplicate detection)
 * 3. If duplicate, return cached response
 * 4. If new, process and store response
 *
 * This ensures that retries due to network errors or consumer
 * restarts do not cause duplicate processing.
 */
export class IdempotentProcessor<T, R> {
  private store: IdempotencyStore;
  private keyGenerator: KeyGenerator<T>;
  private handler: RequestHandler<T, R>;
  private metrics: TransactionMetrics;

  constructor(
    keyGenerator: KeyGenerator<T>,
    handler: RequestHandler<T, R>,
    ttlMs?: number
  ) {
    this.store = new IdempotencyStore(ttlMs);
    this.keyGenerator = keyGenerator;
    this.handler = handler;
    this.metrics = this.createEmptyMetrics();
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
   * Process a request idempotently.
   */
  async process(request: T): Promise<DeliveryResult> {
    const startTime = Date.now();
    const key = this.keyGenerator(request);

    // Check for duplicate
    const existing = this.store.get(key);
    if (existing) {
      this.metrics.duplicatesDetected++;
      return {
        success: true,
        isNew: false,
        isDuplicate: true,
        response: existing.response,
        error: null,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Process new request
    try {
      const response = await this.handler(request);
      this.store.set(key, response);

      return {
        success: true,
        isNew: true,
        isDuplicate: false,
        response,
        error: null,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Do not store failed responses - allow retry
      return {
        success: false,
        isNew: true,
        isDuplicate: false,
        response: null,
        error: errorMessage,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get metrics.
   */
  getMetrics(): TransactionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get store size.
   */
  getStoreSize(): number {
    return this.store.size();
  }

  /**
   * Clean up expired records.
   */
  cleanup(): number {
    return this.store.cleanup();
  }
}

/**
 * Exactly-once delivery coordinator.
 *
 * Combines multiple patterns to achieve effective exactly-once:
 * 1. Idempotent producer (outbox with dedup)
 * 2. At-least-once delivery (retries)
 * 3. Idempotent consumer (this class)
 *
 * The key insight: true exactly-once requires consensus across all
 * participants, which is expensive. Effective exactly-once through
 * idempotency is cheaper and sufficient for most use cases.
 */
export class ExactlyOnceCoordinator {
  private producerIdempotency: IdempotencyStore;
  private consumerIdempotency: IdempotencyStore;
  private inFlight: Map<string, {
    key: string;
    startedAt: number;
    attempts: number;
  }>;
  private metrics: TransactionMetrics;
  private maxAttempts: number;
  private timeoutMs: number;

  constructor(maxAttempts: number = 5, timeoutMs: number = 30000) {
    this.producerIdempotency = new IdempotencyStore();
    this.consumerIdempotency = new IdempotencyStore();
    this.inFlight = new Map();
    this.metrics = this.createEmptyMetrics();
    this.maxAttempts = maxAttempts;
    this.timeoutMs = timeoutMs;
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
   * Send a message with exactly-once semantics.
   *
   * Returns immediately with a tracking ID. The actual delivery
   * happens asynchronously with retries.
   */
  send(
    key: string,
    payload: unknown,
    handler: (payload: unknown) => Promise<unknown>
  ): {
    trackingId: string;
    isDuplicate: boolean;
  } {
    // Check producer idempotency
    const existing = this.producerIdempotency.get(key);
    if (existing) {
      this.metrics.duplicatesDetected++;
      return {
        trackingId: existing.response as string,
        isDuplicate: true,
      };
    }

    const trackingId = `track_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Store producer record
    this.producerIdempotency.set(key, trackingId);

    // Start delivery
    this.inFlight.set(trackingId, {
      key,
      startedAt: Date.now(),
      attempts: 0,
    });

    // Schedule delivery (not awaited)
    this.deliverWithRetry(trackingId, payload, handler);

    return { trackingId, isDuplicate: false };
  }

  /**
   * Deliver with retries until success or max attempts.
   */
  private async deliverWithRetry(
    trackingId: string,
    payload: unknown,
    handler: (payload: unknown) => Promise<unknown>
  ): Promise<void> {
    const flight = this.inFlight.get(trackingId);
    if (!flight) return;

    while (flight.attempts < this.maxAttempts) {
      flight.attempts++;

      try {
        const result = await handler(payload);

        // Store consumer idempotency
        this.consumerIdempotency.set(flight.key, result);

        // Remove from in-flight
        this.inFlight.delete(trackingId);

        this.metrics.outboxEntriesPublished++;
        return;
      } catch {
        // Exponential backoff
        if (flight.attempts < this.maxAttempts) {
          await this.delay(Math.pow(2, flight.attempts - 1) * 1000);
        }
      }
    }

    // Max attempts reached
    this.inFlight.delete(trackingId);
    this.metrics.outboxEntriesFailed++;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Receive and process a message idempotently.
   */
  async receive(
    key: string,
    payload: unknown,
    handler: (payload: unknown) => Promise<unknown>
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    // Check consumer idempotency
    const existing = this.consumerIdempotency.get(key);
    if (existing) {
      this.metrics.duplicatesDetected++;
      return {
        success: true,
        isNew: false,
        isDuplicate: true,
        response: existing.response,
        error: null,
        processingTimeMs: Date.now() - startTime,
      };
    }

    try {
      const result = await handler(payload);
      this.consumerIdempotency.set(key, result);

      return {
        success: true,
        isNew: true,
        isDuplicate: false,
        response: result,
        error: null,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        isNew: true,
        isDuplicate: false,
        response: null,
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get the status of a sent message.
   */
  getStatus(trackingId: string): {
    status: 'in_flight' | 'delivered' | 'unknown';
    attempts: number;
  } {
    const flight = this.inFlight.get(trackingId);
    if (flight) {
      return { status: 'in_flight', attempts: flight.attempts };
    }

    // Check if it was delivered (exists in consumer store)
    // This is a simplification - in production you'd track delivery status
    return { status: 'unknown', attempts: 0 };
  }

  /**
   * Get metrics.
   */
  getMetrics(): TransactionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get in-flight count.
   */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Get timed out messages.
   */
  getTimedOut(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [trackingId, flight] of this.inFlight) {
      if (now - flight.startedAt > this.timeoutMs) {
        timedOut.push(trackingId);
      }
    }

    return timedOut;
  }
}

/**
 * Dead letter queue for failed deliveries.
 */
export interface DeadLetterEntry {
  id: string;
  key: string;
  payload: unknown;
  attempts: number;
  lastError: string;
  createdAt: number;
}

/**
 * Dead letter handler for undeliverable messages.
 */
export class DeadLetterHandler {
  private entries: Map<string, DeadLetterEntry>;
  private retentionMs: number;

  constructor(retentionMs: number = 7 * 24 * 60 * 60 * 1000) {
    this.entries = new Map();
    this.retentionMs = retentionMs;
  }

  /**
   * Add a message to the dead letter queue.
   */
  add(key: string, payload: unknown, attempts: number, error: string): string {
    const id = `dlq_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.entries.set(id, {
      id,
      key,
      payload,
      attempts,
      lastError: error,
      createdAt: Date.now(),
    });

    return id;
  }

  /**
   * Get an entry by ID.
   */
  get(id: string): DeadLetterEntry | null {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : null;
  }

  /**
   * Get all entries.
   */
  getAll(): DeadLetterEntry[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e }));
  }

  /**
   * Replay an entry.
   */
  async replay(
    id: string,
    handler: (payload: unknown) => Promise<unknown>
  ): Promise<{ success: boolean; error: string | null }> {
    const entry = this.entries.get(id);
    if (!entry) {
      return { success: false, error: 'Entry not found' };
    }

    try {
      await handler(entry.payload);
      this.entries.delete(id);
      return { success: true, error: null };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      entry.lastError = errorMessage;
      entry.attempts++;
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Delete an entry (after manual handling).
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Get entry count.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Clean up old entries.
   */
  cleanup(): number {
    const cutoff = Date.now() - this.retentionMs;
    let removed = 0;

    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    return removed;
  }
}
