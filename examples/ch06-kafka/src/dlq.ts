// Dead Letter Queue handler for failed messages.
// Captures context needed for debugging and replay.

import type { Message, DLQEntry, LLMRequest } from './types.ts';
import { KafkaSimulator } from './simulator.ts';

/**
 * Reason categories for DLQ routing.
 */
export type DLQReason =
  | 'max_retries_exceeded'
  | 'non_retriable_error'
  | 'timeout'
  | 'poison_message'
  | 'deserialization_error'
  | 'unknown';

/**
 * DLQ entry with categorized reason.
 */
export interface CategorizedDLQEntry extends DLQEntry {
  reasonCategory: DLQReason;
}

/**
 * Statistics about DLQ contents.
 */
export interface DLQStats {
  totalEntries: number;
  byReason: Record<DLQReason, number>;
  byTenant: Record<string, number>;
  byWorkload: Record<string, number>;
  oldestEntryAge: number | null;
  newestEntryAge: number | null;
}

/**
 * Result of a replay attempt.
 */
export interface ReplayResult {
  messageId: string;
  success: boolean;
  newMessageId: string | null;
  error: string | null;
}

/**
 * Dead Letter Queue handler.
 *
 * Responsibilities:
 * 1. Categorize failures for debugging
 * 2. Enable replay of failed messages
 * 3. Provide statistics for monitoring
 * 4. Support alerting on DLQ growth
 */
export class DLQHandler {
  private kafka: KafkaSimulator;
  private dlqTopic: string;

  constructor(kafka: KafkaSimulator, dlqTopic: string) {
    this.kafka = kafka;
    this.dlqTopic = dlqTopic;

    // Ensure DLQ topic exists
    this.kafka.createTopic({
      name: dlqTopic,
      partitions: 1, // Single partition for DLQ - ordering matters for debugging
      replicationFactor: 3,
      retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  /**
   * Get all DLQ entries with categorized reasons.
   */
  getEntries(): CategorizedDLQEntry[] {
    const entries = this.kafka.getDLQEntries();
    return entries.map((entry) => ({
      ...entry,
      reasonCategory: this.categorizeReason(entry.failureReason),
    }));
  }

  /**
   * Categorize a failure reason for reporting.
   */
  private categorizeReason(reason: string): DLQReason {
    const reasonLower = reason.toLowerCase();

    if (reasonLower.includes('timeout')) {
      return 'timeout';
    }
    if (reasonLower.includes('deserializ') || reasonLower.includes('parse')) {
      return 'deserialization_error';
    }
    if (
      reasonLower.includes('bad request') ||
      reasonLower.includes('invalid') ||
      reasonLower.includes('context too long') ||
      reasonLower.includes('content policy')
    ) {
      return 'non_retriable_error';
    }
    if (
      reasonLower.includes('max retries') ||
      reasonLower.includes('exhausted')
    ) {
      return 'max_retries_exceeded';
    }
    if (reasonLower.includes('poison') || reasonLower.includes('corrupt')) {
      return 'poison_message';
    }
    return 'unknown';
  }

  /**
   * Get DLQ statistics for monitoring.
   */
  getStats(): DLQStats {
    const entries = this.getEntries();
    const now = Date.now();

    const stats: DLQStats = {
      totalEntries: entries.length,
      byReason: {
        max_retries_exceeded: 0,
        non_retriable_error: 0,
        timeout: 0,
        poison_message: 0,
        deserialization_error: 0,
        unknown: 0,
      },
      byTenant: {},
      byWorkload: {},
      oldestEntryAge: null,
      newestEntryAge: null,
    };

    for (const entry of entries) {
      // Count by reason
      stats.byReason[entry.reasonCategory]++;

      // Count by tenant
      const tenant = entry.originalMessage.payload.tenant;
      stats.byTenant[tenant] = (stats.byTenant[tenant] ?? 0) + 1;

      // Count by workload
      const workload = entry.originalMessage.payload.workload;
      stats.byWorkload[workload] = (stats.byWorkload[workload] ?? 0) + 1;

      // Track ages
      const age = now - entry.sentToDLQAt;
      if (stats.oldestEntryAge === null || age > stats.oldestEntryAge) {
        stats.oldestEntryAge = age;
      }
      if (stats.newestEntryAge === null || age < stats.newestEntryAge) {
        stats.newestEntryAge = age;
      }
    }

    return stats;
  }

  /**
   * Find entries matching criteria.
   */
  findEntries(criteria: {
    tenant?: string;
    workload?: string;
    reason?: DLQReason;
    maxAge?: number;
  }): CategorizedDLQEntry[] {
    const entries = this.getEntries();
    const now = Date.now();

    return entries.filter((entry) => {
      if (criteria.tenant) {
        if (entry.originalMessage.payload.tenant !== criteria.tenant) {
          return false;
        }
      }
      if (criteria.workload) {
        if (entry.originalMessage.payload.workload !== criteria.workload) {
          return false;
        }
      }
      if (criteria.reason) {
        if (entry.reasonCategory !== criteria.reason) {
          return false;
        }
      }
      if (criteria.maxAge !== undefined) {
        const age = now - entry.sentToDLQAt;
        if (age > criteria.maxAge) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Attempt to replay a DLQ entry back to the main topic.
   *
   * Use with caution:
   * - Only replay after fixing the underlying issue
   * - Non-retriable errors will fail again
   * - Use a new idempotency key to force reprocessing
   */
  replay(
    entry: CategorizedDLQEntry,
    targetTopic: string,
    newIdempotencyKey?: string
  ): ReplayResult {
    const key = newIdempotencyKey ?? `replay_${entry.originalMessage.id}`;

    try {
      const result = this.kafka.produce(
        targetTopic,
        entry.originalMessage.payload,
        key
      );

      return {
        messageId: entry.originalMessage.id,
        success: !result.isDuplicate,
        newMessageId: result.messageId,
        error: result.isDuplicate
          ? 'Duplicate detected - already replayed'
          : null,
      };
    } catch (error) {
      return {
        messageId: entry.originalMessage.id,
        success: false,
        newMessageId: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Replay all entries matching criteria.
   */
  replayMatching(
    criteria: {
      tenant?: string;
      workload?: string;
      reason?: DLQReason;
    },
    targetTopic: string
  ): ReplayResult[] {
    const entries = this.findEntries(criteria);
    return entries.map((entry) =>
      this.replay(entry, targetTopic, `replay_${Date.now()}_${entry.originalMessage.id}`)
    );
  }

  /**
   * Check if DLQ growth rate indicates a problem.
   *
   * Returns true if:
   * - More than threshold entries in the last hour
   * - Rate is accelerating (more recent entries than older)
   */
  isAlertCondition(thresholdPerHour: number): {
    alert: boolean;
    reason: string;
    entriesLastHour: number;
  } {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;

    const entries = this.getEntries();
    const entriesLastHour = entries.filter(
      (e) => e.sentToDLQAt >= oneHourAgo
    ).length;
    const entriesLast30Min = entries.filter(
      (e) => e.sentToDLQAt >= thirtyMinutesAgo
    ).length;

    if (entriesLastHour >= thresholdPerHour) {
      // Check if accelerating
      const entriesFirst30Min = entriesLastHour - entriesLast30Min;
      const accelerating = entriesLast30Min > entriesFirst30Min * 1.5;

      return {
        alert: true,
        reason: accelerating
          ? `DLQ growth accelerating: ${entriesLast30Min} in last 30min vs ${entriesFirst30Min} in prior 30min`
          : `DLQ threshold exceeded: ${entriesLastHour} entries in last hour`,
        entriesLastHour,
      };
    }

    return {
      alert: false,
      reason: 'Within normal parameters',
      entriesLastHour,
    };
  }
}
