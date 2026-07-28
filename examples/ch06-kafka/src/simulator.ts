// In-memory Kafka-like message broker for testing.
// Simulates partitions, consumer groups, offsets, and rebalancing.
// No external dependencies - runs entirely in-process.

import type {
  Message,
  LLMRequest,
  TopicConfig,
  PartitionAssignment,
  ConsumerGroupState,
  PipelineMetrics,
  DLQEntry,
} from './types.ts';

/**
 * Partition holds messages and tracks consumer offsets.
 */
class Partition {
  topic: string;
  index: number;
  messages: Message[];
  highWatermark: number;

  constructor(topic: string, index: number) {
    this.topic = topic;
    this.index = index;
    this.messages = [];
    this.highWatermark = 0;
  }

  append(message: Message): number {
    const offset = this.highWatermark;
    this.messages.push({ ...message });
    this.highWatermark++;
    return offset;
  }

  read(offset: number): Message | null {
    if (offset < 0 || offset >= this.messages.length) {
      return null;
    }
    return this.messages[offset];
  }

  getMessages(fromOffset: number, count: number): Message[] {
    return this.messages.slice(fromOffset, fromOffset + count);
  }
}

/**
 * Topic manages partitions and message routing.
 */
class Topic {
  config: TopicConfig;
  partitions: Partition[];

  constructor(config: TopicConfig) {
    this.config = config;
    this.partitions = [];
    for (let i = 0; i < config.partitions; i++) {
      this.partitions.push(new Partition(config.name, i));
    }
  }

  /**
   * Route message to partition using consistent hashing on idempotency key.
   */
  getPartition(idempotencyKey: string): Partition {
    let hash = 0;
    for (let i = 0; i < idempotencyKey.length; i++) {
      hash = ((hash << 5) - hash + idempotencyKey.charCodeAt(i)) | 0;
    }
    const index = Math.abs(hash) % this.partitions.length;
    return this.partitions[index];
  }
}

/**
 * ConsumerGroup tracks member assignments and offsets.
 */
class ConsumerGroup {
  state: ConsumerGroupState;
  committedOffsets: Map<string, number>; // "topic:partition" -> offset

  constructor(groupId: string) {
    this.state = {
      groupId,
      members: [],
      assignments: new Map(),
      generationId: 0,
    };
    this.committedOffsets = new Map();
  }

  join(memberId: string): void {
    if (!this.state.members.includes(memberId)) {
      this.state.members.push(memberId);
      this.state.generationId++;
    }
  }

  leave(memberId: string): void {
    const index = this.state.members.indexOf(memberId);
    if (index >= 0) {
      this.state.members.splice(index, 1);
      this.state.assignments.delete(memberId);
      this.state.generationId++;
    }
  }

  commitOffset(topic: string, partition: number, offset: number): void {
    this.committedOffsets.set(`${topic}:${partition}`, offset);
  }

  getCommittedOffset(topic: string, partition: number): number {
    return this.committedOffsets.get(`${topic}:${partition}`) ?? 0;
  }
}

/**
 * Simulated Kafka broker - the core of the testing infrastructure.
 * Provides Kafka-like semantics without actual Kafka.
 */
export class KafkaSimulator {
  private topics: Map<string, Topic>;
  private consumerGroups: Map<string, ConsumerGroup>;
  private idempotencyStore: Map<string, string>; // key -> messageId
  private dlqEntries: DLQEntry[];
  private metrics: PipelineMetrics;

  constructor() {
    this.topics = new Map();
    this.consumerGroups = new Map();
    this.idempotencyStore = new Map();
    this.dlqEntries = [];
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): PipelineMetrics {
    return {
      messagesProduced: 0,
      messagesConsumed: 0,
      messagesProcessed: 0,
      messagesFailed: 0,
      messagesDLQ: 0,
      duplicatesDetected: 0,
      currentLag: 0,
      avgProcessingTimeMs: 0,
      backpressurePauseCount: 0,
      heartbeatsMissed: 0,
    };
  }

  /**
   * Create a topic with the specified configuration.
   */
  createTopic(config: TopicConfig): void {
    if (!this.topics.has(config.name)) {
      this.topics.set(config.name, new Topic(config));
    }
  }

  /**
   * Produce a message to a topic.
   * Returns the message ID, or null if duplicate detected.
   */
  produce(
    topic: string,
    request: LLMRequest,
    idempotencyKey: string
  ): { messageId: string | null; isDuplicate: boolean; offset: number } {
    const topicObj = this.topics.get(topic);
    if (!topicObj) {
      throw new Error(`Topic ${topic} does not exist`);
    }

    // Check for duplicate using idempotency key
    const existingId = this.idempotencyStore.get(idempotencyKey);
    if (existingId) {
      this.metrics.duplicatesDetected++;
      return { messageId: null, isDuplicate: true, offset: -1 };
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const message: Message = {
      id: messageId,
      idempotencyKey,
      topic,
      payload: request,
      state: 'pending',
      attempts: 0,
      createdAt: Date.now(),
      processingStartedAt: null,
      completedAt: null,
      error: null,
    };

    const partition = topicObj.getPartition(idempotencyKey);
    const offset = partition.append(message);

    this.idempotencyStore.set(idempotencyKey, messageId);
    this.metrics.messagesProduced++;

    return { messageId, isDuplicate: false, offset };
  }

  /**
   * Get or create a consumer group.
   */
  getConsumerGroup(groupId: string): ConsumerGroup {
    let group = this.consumerGroups.get(groupId);
    if (!group) {
      group = new ConsumerGroup(groupId);
      this.consumerGroups.set(groupId, group);
    }
    return group;
  }

  /**
   * Fetch messages from a topic partition.
   */
  fetch(
    topic: string,
    partition: number,
    fromOffset: number,
    maxMessages: number
  ): Message[] {
    const topicObj = this.topics.get(topic);
    if (!topicObj) {
      return [];
    }
    if (partition < 0 || partition >= topicObj.partitions.length) {
      return [];
    }
    const messages = topicObj.partitions[partition].getMessages(
      fromOffset,
      maxMessages
    );
    this.metrics.messagesConsumed += messages.length;
    return messages;
  }

  /**
   * Commit offset for a consumer group.
   */
  commitOffset(
    groupId: string,
    topic: string,
    partition: number,
    offset: number
  ): void {
    const group = this.getConsumerGroup(groupId);
    group.commitOffset(topic, partition, offset);
  }

  /**
   * Get committed offset for a consumer group.
   */
  getCommittedOffset(
    groupId: string,
    topic: string,
    partition: number
  ): number {
    const group = this.getConsumerGroup(groupId);
    return group.getCommittedOffset(topic, partition);
  }

  /**
   * Mark a message as processed successfully.
   */
  markProcessed(topic: string, partition: number, offset: number): void {
    const topicObj = this.topics.get(topic);
    if (!topicObj) return;
    const msg = topicObj.partitions[partition].read(offset);
    if (msg) {
      msg.state = 'completed';
      msg.completedAt = Date.now();
      this.metrics.messagesProcessed++;
    }
  }

  /**
   * Mark a message as failed.
   */
  markFailed(
    topic: string,
    partition: number,
    offset: number,
    error: string
  ): void {
    const topicObj = this.topics.get(topic);
    if (!topicObj) return;
    const msg = topicObj.partitions[partition].read(offset);
    if (msg) {
      msg.state = 'failed';
      msg.error = error;
      msg.attempts++;
      this.metrics.messagesFailed++;
    }
  }

  /**
   * Send a message to the dead letter queue.
   */
  sendToDLQ(message: Message, reason: string): void {
    const entry: DLQEntry = {
      originalMessage: { ...message },
      failureReason: reason,
      failedAttempts: message.attempts,
      sentToDLQAt: Date.now(),
    };
    this.dlqEntries.push(entry);
    message.state = 'dead_letter';
    this.metrics.messagesDLQ++;
  }

  /**
   * Get all DLQ entries.
   */
  getDLQEntries(): DLQEntry[] {
    return [...this.dlqEntries];
  }

  /**
   * Calculate current consumer lag.
   */
  calculateLag(groupId: string, topic: string): number {
    const topicObj = this.topics.get(topic);
    if (!topicObj) return 0;

    const group = this.getConsumerGroup(groupId);
    let totalLag = 0;

    for (let i = 0; i < topicObj.partitions.length; i++) {
      const highWatermark = topicObj.partitions[i].highWatermark;
      const committed = group.getCommittedOffset(topic, i);
      totalLag += Math.max(0, highWatermark - committed);
    }

    this.metrics.currentLag = totalLag;
    return totalLag;
  }

  /**
   * Get topic partition count.
   */
  getPartitionCount(topic: string): number {
    const topicObj = this.topics.get(topic);
    return topicObj?.partitions.length ?? 0;
  }

  /**
   * Get current metrics.
   */
  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }

  /**
   * Record a backpressure pause event.
   */
  recordBackpressurePause(): void {
    this.metrics.backpressurePauseCount++;
  }

  /**
   * Record a missed heartbeat.
   */
  recordMissedHeartbeat(): void {
    this.metrics.heartbeatsMissed++;
  }

  /**
   * Update average processing time.
   */
  updateAvgProcessingTime(timeMs: number): void {
    // Exponential moving average with alpha = 0.1
    const alpha = 0.1;
    this.metrics.avgProcessingTimeMs =
      alpha * timeMs + (1 - alpha) * this.metrics.avgProcessingTimeMs;
  }

  /**
   * Reset all state - useful for testing.
   */
  reset(): void {
    this.topics.clear();
    this.consumerGroups.clear();
    this.idempotencyStore.clear();
    this.dlqEntries = [];
    this.metrics = this.createEmptyMetrics();
  }
}
