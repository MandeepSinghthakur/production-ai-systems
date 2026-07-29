// Event sourcing patterns for AI systems.
// Reconstructs state from events rather than storing current state.

import type {
  Event,
  ConversationAggregate,
  ConversationEvent,
  ConversationStartedEvent,
  MessageSentEvent,
  TierChangedEvent,
  ConversationEndedEvent,
  ModelTier,
} from './types.ts';
import { InMemoryEventStore } from './events.ts';

/**
 * Reconstruct a conversation aggregate from its events.
 *
 * This is the core of event sourcing: the current state is derived
 * entirely from the sequence of events, not stored directly.
 */
export function rehydrateConversation(
  events: Event[]
): ConversationAggregate | null {
  if (events.length === 0) {
    return null;
  }

  // Initialize from first event (must be conversation.started)
  const firstEvent = events[0];
  if (firstEvent.type !== 'conversation.started') {
    throw new Error(
      `First event must be conversation.started, got ${firstEvent.type}`
    );
  }

  const startPayload = firstEvent.payload as ConversationStartedEvent['payload'];

  const aggregate: ConversationAggregate = {
    id: firstEvent.aggregateId,
    version: 0,
    tenantId: startPayload.tenantId,
    userId: startPayload.userId,
    currentTier: startPayload.tier,
    systemPrompt: startPayload.systemPrompt,
    messages: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: firstEvent.timestamp,
    endedAt: null,
    status: 'active',
  };

  // Apply each event to update state
  for (const event of events) {
    applyEvent(aggregate, event);
  }

  return aggregate;
}

/**
 * Apply a single event to update aggregate state.
 *
 * This function is pure: given the same aggregate and event,
 * it produces the same result. No side effects.
 */
export function applyEvent(
  aggregate: ConversationAggregate,
  event: Event
): void {
  aggregate.version = event.version;

  switch (event.type) {
    case 'conversation.started': {
      // Already handled in initialization
      break;
    }

    case 'message.sent': {
      const payload = event.payload as MessageSentEvent['payload'];
      aggregate.messages.push({
        role: payload.role,
        content: payload.content,
        timestamp: event.timestamp,
      });
      if (payload.inputTokens !== null) {
        aggregate.totalInputTokens += payload.inputTokens;
      }
      if (payload.outputTokens !== null) {
        aggregate.totalOutputTokens += payload.outputTokens;
      }
      break;
    }

    case 'tier.changed': {
      const payload = event.payload as TierChangedEvent['payload'];
      aggregate.currentTier = payload.newTier;
      break;
    }

    case 'conversation.ended': {
      aggregate.status = 'ended';
      aggregate.endedAt = event.timestamp;
      break;
    }

    default: {
      // Unknown event type - log but don't fail
      console.warn(`Unknown event type: ${event.type}`);
    }
  }
}

/**
 * Conversation repository using event sourcing.
 *
 * The repository does not store aggregates directly. Instead, it:
 * 1. Loads events from the event store
 * 2. Reconstructs the aggregate by replaying events
 * 3. Saves new events to the event store
 */
export class ConversationRepository {
  private eventStore: InMemoryEventStore;
  private snapshotStore: Map<string, ConversationSnapshot>;
  private snapshotInterval: number;

  constructor(eventStore: InMemoryEventStore, snapshotInterval: number = 10) {
    this.eventStore = eventStore;
    this.snapshotStore = new Map();
    this.snapshotInterval = snapshotInterval;
  }

  /**
   * Load a conversation by ID.
   *
   * Optimization: if a snapshot exists, load from snapshot and
   * replay only events after the snapshot version.
   */
  load(conversationId: string): ConversationAggregate | null {
    // Check for snapshot
    const snapshot = this.snapshotStore.get(conversationId);

    if (snapshot) {
      // Load events after snapshot
      const events = this.eventStore.read(conversationId, snapshot.version);
      if (events.length === 0) {
        return snapshot.aggregate;
      }

      // Clone snapshot aggregate and apply newer events
      const aggregate = { ...snapshot.aggregate };
      aggregate.messages = [...snapshot.aggregate.messages];
      for (const event of events) {
        applyEvent(aggregate, event);
      }
      return aggregate;
    }

    // No snapshot - replay all events
    const events = this.eventStore.read(conversationId);
    return rehydrateConversation(events);
  }

  /**
   * Save new events for a conversation.
   *
   * Uses optimistic concurrency to prevent conflicting updates.
   */
  save(
    conversationId: string,
    events: Event[],
    expectedVersion: number
  ): { success: boolean; error?: string } {
    const result = this.eventStore.append(
      conversationId,
      events,
      expectedVersion
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Check if we should create a snapshot
    if (result.newVersion % this.snapshotInterval === 0) {
      const aggregate = this.load(conversationId);
      if (aggregate) {
        this.createSnapshot(conversationId, aggregate);
      }
    }

    return { success: true };
  }

  /**
   * Create a snapshot of the current state.
   *
   * Snapshots are an optimization: they reduce the number of events
   * that must be replayed to reconstruct state. Without snapshots,
   * a conversation with 1000 messages would replay 1000 events on
   * every load.
   */
  createSnapshot(
    conversationId: string,
    aggregate: ConversationAggregate
  ): void {
    this.snapshotStore.set(conversationId, {
      aggregateId: conversationId,
      version: aggregate.version,
      aggregate: {
        ...aggregate,
        messages: [...aggregate.messages],
      },
      createdAt: Date.now(),
    });
  }

  /**
   * Get snapshot for a conversation (for testing).
   */
  getSnapshot(conversationId: string): ConversationSnapshot | null {
    return this.snapshotStore.get(conversationId) ?? null;
  }

  /**
   * Check if a conversation exists.
   */
  exists(conversationId: string): boolean {
    return this.eventStore.exists(conversationId);
  }

  /**
   * Get the current version of a conversation.
   */
  getVersion(conversationId: string): number {
    return this.eventStore.getVersion(conversationId);
  }
}

/**
 * Snapshot of a conversation aggregate at a point in time.
 */
export interface ConversationSnapshot {
  aggregateId: string;
  version: number;
  aggregate: ConversationAggregate;
  createdAt: number;
}

/**
 * Event stream for processing events in order.
 *
 * Provides an iterator-like interface for consuming events
 * while tracking the current position.
 */
export class EventStream {
  private eventStore: InMemoryEventStore;
  private position: number;
  private batchSize: number;

  constructor(eventStore: InMemoryEventStore, batchSize: number = 100) {
    this.eventStore = eventStore;
    this.position = 0;
    this.batchSize = batchSize;
  }

  /**
   * Read the next batch of events.
   */
  next(): { events: Event[]; hasMore: boolean } {
    const envelopes = this.eventStore.readAll(this.position, this.batchSize);
    const events = envelopes.map((e) => e.event);

    this.position += events.length;

    return {
      events,
      hasMore: events.length === this.batchSize,
    };
  }

  /**
   * Get current position.
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Seek to a specific position.
   */
  seek(position: number): void {
    this.position = position;
  }

  /**
   * Reset to beginning.
   */
  reset(): void {
    this.position = 0;
  }
}

/**
 * Temporal query: get aggregate state at a specific point in time.
 *
 * This is a key benefit of event sourcing: you can reconstruct
 * what the system looked like at any point in history.
 */
export function getStateAtTime(
  events: Event[],
  timestamp: number
): ConversationAggregate | null {
  // Filter events up to the timestamp
  const eventsUpToTime = events.filter((e) => e.timestamp <= timestamp);
  return rehydrateConversation(eventsUpToTime);
}

/**
 * Calculate statistics from event history.
 */
export function calculateEventStats(events: Event[]): EventStats {
  const stats: EventStats = {
    totalEvents: events.length,
    eventsByType: {},
    firstEventAt: 0,
    lastEventAt: 0,
    averageInterval: 0,
  };

  if (events.length === 0) {
    return stats;
  }

  stats.firstEventAt = events[0].timestamp;
  stats.lastEventAt = events[events.length - 1].timestamp;

  // Count by type
  for (const event of events) {
    stats.eventsByType[event.type] =
      (stats.eventsByType[event.type] ?? 0) + 1;
  }

  // Calculate average interval
  if (events.length > 1) {
    const totalDuration = stats.lastEventAt - stats.firstEventAt;
    stats.averageInterval = totalDuration / (events.length - 1);
  }

  return stats;
}

export interface EventStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  firstEventAt: number;
  lastEventAt: number;
  averageInterval: number;
}
