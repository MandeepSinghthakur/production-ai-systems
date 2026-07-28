// Kafka producer with idempotent message production.
// Ensures exactly-once semantics for expensive LLM requests.

import type {
  LLMRequest,
  ProducerConfig,
  DEFAULT_PRODUCER_CONFIG,
} from './types.ts';
import { KafkaSimulator } from './simulator.ts';

/**
 * Result of a produce operation.
 */
export interface ProduceResult {
  success: boolean;
  messageId: string | null;
  isDuplicate: boolean;
  topic: string;
  partition: number;
  offset: number;
  idempotencyKey: string;
}

/**
 * Batch of messages to produce.
 */
export interface ProduceBatch {
  requests: Array<{ request: LLMRequest; idempotencyKey: string }>;
}

/**
 * Producer for LLM request messages.
 *
 * Key design decisions for LLM workloads:
 * 1. Idempotent production - duplicate requests return existing message ID
 * 2. Synchronous acks - we wait for confirmation before returning
 * 3. Single partition per idempotency key - preserves ordering per request
 */
export class Producer {
  private kafka: KafkaSimulator;
  private config: ProducerConfig;
  private topic: string;
  private inFlightCount: number;
  private closed: boolean;

  constructor(kafka: KafkaSimulator, topic: string, config?: ProducerConfig) {
    this.kafka = kafka;
    this.topic = topic;
    this.config = config ?? {
      acks: 'all',
      enableIdempotence: true,
      maxInFlight: 1,
      retries: 3,
    };
    this.inFlightCount = 0;
    this.closed = false;
  }

  /**
   * Produce a single message.
   *
   * The idempotency key is critical for exactly-once semantics:
   * - If this exact key was already produced, return the existing message
   * - If new, produce and return the new message ID
   *
   * For LLM requests, use a hash of the request parameters as the key.
   */
  produce(request: LLMRequest, idempotencyKey: string): ProduceResult {
    if (this.closed) {
      throw new Error('Producer is closed');
    }

    // Check in-flight limit
    if (this.inFlightCount >= this.config.maxInFlight) {
      throw new Error(
        `Max in-flight limit reached: ${this.config.maxInFlight}`
      );
    }

    this.inFlightCount++;

    try {
      const result = this.kafka.produce(this.topic, request, idempotencyKey);

      // Get partition for this key
      const partitionCount = this.kafka.getPartitionCount(this.topic);
      let hash = 0;
      for (let i = 0; i < idempotencyKey.length; i++) {
        hash = ((hash << 5) - hash + idempotencyKey.charCodeAt(i)) | 0;
      }
      const partition = Math.abs(hash) % partitionCount;

      return {
        success: true,
        messageId: result.messageId,
        isDuplicate: result.isDuplicate,
        topic: this.topic,
        partition,
        offset: result.offset,
        idempotencyKey,
      };
    } finally {
      this.inFlightCount--;
    }
  }

  /**
   * Produce a batch of messages.
   *
   * Returns results for each message in order.
   * Duplicates are detected per-message, not per-batch.
   */
  produceBatch(batch: ProduceBatch): ProduceResult[] {
    if (this.closed) {
      throw new Error('Producer is closed');
    }

    const results: ProduceResult[] = [];

    for (const item of batch.requests) {
      const result = this.produce(item.request, item.idempotencyKey);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate an idempotency key from request parameters.
   *
   * The key includes all request parameters that affect the response.
   * Two identical requests should produce the same key.
   */
  static generateIdempotencyKey(
    request: LLMRequest,
    additionalSalt?: string
  ): string {
    const components = [
      request.tenant,
      request.workload,
      request.prompt,
      request.tier,
      request.maxTokens.toString(),
    ];

    if (additionalSalt) {
      components.push(additionalSalt);
    }

    // Simple hash - in production use crypto.createHash
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }

    return `idem_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Close the producer.
   */
  close(): void {
    this.closed = true;
  }

  /**
   * Check if producer is healthy.
   */
  isHealthy(): boolean {
    return !this.closed;
  }
}
