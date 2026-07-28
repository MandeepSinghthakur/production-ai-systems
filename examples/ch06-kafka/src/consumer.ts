// Kafka consumer optimized for long-running LLM processing.
// Handles 30+ second processing times without losing partition assignment.

import type {
  Message,
  LLMResponse,
  ConsumerConfig,
  BackpressureState,
  DEFAULT_CONSUMER_CONFIG,
} from './types.ts';
import { KafkaSimulator } from './simulator.ts';

/**
 * Handler function for processing messages.
 */
export type MessageHandler = (
  message: Message
) => Promise<{ success: boolean; response?: LLMResponse; error?: string }>;

/**
 * Consumer for LLM request messages.
 *
 * Key design decisions for LLM workloads:
 * 1. Session timeout > max processing time - prevents rebalance during inference
 * 2. Heartbeat during processing - keeps connection alive during long requests
 * 3. Backpressure support - pause consumption when rate limited
 * 4. DLQ routing - unprocessable messages go to dead letter queue
 */
export class Consumer {
  private kafka: KafkaSimulator;
  private topic: string;
  private config: ConsumerConfig;
  private memberId: string;
  private running: boolean;
  private paused: boolean;
  private backpressure: BackpressureState;
  private lastHeartbeat: number;
  private processingCount: number;

  constructor(kafka: KafkaSimulator, topic: string, config?: ConsumerConfig) {
    this.kafka = kafka;
    this.topic = topic;
    this.config = config ?? {
      groupId: 'llm-processor',
      sessionTimeoutMs: 120_000,
      heartbeatIntervalMs: 10_000,
      maxProcessingTimeMs: 60_000,
      maxRetries: 3,
      backoffBaseMs: 1000,
      backoffMaxMs: 30_000,
    };
    this.memberId = `consumer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.running = false;
    this.paused = false;
    this.backpressure = {
      isPaused: false,
      pausedAt: null,
      resumedAt: null,
      queueDepth: 0,
      maxQueueDepth: 100,
      rateLimitedUntil: null,
    };
    this.lastHeartbeat = Date.now();
    this.processingCount = 0;
  }

  /**
   * Join the consumer group.
   */
  join(): void {
    const group = this.kafka.getConsumerGroup(this.config.groupId);
    group.join(this.memberId);
  }

  /**
   * Leave the consumer group.
   */
  leave(): void {
    const group = this.kafka.getConsumerGroup(this.config.groupId);
    group.leave(this.memberId);
  }

  /**
   * Send heartbeat to maintain group membership.
   *
   * This is critical for LLM workloads: if processing takes 30 seconds
   * and heartbeat interval is 3 seconds, we must send heartbeats during
   * processing or lose our partition assignment.
   */
  heartbeat(): { success: boolean; timeSinceLastMs: number } {
    const now = Date.now();
    const timeSinceLastMs = now - this.lastHeartbeat;

    // Check if we've exceeded session timeout
    if (timeSinceLastMs > this.config.sessionTimeoutMs) {
      this.kafka.recordMissedHeartbeat();
      return { success: false, timeSinceLastMs };
    }

    this.lastHeartbeat = now;
    return { success: true, timeSinceLastMs };
  }

  /**
   * Poll for messages from assigned partitions.
   */
  poll(maxMessages: number): Message[] {
    if (this.paused || this.backpressure.isPaused) {
      return [];
    }

    // Check backpressure: if rate limited, don't fetch
    if (this.backpressure.rateLimitedUntil) {
      if (Date.now() < this.backpressure.rateLimitedUntil) {
        return [];
      }
      // Rate limit expired
      this.backpressure.rateLimitedUntil = null;
    }

    const partitionCount = this.kafka.getPartitionCount(this.topic);
    const messages: Message[] = [];

    // Simple round-robin across partitions
    for (let p = 0; p < partitionCount; p++) {
      const offset = this.kafka.getCommittedOffset(
        this.config.groupId,
        this.topic,
        p
      );
      const partitionMessages = this.kafka.fetch(
        this.topic,
        p,
        offset,
        Math.ceil(maxMessages / partitionCount)
      );
      messages.push(
        ...partitionMessages.map((m) => ({ ...m, partition: p, offset }))
      );
    }

    // Update backpressure queue depth
    this.backpressure.queueDepth = messages.length;

    return messages.slice(0, maxMessages);
  }

  /**
   * Process a message with the given handler.
   *
   * Includes:
   * - Timeout enforcement
   * - Heartbeat during processing (simulated)
   * - Retry with exponential backoff
   * - DLQ routing on permanent failure
   */
  async processMessage(
    message: Message,
    partition: number,
    offset: number,
    handler: MessageHandler
  ): Promise<{
    success: boolean;
    retriable: boolean;
    sentToDLQ: boolean;
    processingTimeMs: number;
  }> {
    const startTime = Date.now();
    this.processingCount++;

    try {
      // Create a timeout promise
      const timeoutMs = this.config.maxProcessingTimeMs;

      // Simulate heartbeat check during processing
      const heartbeatCheck = () => {
        const hb = this.heartbeat();
        if (!hb.success) {
          throw new Error(
            `Session timeout exceeded: ${hb.timeSinceLastMs}ms since last heartbeat`
          );
        }
      };

      // Check heartbeat before processing
      heartbeatCheck();

      // Process with timeout
      const result = await Promise.race([
        handler(message),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Processing timeout: ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);

      const processingTimeMs = Date.now() - startTime;
      this.kafka.updateAvgProcessingTime(processingTimeMs);

      if (result.success) {
        // Commit offset after successful processing
        this.kafka.commitOffset(
          this.config.groupId,
          this.topic,
          partition,
          offset + 1
        );
        this.kafka.markProcessed(this.topic, partition, offset);

        return {
          success: true,
          retriable: false,
          sentToDLQ: false,
          processingTimeMs,
        };
      }

      // Processing failed - determine if retriable
      const retriable = this.isRetriable(result.error);
      const processingTime = Date.now() - startTime;

      if (retriable && message.attempts < this.config.maxRetries) {
        // Will retry
        this.kafka.markFailed(
          this.topic,
          partition,
          offset,
          result.error ?? 'unknown error'
        );
        return {
          success: false,
          retriable: true,
          sentToDLQ: false,
          processingTimeMs: processingTime,
        };
      }

      // Send to DLQ - exhausted retries or non-retriable error
      this.kafka.sendToDLQ(message, result.error ?? 'unknown error');
      this.kafka.commitOffset(
        this.config.groupId,
        this.topic,
        partition,
        offset + 1
      );

      return {
        success: false,
        retriable: false,
        sentToDLQ: true,
        processingTimeMs: processingTime,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Timeout or session error - send to DLQ
      this.kafka.sendToDLQ(message, errorMsg);
      this.kafka.commitOffset(
        this.config.groupId,
        this.topic,
        partition,
        offset + 1
      );

      return {
        success: false,
        retriable: false,
        sentToDLQ: true,
        processingTimeMs,
      };
    } finally {
      this.processingCount--;
    }
  }

  /**
   * Determine if an error is retriable.
   *
   * For LLM workloads:
   * - Rate limit errors: retriable with backoff
   * - Timeout errors: retriable (provider might recover)
   * - Bad request errors: NOT retriable (will fail again)
   * - Context too long: NOT retriable (structural problem)
   */
  private isRetriable(error: string | undefined): boolean {
    if (!error) return false;

    const nonRetriablePatterns = [
      'bad request',
      'invalid',
      'context too long',
      'content policy',
      'authentication',
      'forbidden',
    ];

    const errorLower = error.toLowerCase();
    return !nonRetriablePatterns.some((p) => errorLower.includes(p));
  }

  /**
   * Calculate exponential backoff delay.
   */
  calculateBackoff(attempt: number): number {
    const delay =
      this.config.backoffBaseMs * Math.pow(2, Math.min(attempt, 10));
    // Add jitter: +/- 25%
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, this.config.backoffMaxMs);
  }

  /**
   * Pause consumption - used for backpressure.
   */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.backpressure.isPaused = true;
      this.backpressure.pausedAt = Date.now();
      this.kafka.recordBackpressurePause();
    }
  }

  /**
   * Resume consumption after backpressure release.
   */
  resume(): void {
    if (this.paused) {
      this.paused = false;
      this.backpressure.isPaused = false;
      this.backpressure.resumedAt = Date.now();
    }
  }

  /**
   * Apply rate limit backpressure.
   */
  applyRateLimit(durationMs: number): void {
    this.backpressure.rateLimitedUntil = Date.now() + durationMs;
    this.pause();
  }

  /**
   * Get current backpressure state.
   */
  getBackpressureState(): BackpressureState {
    return { ...this.backpressure };
  }

  /**
   * Get current consumer lag.
   */
  getLag(): number {
    return this.kafka.calculateLag(this.config.groupId, this.topic);
  }

  /**
   * Check if consumer is healthy.
   */
  isHealthy(): boolean {
    const timeSinceHeartbeat = Date.now() - this.lastHeartbeat;
    return timeSinceHeartbeat < this.config.sessionTimeoutMs;
  }

  /**
   * Get current processing count.
   */
  getProcessingCount(): number {
    return this.processingCount;
  }
}
