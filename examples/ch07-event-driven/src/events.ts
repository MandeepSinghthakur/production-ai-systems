// Event definitions and in-memory event store.
// Events are immutable, ordered, and versioned.

import type {
  Event,
  EventEnvelope,
  EventMetadata,
  SchemaVersion,
  AppendResult,
  ConversationEvent,
  ConversationStartedEvent,
  MessageSentEvent,
  TierChangedEvent,
  ConversationEndedEvent,
  ModelTier,
} from './types.ts';

/**
 * Generate a unique event ID.
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a conversation started event.
 */
export function createConversationStartedEvent(
  aggregateId: string,
  version: number,
  tenantId: string,
  userId: string,
  tier: ModelTier,
  systemPrompt: string
): ConversationStartedEvent {
  return {
    id: generateEventId(),
    type: 'conversation.started',
    aggregateId,
    version,
    timestamp: Date.now(),
    payload: {
      tenantId,
      userId,
      tier,
      systemPrompt,
    },
  };
}

/**
 * Create a message sent event.
 */
export function createMessageSentEvent(
  aggregateId: string,
  version: number,
  role: 'user' | 'assistant',
  content: string,
  inputTokens: number | null = null,
  outputTokens: number | null = null,
  latencyMs: number | null = null,
  tier: ModelTier | null = null
): MessageSentEvent {
  return {
    id: generateEventId(),
    type: 'message.sent',
    aggregateId,
    version,
    timestamp: Date.now(),
    payload: {
      role,
      content,
      inputTokens,
      outputTokens,
      latencyMs,
      tier,
    },
  };
}

/**
 * Create a tier changed event.
 */
export function createTierChangedEvent(
  aggregateId: string,
  version: number,
  previousTier: ModelTier,
  newTier: ModelTier,
  reason: string
): TierChangedEvent {
  return {
    id: generateEventId(),
    type: 'tier.changed',
    aggregateId,
    version,
    timestamp: Date.now(),
    payload: {
      previousTier,
      newTier,
      reason,
    },
  };
}

/**
 * Create a conversation ended event.
 */
export function createConversationEndedEvent(
  aggregateId: string,
  version: number,
  reason: 'user_ended' | 'timeout' | 'error',
  totalMessages: number,
  totalInputTokens: number,
  totalOutputTokens: number,
  durationMs: number
): ConversationEndedEvent {
  return {
    id: generateEventId(),
    type: 'conversation.ended',
    aggregateId,
    version,
    timestamp: Date.now(),
    payload: {
      reason,
      totalMessages,
      totalInputTokens,
      totalOutputTokens,
      durationMs,
    },
  };
}

/**
 * In-memory event store.
 *
 * Events are stored per aggregate and globally.
 * Optimistic concurrency is enforced via expectedVersion.
 */
export class InMemoryEventStore {
  // Events per aggregate, keyed by aggregateId
  private aggregateEvents: Map<string, Event[]>;
  // Global event log with metadata
  private globalLog: EventEnvelope[];
  // Global sequence counter
  private globalSequence: number;
  // Default schema version
  private defaultSchemaVersion: SchemaVersion;

  constructor() {
    this.aggregateEvents = new Map();
    this.globalLog = [];
    this.globalSequence = 0;
    this.defaultSchemaVersion = { major: 1, minor: 0 };
  }

  /**
   * Append events to an aggregate.
   *
   * Uses optimistic concurrency: if expectedVersion does not match
   * the current version, the append fails. This prevents concurrent
   * writers from creating conflicting event sequences.
   */
  append(
    aggregateId: string,
    events: Event[],
    expectedVersion: number,
    metadata?: Partial<EventMetadata>
  ): AppendResult {
    const existing = this.aggregateEvents.get(aggregateId) ?? [];
    const currentVersion = existing.length;

    // Optimistic concurrency check
    if (currentVersion !== expectedVersion) {
      return {
        success: false,
        newVersion: currentVersion,
        error: `Concurrency conflict: expected version ${expectedVersion}, ` +
               `but current version is ${currentVersion}`,
      };
    }

    // Validate event versions are sequential
    for (let i = 0; i < events.length; i++) {
      const expectedEventVersion = currentVersion + i + 1;
      if (events[i].version !== expectedEventVersion) {
        return {
          success: false,
          newVersion: currentVersion,
          error: `Invalid event version: expected ${expectedEventVersion}, ` +
                 `got ${events[i].version}`,
        };
      }
    }

    // Append to aggregate-specific store
    existing.push(...events);
    this.aggregateEvents.set(aggregateId, existing);

    // Append to global log with metadata
    for (const event of events) {
      const envelope: EventEnvelope = {
        event,
        metadata: {
          correlationId: metadata?.correlationId ?? event.id,
          causationId: metadata?.causationId ?? null,
          userId: metadata?.userId ?? null,
          tenantId: metadata?.tenantId ?? 'unknown',
        },
        schemaVersion: this.defaultSchemaVersion,
      };
      this.globalLog.push(envelope);
      this.globalSequence++;
    }

    return {
      success: true,
      newVersion: existing.length,
    };
  }

  /**
   * Read events for an aggregate, optionally from a specific version.
   */
  read(aggregateId: string, fromVersion: number = 0): Event[] {
    const events = this.aggregateEvents.get(aggregateId) ?? [];
    return events.slice(fromVersion);
  }

  /**
   * Read all events from the global log.
   * Used for projections that need total ordering.
   */
  readAll(fromPosition: number = 0, limit: number = 1000): EventEnvelope[] {
    return this.globalLog.slice(fromPosition, fromPosition + limit);
  }

  /**
   * Get the current version for an aggregate.
   */
  getVersion(aggregateId: string): number {
    const events = this.aggregateEvents.get(aggregateId);
    return events?.length ?? 0;
  }

  /**
   * Get total event count.
   */
  getEventCount(): number {
    return this.globalLog.length;
  }

  /**
   * Get aggregate count.
   */
  getAggregateCount(): number {
    return this.aggregateEvents.size;
  }

  /**
   * Check if an aggregate exists.
   */
  exists(aggregateId: string): boolean {
    return this.aggregateEvents.has(aggregateId);
  }

  /**
   * Get global sequence position.
   */
  getGlobalPosition(): number {
    return this.globalSequence;
  }

  /**
   * Clear all events (for testing).
   */
  clear(): void {
    this.aggregateEvents.clear();
    this.globalLog = [];
    this.globalSequence = 0;
  }
}

/**
 * Event validator.
 *
 * Validates event structure and payload before appending.
 */
export class EventValidator {
  private eventTypes: Set<string>;

  constructor() {
    this.eventTypes = new Set([
      'conversation.started',
      'message.sent',
      'tier.changed',
      'conversation.ended',
    ]);
  }

  /**
   * Validate an event.
   */
  validate(event: Event): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields
    if (!event.id) {
      errors.push('Event ID is required');
    }
    if (!event.type) {
      errors.push('Event type is required');
    }
    if (!event.aggregateId) {
      errors.push('Aggregate ID is required');
    }
    if (typeof event.version !== 'number' || event.version < 1) {
      errors.push('Version must be a positive integer');
    }
    if (typeof event.timestamp !== 'number' || event.timestamp <= 0) {
      errors.push('Timestamp must be a positive number');
    }

    // Known event type
    if (event.type && !this.eventTypes.has(event.type)) {
      errors.push(`Unknown event type: ${event.type}`);
    }

    // Type-specific validation
    if (event.type === 'conversation.started') {
      const payload = event.payload as ConversationStartedEvent['payload'];
      if (!payload?.tenantId) {
        errors.push('conversation.started requires tenantId');
      }
      if (!payload?.userId) {
        errors.push('conversation.started requires userId');
      }
    }

    if (event.type === 'message.sent') {
      const payload = event.payload as MessageSentEvent['payload'];
      if (!payload?.role || !['user', 'assistant'].includes(payload.role)) {
        errors.push('message.sent requires role (user or assistant)');
      }
      if (typeof payload?.content !== 'string') {
        errors.push('message.sent requires content string');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Register a new event type.
   */
  registerEventType(type: string): void {
    this.eventTypes.add(type);
  }
}

/**
 * Schema registry for event versioning.
 *
 * Handles backward and forward compatibility as event schemas evolve.
 */
export class SchemaRegistry {
  private schemas: Map<string, Map<string, SchemaVersion>>;
  private migrations: Map<string, (event: Event) => Event>;

  constructor() {
    this.schemas = new Map();
    this.migrations = new Map();
  }

  /**
   * Register a schema version for an event type.
   */
  registerSchema(
    eventType: string,
    version: SchemaVersion,
    versionKey?: string
  ): void {
    const key = versionKey ?? `${version.major}.${version.minor}`;
    let typeSchemas = this.schemas.get(eventType);
    if (!typeSchemas) {
      typeSchemas = new Map();
      this.schemas.set(eventType, typeSchemas);
    }
    typeSchemas.set(key, version);
  }

  /**
   * Register a migration from one version to another.
   */
  registerMigration(
    eventType: string,
    fromVersion: string,
    toVersion: string,
    migrate: (event: Event) => Event
  ): void {
    const key = `${eventType}:${fromVersion}:${toVersion}`;
    this.migrations.set(key, migrate);
  }

  /**
   * Get the current schema version for an event type.
   */
  getCurrentVersion(eventType: string): SchemaVersion | null {
    const typeSchemas = this.schemas.get(eventType);
    if (!typeSchemas || typeSchemas.size === 0) {
      return null;
    }
    // Return highest version
    let highest: SchemaVersion = { major: 0, minor: 0 };
    for (const version of typeSchemas.values()) {
      if (
        version.major > highest.major ||
        (version.major === highest.major && version.minor > highest.minor)
      ) {
        highest = version;
      }
    }
    return highest;
  }

  /**
   * Migrate an event to a target version.
   */
  migrate(
    event: Event,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion
  ): Event {
    const fromKey = `${fromVersion.major}.${fromVersion.minor}`;
    const toKey = `${toVersion.major}.${toVersion.minor}`;
    const migrationKey = `${event.type}:${fromKey}:${toKey}`;

    const migration = this.migrations.get(migrationKey);
    if (!migration) {
      // No migration needed or available
      return event;
    }

    return migration(event);
  }
}
