// Idempotency patterns for event-driven AI systems.
// Ensures that processing the same event multiple times produces
// the same result as processing it once.

import type {
  Event,
  CommandResult,
  ConversationCommand,
  IdempotencyKey,
  IdempotencyResult,
} from './types.ts';

/**
 * Generate an idempotency key from a command.
 *
 * The key should be deterministic: the same command always produces
 * the same key. Include all fields that affect the outcome.
 */
export function generateIdempotencyKey(command: ConversationCommand): string {
  const components: string[] = [command.type];

  switch (command.type) {
    case 'start_conversation':
      components.push(
        command.conversationId,
        command.tenantId,
        command.userId,
        command.tier,
        command.systemPrompt
      );
      break;

    case 'send_message':
      components.push(
        command.conversationId,
        command.role,
        command.content,
        String(command.inputTokens ?? ''),
        String(command.outputTokens ?? '')
      );
      break;

    case 'change_tier':
      components.push(
        command.conversationId,
        command.newTier,
        command.reason
      );
      break;

    case 'end_conversation':
      components.push(command.conversationId, command.reason);
      break;
  }

  // Simple hash - in production, use crypto.subtle.digest
  return simpleHash(components.join(':'));
}

/**
 * Simple string hash for idempotency keys.
 * Not cryptographic - just for deduplication.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `idem_${Math.abs(hash).toString(36)}`;
}

/**
 * In-memory idempotency store.
 *
 * Tracks which commands have been processed and their results.
 * Entries expire after a TTL to prevent unbounded growth.
 */
export class InMemoryIdempotencyStore {
  private entries: Map<string, IdempotencyEntry>;
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 24 * 60 * 60 * 1000) { // 24 hours
    this.entries = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Check if a command has already been processed.
   *
   * Returns the previous result if found, allowing the caller
   * to return the same response without re-executing.
   */
  check(key: string): IdempotencyResult {
    const entry = this.entries.get(key);

    if (!entry) {
      return { isDuplicate: false };
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return { isDuplicate: false };
    }

    return {
      isDuplicate: true,
      previousResult: entry.result,
    };
  }

  /**
   * Record that a command has been processed.
   */
  record(key: string, result: CommandResult, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.entries.set(key, {
      key,
      result,
      createdAt: Date.now(),
      expiresAt,
    });
  }

  /**
   * Clean up expired entries.
   *
   * Returns the number of entries removed.
   */
  cleanup(beforeTimestamp?: number): number {
    const cutoff = beforeTimestamp ?? Date.now();
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= cutoff) {
        this.entries.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get current entry count.
   */
  getCount(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries.clear();
  }
}

interface IdempotencyEntry {
  key: string;
  result: CommandResult;
  createdAt: number;
  expiresAt: number;
}

/**
 * Idempotent event processor.
 *
 * Wraps event processing to ensure each event is processed
 * exactly once, even if delivered multiple times.
 */
export class IdempotentEventProcessor {
  private processedEvents: Map<string, ProcessedEventRecord>;
  private retentionMs: number;

  constructor(retentionMs: number = 7 * 24 * 60 * 60 * 1000) { // 7 days
    this.processedEvents = new Map();
    this.retentionMs = retentionMs;
  }

  /**
   * Process an event exactly once.
   *
   * If the event has already been processed, returns the previous
   * result without re-executing the handler.
   */
  async process<T>(
    event: Event,
    handler: (event: Event) => Promise<T>
  ): Promise<{ result: T; wasProcessed: boolean }> {
    // Check if already processed
    const existing = this.processedEvents.get(event.id);
    if (existing && !this.isExpired(existing)) {
      return {
        result: existing.result as T,
        wasProcessed: true,
      };
    }

    // Process the event
    const result = await handler(event);

    // Record as processed
    this.processedEvents.set(event.id, {
      eventId: event.id,
      processedAt: Date.now(),
      result,
    });

    return { result, wasProcessed: false };
  }

  private isExpired(record: ProcessedEventRecord): boolean {
    return Date.now() - record.processedAt > this.retentionMs;
  }

  /**
   * Check if an event has been processed.
   */
  isProcessed(eventId: string): boolean {
    const record = this.processedEvents.get(eventId);
    return record !== undefined && !this.isExpired(record);
  }

  /**
   * Clean up expired records.
   */
  cleanup(): number {
    const cutoff = Date.now() - this.retentionMs;
    let removed = 0;

    for (const [id, record] of this.processedEvents) {
      if (record.processedAt < cutoff) {
        this.processedEvents.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get stats.
   */
  getStats(): { totalProcessed: number; activeRecords: number } {
    return {
      totalProcessed: this.processedEvents.size,
      activeRecords: Array.from(this.processedEvents.values()).filter(
        (r) => !this.isExpired(r)
      ).length,
    };
  }
}

interface ProcessedEventRecord {
  eventId: string;
  processedAt: number;
  result: unknown;
}

/**
 * Deduplication window for events.
 *
 * Uses a sliding window to detect duplicates within a time period.
 * More memory-efficient than storing all event IDs indefinitely.
 */
export class DeduplicationWindow {
  private buckets: Map<number, Set<string>>;
  private bucketSizeMs: number;
  private windowMs: number;

  constructor(
    windowMs: number = 60 * 1000,     // 1 minute window
    bucketSizeMs: number = 10 * 1000   // 10 second buckets
  ) {
    this.buckets = new Map();
    this.bucketSizeMs = bucketSizeMs;
    this.windowMs = windowMs;
  }

  /**
   * Check if an event ID is a duplicate within the window.
   * If not a duplicate, adds it to the window.
   */
  checkAndAdd(eventId: string): boolean {
    const now = Date.now();
    const bucket = Math.floor(now / this.bucketSizeMs);

    // Clean old buckets
    this.cleanOldBuckets(now);

    // Check if exists in any bucket
    for (const ids of this.buckets.values()) {
      if (ids.has(eventId)) {
        return true; // Duplicate
      }
    }

    // Add to current bucket
    let currentBucket = this.buckets.get(bucket);
    if (!currentBucket) {
      currentBucket = new Set();
      this.buckets.set(bucket, currentBucket);
    }
    currentBucket.add(eventId);

    return false; // Not a duplicate
  }

  private cleanOldBuckets(now: number): void {
    const oldestBucket = Math.floor((now - this.windowMs) / this.bucketSizeMs);

    for (const bucket of this.buckets.keys()) {
      if (bucket < oldestBucket) {
        this.buckets.delete(bucket);
      }
    }
  }

  /**
   * Get current stats.
   */
  getStats(): { buckets: number; totalIds: number } {
    let totalIds = 0;
    for (const ids of this.buckets.values()) {
      totalIds += ids.size;
    }
    return { buckets: this.buckets.size, totalIds };
  }
}

/**
 * Event ordering enforcer.
 *
 * Ensures events are processed in the correct order by tracking
 * the last processed version for each aggregate.
 */
export class EventOrderingEnforcer {
  private lastProcessedVersions: Map<string, number>;
  private outOfOrderEvents: Map<string, Event[]>;

  constructor() {
    this.lastProcessedVersions = new Map();
    this.outOfOrderEvents = new Map();
  }

  /**
   * Check if an event can be processed now.
   *
   * An event can be processed if its version is exactly one more
   * than the last processed version for its aggregate.
   */
  canProcess(event: Event): boolean {
    const lastVersion =
      this.lastProcessedVersions.get(event.aggregateId) ?? 0;
    return event.version === lastVersion + 1;
  }

  /**
   * Mark an event as processed.
   */
  markProcessed(event: Event): void {
    this.lastProcessedVersions.set(event.aggregateId, event.version);
  }

  /**
   * Buffer an out-of-order event for later processing.
   */
  buffer(event: Event): void {
    let buffered = this.outOfOrderEvents.get(event.aggregateId);
    if (!buffered) {
      buffered = [];
      this.outOfOrderEvents.set(event.aggregateId, buffered);
    }
    buffered.push(event);
    // Keep sorted by version
    buffered.sort((a, b) => a.version - b.version);
  }

  /**
   * Get events that can now be processed after processing an event.
   */
  getReadyEvents(aggregateId: string): Event[] {
    const ready: Event[] = [];
    const buffered = this.outOfOrderEvents.get(aggregateId) ?? [];
    const lastVersion =
      this.lastProcessedVersions.get(aggregateId) ?? 0;

    // Find contiguous events that can be processed
    while (
      buffered.length > 0 &&
      buffered[0].version === lastVersion + ready.length + 1
    ) {
      ready.push(buffered.shift()!);
    }

    return ready;
  }

  /**
   * Get the expected next version for an aggregate.
   */
  getExpectedVersion(aggregateId: string): number {
    return (this.lastProcessedVersions.get(aggregateId) ?? 0) + 1;
  }

  /**
   * Get stats.
   */
  getStats(): {
    aggregatesTracked: number;
    totalBuffered: number;
  } {
    let totalBuffered = 0;
    for (const events of this.outOfOrderEvents.values()) {
      totalBuffered += events.length;
    }
    return {
      aggregatesTracked: this.lastProcessedVersions.size,
      totalBuffered,
    };
  }
}
