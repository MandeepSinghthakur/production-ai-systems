// Core types for event-driven AI systems.
// See Chapter 7, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Base event interface. All events are immutable and timestamped.
 */
export interface Event {
  id: string;
  type: string;
  aggregateId: string;
  version: number;
  timestamp: number;
  payload: unknown;
}

/**
 * Event metadata for tracing and debugging.
 */
export interface EventMetadata {
  correlationId: string;
  causationId: string | null;
  userId: string | null;
  tenantId: string;
}

/**
 * Schema version for event evolution.
 */
export interface SchemaVersion {
  major: number;
  minor: number;
}

/**
 * Event envelope wraps event with metadata and schema version.
 */
export interface EventEnvelope {
  event: Event;
  metadata: EventMetadata;
  schemaVersion: SchemaVersion;
}

// -----------------------------------------------------------------
// AI-specific events for conversation management
// -----------------------------------------------------------------

/**
 * Conversation started event.
 */
export interface ConversationStartedEvent extends Event {
  type: 'conversation.started';
  payload: {
    tenantId: string;
    userId: string;
    tier: ModelTier;
    systemPrompt: string;
  };
}

/**
 * Message sent event.
 */
export interface MessageSentEvent extends Event {
  type: 'message.sent';
  payload: {
    role: 'user' | 'assistant';
    content: string;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number | null;
    tier: ModelTier | null;
  };
}

/**
 * Conversation tier changed event.
 */
export interface TierChangedEvent extends Event {
  type: 'tier.changed';
  payload: {
    previousTier: ModelTier;
    newTier: ModelTier;
    reason: string;
  };
}

/**
 * Conversation ended event.
 */
export interface ConversationEndedEvent extends Event {
  type: 'conversation.ended';
  payload: {
    reason: 'user_ended' | 'timeout' | 'error';
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    durationMs: number;
  };
}

/**
 * Union type for all conversation events.
 */
export type ConversationEvent =
  | ConversationStartedEvent
  | MessageSentEvent
  | TierChangedEvent
  | ConversationEndedEvent;

// -----------------------------------------------------------------
// Event sourcing types
// -----------------------------------------------------------------

/**
 * Aggregate root for conversations.
 */
export interface ConversationAggregate {
  id: string;
  version: number;
  tenantId: string;
  userId: string;
  currentTier: ModelTier;
  systemPrompt: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  startedAt: number;
  endedAt: number | null;
  status: 'active' | 'ended';
}

/**
 * Event store interface.
 */
export interface EventStore {
  append(
    aggregateId: string,
    events: Event[],
    expectedVersion: number
  ): AppendResult;
  read(aggregateId: string, fromVersion?: number): Event[];
  readAll(fromPosition?: number, limit?: number): EventEnvelope[];
}

/**
 * Result of appending events.
 */
export interface AppendResult {
  success: boolean;
  newVersion: number;
  error?: string;
}

// -----------------------------------------------------------------
// CQRS types
// -----------------------------------------------------------------

/**
 * Command for starting a conversation.
 */
export interface StartConversationCommand {
  type: 'start_conversation';
  conversationId: string;
  tenantId: string;
  userId: string;
  tier: ModelTier;
  systemPrompt: string;
}

/**
 * Command for sending a message.
 */
export interface SendMessageCommand {
  type: 'send_message';
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  tier?: ModelTier;
}

/**
 * Command for changing tier.
 */
export interface ChangeTierCommand {
  type: 'change_tier';
  conversationId: string;
  newTier: ModelTier;
  reason: string;
}

/**
 * Command for ending a conversation.
 */
export interface EndConversationCommand {
  type: 'end_conversation';
  conversationId: string;
  reason: 'user_ended' | 'timeout' | 'error';
}

/**
 * Union type for all commands.
 */
export type ConversationCommand =
  | StartConversationCommand
  | SendMessageCommand
  | ChangeTierCommand
  | EndConversationCommand;

/**
 * Command result.
 */
export interface CommandResult {
  success: boolean;
  events: Event[];
  error?: string;
}

/**
 * Read model for conversation summary.
 */
export interface ConversationSummary {
  id: string;
  tenantId: string;
  userId: string;
  messageCount: number;
  lastMessageAt: number;
  totalTokens: number;
  currentTier: ModelTier;
  status: 'active' | 'ended';
}

/**
 * Read model for tenant analytics.
 */
export interface TenantAnalytics {
  tenantId: string;
  activeConversations: number;
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  tierUsage: Record<ModelTier, number>;
}

// -----------------------------------------------------------------
// Idempotency types
// -----------------------------------------------------------------

/**
 * Idempotency key for deduplicating commands.
 */
export interface IdempotencyKey {
  key: string;
  commandType: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Result of idempotency check.
 */
export interface IdempotencyResult {
  isDuplicate: boolean;
  previousResult?: CommandResult;
}

/**
 * Idempotency store interface.
 */
export interface IdempotencyStore {
  check(key: string): IdempotencyResult;
  record(key: string, result: CommandResult, ttlMs: number): void;
  cleanup(beforeTimestamp: number): number;
}

// -----------------------------------------------------------------
// Event ordering types
// -----------------------------------------------------------------

/**
 * Sequence number for global ordering.
 */
export interface SequenceNumber {
  global: number;
  partition: number;
  aggregate: number;
}

/**
 * Ordering guarantee levels.
 */
export type OrderingGuarantee =
  | 'none'           // No ordering guarantee
  | 'per_aggregate'  // Ordered within an aggregate
  | 'per_partition'  // Ordered within a partition
  | 'global';        // Totally ordered

/**
 * Event projection for building read models.
 */
export interface Projection {
  name: string;
  position: number;
  apply(event: EventEnvelope): void;
  rebuild(): void;
}
