// Core types for transactional patterns in distributed AI systems.
// See Chapter 8, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Outbox entry states.
 */
export type OutboxState =
  | 'pending'
  | 'published'
  | 'failed';

/**
 * Saga step states.
 */
export type SagaStepState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated';

/**
 * Overall saga states.
 */
export type SagaState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated';

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
 * Result of an LLM call.
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
 * An entry in the outbox table.
 * Written transactionally with the domain data.
 */
export interface OutboxEntry {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  state: OutboxState;
  createdAt: number;
  publishedAt: number | null;
  attempts: number;
  lastError: string | null;
  idempotencyKey: string;
}

/**
 * A step in a saga.
 */
export interface SagaStep {
  name: string;
  state: SagaStepState;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  output: unknown;
}

/**
 * A saga instance tracking a distributed transaction.
 */
export interface Saga {
  id: string;
  type: string;
  state: SagaState;
  steps: SagaStep[];
  context: Record<string, unknown>;
  createdAt: number;
  completedAt: number | null;
  compensationIndex: number;
}

/**
 * Definition of a saga step.
 */
export interface SagaStepDefinition {
  name: string;
  execute: (context: Record<string, unknown>) => Promise<StepResult>;
  compensate: (context: Record<string, unknown>) => Promise<CompensationResult>;
}

/**
 * Result of executing a saga step.
 */
export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * Result of compensating a saga step.
 */
export interface CompensationResult {
  success: boolean;
  error?: string;
}

/**
 * Configuration for the outbox publisher.
 */
export interface OutboxConfig {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  retryDelayMs: number;
}

/**
 * Configuration for saga execution.
 */
export interface SagaConfig {
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

/**
 * Idempotency record.
 */
export interface IdempotencyRecord {
  key: string;
  response: unknown;
  createdAt: number;
  expiresAt: number;
}

/**
 * Delivery attempt record.
 */
export interface DeliveryAttempt {
  outboxEntryId: string;
  attemptNumber: number;
  timestamp: number;
  success: boolean;
  error: string | null;
  durationMs: number;
}

/**
 * Metrics for monitoring transactional patterns.
 */
export interface TransactionMetrics {
  outboxEntriesCreated: number;
  outboxEntriesPublished: number;
  outboxEntriesFailed: number;
  sagasStarted: number;
  sagasCompleted: number;
  sagasFailed: number;
  compensationsTriggered: number;
  compensationsCompleted: number;
  duplicatesDetected: number;
  avgPublishLatencyMs: number;
  avgSagaDurationMs: number;
}

/**
 * Default outbox configuration.
 */
export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  pollIntervalMs: 1000,
  batchSize: 100,
  maxAttempts: 5,
  retryDelayMs: 1000,
};

/**
 * Default saga configuration.
 */
export const DEFAULT_SAGA_CONFIG: SagaConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 60000,
};
