// Core types for Kafka-like event-driven LLM pipelines.
// See Chapter 6, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Message states as they flow through the pipeline.
 */
export type MessageState =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead_letter';

/**
 * A message in the event stream.
 * The idempotencyKey ensures exactly-once processing.
 */
export interface Message {
  id: string;
  idempotencyKey: string;
  topic: string;
  payload: LLMRequest;
  state: MessageState;
  attempts: number;
  createdAt: number;
  processingStartedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

/**
 * An LLM request payload.
 */
export interface LLMRequest {
  prompt: string;
  tier: ModelTier;
  maxTokens: number;
  tenant: string;
  workload: string;
}

/**
 * Result of processing an LLM request.
 */
export interface LLMResponse {
  requestId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  processingTimeMs: number;
  tier: ModelTier;
}

/**
 * Consumer configuration.
 */
export interface ConsumerConfig {
  groupId: string;
  sessionTimeoutMs: number;
  heartbeatIntervalMs: number;
  maxProcessingTimeMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

/**
 * Producer configuration.
 */
export interface ProducerConfig {
  acks: 'all' | 'leader' | 'none';
  enableIdempotence: boolean;
  maxInFlight: number;
  retries: number;
}

/**
 * Partition assignment.
 */
export interface PartitionAssignment {
  topic: string;
  partition: number;
  offset: number;
}

/**
 * Consumer group state.
 */
export interface ConsumerGroupState {
  groupId: string;
  members: string[];
  assignments: Map<string, PartitionAssignment[]>;
  generationId: number;
}

/**
 * Backpressure state.
 */
export interface BackpressureState {
  isPaused: boolean;
  pausedAt: number | null;
  resumedAt: number | null;
  queueDepth: number;
  maxQueueDepth: number;
  rateLimitedUntil: number | null;
}

/**
 * Dead letter queue entry.
 */
export interface DLQEntry {
  originalMessage: Message;
  failureReason: string;
  failedAttempts: number;
  sentToDLQAt: number;
}

/**
 * Metrics for monitoring.
 */
export interface PipelineMetrics {
  messagesProduced: number;
  messagesConsumed: number;
  messagesProcessed: number;
  messagesFailed: number;
  messagesDLQ: number;
  duplicatesDetected: number;
  currentLag: number;
  avgProcessingTimeMs: number;
  backpressurePauseCount: number;
  heartbeatsMissed: number;
}

/**
 * Topic configuration.
 */
export interface TopicConfig {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
}

/**
 * Default consumer config optimized for LLM workloads.
 * Key insight: session timeout must exceed max processing time
 * to prevent spurious rebalances during long inference calls.
 */
export const DEFAULT_CONSUMER_CONFIG: ConsumerConfig = {
  groupId: 'llm-processor',
  sessionTimeoutMs: 120_000,    // 2 minutes - must exceed max processing
  heartbeatIntervalMs: 10_000, // Every 10 seconds
  maxProcessingTimeMs: 60_000, // 1 minute max per message
  maxRetries: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 30_000,
};

/**
 * Default producer config for exactly-once semantics.
 */
export const DEFAULT_PRODUCER_CONFIG: ProducerConfig = {
  acks: 'all',
  enableIdempotence: true,
  maxInFlight: 1,
  retries: 3,
};
