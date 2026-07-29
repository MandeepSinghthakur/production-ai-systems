// CQRS (Command Query Responsibility Segregation) implementation.
// Separates write operations (commands) from read operations (queries).

import type {
  Event,
  ConversationCommand,
  CommandResult,
  ConversationSummary,
  TenantAnalytics,
  EventEnvelope,
  ModelTier,
  StartConversationCommand,
  SendMessageCommand,
  ChangeTierCommand,
  EndConversationCommand,
  ConversationAggregate,
} from './types.ts';
import {
  InMemoryEventStore,
  createConversationStartedEvent,
  createMessageSentEvent,
  createTierChangedEvent,
  createConversationEndedEvent,
} from './events.ts';
import { ConversationRepository, rehydrateConversation } from './sourcing.ts';

/**
 * Command handler for conversation commands.
 *
 * The command handler is the write side of CQRS. It:
 * 1. Validates the command
 * 2. Loads the aggregate
 * 3. Applies business rules
 * 4. Generates events
 * 5. Saves events to the event store
 */
export class ConversationCommandHandler {
  private repository: ConversationRepository;
  private eventStore: InMemoryEventStore;

  constructor(eventStore: InMemoryEventStore) {
    this.eventStore = eventStore;
    this.repository = new ConversationRepository(eventStore);
  }

  /**
   * Handle a command.
   */
  handle(command: ConversationCommand): CommandResult {
    switch (command.type) {
      case 'start_conversation':
        return this.handleStartConversation(command);
      case 'send_message':
        return this.handleSendMessage(command);
      case 'change_tier':
        return this.handleChangeTier(command);
      case 'end_conversation':
        return this.handleEndConversation(command);
      default:
        return {
          success: false,
          events: [],
          error: `Unknown command type: ${(command as any).type}`,
        };
    }
  }

  private handleStartConversation(
    command: StartConversationCommand
  ): CommandResult {
    // Validate: conversation should not already exist
    if (this.repository.exists(command.conversationId)) {
      return {
        success: false,
        events: [],
        error: `Conversation ${command.conversationId} already exists`,
      };
    }

    // Create event
    const event = createConversationStartedEvent(
      command.conversationId,
      1, // First event, version 1
      command.tenantId,
      command.userId,
      command.tier,
      command.systemPrompt
    );

    // Save event
    const result = this.repository.save(
      command.conversationId,
      [event],
      0 // Expected version 0 (new aggregate)
    );

    if (!result.success) {
      return { success: false, events: [], error: result.error };
    }

    return { success: true, events: [event] };
  }

  private handleSendMessage(command: SendMessageCommand): CommandResult {
    // Load aggregate
    const aggregate = this.repository.load(command.conversationId);
    if (!aggregate) {
      return {
        success: false,
        events: [],
        error: `Conversation ${command.conversationId} not found`,
      };
    }

    // Validate: conversation should be active
    if (aggregate.status !== 'active') {
      return {
        success: false,
        events: [],
        error: 'Cannot send message to ended conversation',
      };
    }

    // Create event
    const event = createMessageSentEvent(
      command.conversationId,
      aggregate.version + 1,
      command.role,
      command.content,
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.latencyMs ?? null,
      command.tier ?? null
    );

    // Save event
    const result = this.repository.save(
      command.conversationId,
      [event],
      aggregate.version
    );

    if (!result.success) {
      return { success: false, events: [], error: result.error };
    }

    return { success: true, events: [event] };
  }

  private handleChangeTier(command: ChangeTierCommand): CommandResult {
    // Load aggregate
    const aggregate = this.repository.load(command.conversationId);
    if (!aggregate) {
      return {
        success: false,
        events: [],
        error: `Conversation ${command.conversationId} not found`,
      };
    }

    // Validate: conversation should be active
    if (aggregate.status !== 'active') {
      return {
        success: false,
        events: [],
        error: 'Cannot change tier of ended conversation',
      };
    }

    // Validate: tier should actually change
    if (aggregate.currentTier === command.newTier) {
      return {
        success: false,
        events: [],
        error: `Tier is already ${command.newTier}`,
      };
    }

    // Create event
    const event = createTierChangedEvent(
      command.conversationId,
      aggregate.version + 1,
      aggregate.currentTier,
      command.newTier,
      command.reason
    );

    // Save event
    const result = this.repository.save(
      command.conversationId,
      [event],
      aggregate.version
    );

    if (!result.success) {
      return { success: false, events: [], error: result.error };
    }

    return { success: true, events: [event] };
  }

  private handleEndConversation(command: EndConversationCommand): CommandResult {
    // Load aggregate
    const aggregate = this.repository.load(command.conversationId);
    if (!aggregate) {
      return {
        success: false,
        events: [],
        error: `Conversation ${command.conversationId} not found`,
      };
    }

    // Validate: conversation should be active
    if (aggregate.status !== 'active') {
      return {
        success: false,
        events: [],
        error: 'Conversation is already ended',
      };
    }

    // Calculate duration
    const durationMs = Date.now() - aggregate.startedAt;

    // Create event
    const event = createConversationEndedEvent(
      command.conversationId,
      aggregate.version + 1,
      command.reason,
      aggregate.messages.length,
      aggregate.totalInputTokens,
      aggregate.totalOutputTokens,
      durationMs
    );

    // Save event
    const result = this.repository.save(
      command.conversationId,
      [event],
      aggregate.version
    );

    if (!result.success) {
      return { success: false, events: [], error: result.error };
    }

    return { success: true, events: [event] };
  }
}

/**
 * Read model projection for conversation summaries.
 *
 * This is the read side of CQRS. It maintains a denormalized view
 * of the data optimized for queries, updated by processing events.
 */
export class ConversationSummaryProjection {
  private summaries: Map<string, ConversationSummary>;
  private position: number;

  constructor() {
    this.summaries = new Map();
    this.position = 0;
  }

  /**
   * Apply an event to update the read model.
   */
  apply(envelope: EventEnvelope): void {
    const event = envelope.event;

    switch (event.type) {
      case 'conversation.started': {
        const payload = event.payload as {
          tenantId: string;
          userId: string;
          tier: ModelTier;
        };
        this.summaries.set(event.aggregateId, {
          id: event.aggregateId,
          tenantId: payload.tenantId,
          userId: payload.userId,
          messageCount: 0,
          lastMessageAt: event.timestamp,
          totalTokens: 0,
          currentTier: payload.tier,
          status: 'active',
        });
        break;
      }

      case 'message.sent': {
        const summary = this.summaries.get(event.aggregateId);
        if (summary) {
          const payload = event.payload as {
            inputTokens: number | null;
            outputTokens: number | null;
          };
          summary.messageCount++;
          summary.lastMessageAt = event.timestamp;
          if (payload.inputTokens) {
            summary.totalTokens += payload.inputTokens;
          }
          if (payload.outputTokens) {
            summary.totalTokens += payload.outputTokens;
          }
        }
        break;
      }

      case 'tier.changed': {
        const summary = this.summaries.get(event.aggregateId);
        if (summary) {
          const payload = event.payload as { newTier: ModelTier };
          summary.currentTier = payload.newTier;
        }
        break;
      }

      case 'conversation.ended': {
        const summary = this.summaries.get(event.aggregateId);
        if (summary) {
          summary.status = 'ended';
        }
        break;
      }
    }

    this.position++;
  }

  /**
   * Get a conversation summary by ID.
   */
  get(conversationId: string): ConversationSummary | null {
    return this.summaries.get(conversationId) ?? null;
  }

  /**
   * Get all active conversations.
   */
  getActive(): ConversationSummary[] {
    return Array.from(this.summaries.values()).filter(
      (s) => s.status === 'active'
    );
  }

  /**
   * Get conversations for a tenant.
   */
  getByTenant(tenantId: string): ConversationSummary[] {
    return Array.from(this.summaries.values()).filter(
      (s) => s.tenantId === tenantId
    );
  }

  /**
   * Get conversations for a user.
   */
  getByUser(userId: string): ConversationSummary[] {
    return Array.from(this.summaries.values()).filter(
      (s) => s.userId === userId
    );
  }

  /**
   * Get current position (last processed event).
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Rebuild projection from scratch.
   */
  rebuild(events: EventEnvelope[]): void {
    this.summaries.clear();
    this.position = 0;
    for (const envelope of events) {
      this.apply(envelope);
    }
  }

  /**
   * Get total count.
   */
  getCount(): number {
    return this.summaries.size;
  }
}

/**
 * Read model projection for tenant analytics.
 *
 * Aggregates data across all conversations for a tenant.
 */
export class TenantAnalyticsProjection {
  private analytics: Map<string, TenantAnalytics>;
  private conversationTenants: Map<string, string>; // conversationId -> tenantId
  private position: number;

  constructor() {
    this.analytics = new Map();
    this.conversationTenants = new Map();
    this.position = 0;
  }

  /**
   * Apply an event to update tenant analytics.
   */
  apply(envelope: EventEnvelope): void {
    const event = envelope.event;

    switch (event.type) {
      case 'conversation.started': {
        const payload = event.payload as {
          tenantId: string;
          tier: ModelTier;
        };
        // Track which tenant owns this conversation
        this.conversationTenants.set(event.aggregateId, payload.tenantId);
        const analytics = this.getOrCreate(payload.tenantId);
        analytics.totalConversations++;
        analytics.activeConversations++;
        analytics.tierUsage[payload.tier] =
          (analytics.tierUsage[payload.tier] ?? 0) + 1;
        break;
      }

      case 'message.sent': {
        // Look up tenant from our tracked map
        const tenantId = this.conversationTenants.get(event.aggregateId);
        if (tenantId) {
          const analytics = this.getOrCreate(tenantId);
          const payload = event.payload as {
            inputTokens: number | null;
            outputTokens: number | null;
          };
          analytics.totalMessages++;
          if (payload.inputTokens) {
            analytics.totalTokens += payload.inputTokens;
          }
          if (payload.outputTokens) {
            analytics.totalTokens += payload.outputTokens;
          }
        }
        break;
      }

      case 'conversation.ended': {
        // Look up tenant from our tracked map
        const tenantId = this.conversationTenants.get(event.aggregateId);
        if (tenantId) {
          const analytics = this.analytics.get(tenantId);
          if (analytics) {
            analytics.activeConversations = Math.max(
              0,
              analytics.activeConversations - 1
            );
          }
        }
        break;
      }
    }

    this.position++;
  }

  private getOrCreate(tenantId: string): TenantAnalytics {
    let analytics = this.analytics.get(tenantId);
    if (!analytics) {
      analytics = {
        tenantId,
        activeConversations: 0,
        totalConversations: 0,
        totalMessages: 0,
        totalTokens: 0,
        tierUsage: {} as Record<ModelTier, number>,
      };
      this.analytics.set(tenantId, analytics);
    }
    return analytics;
  }

  /**
   * Get analytics for a tenant.
   */
  get(tenantId: string): TenantAnalytics | null {
    return this.analytics.get(tenantId) ?? null;
  }

  /**
   * Get all tenant analytics.
   */
  getAll(): TenantAnalytics[] {
    return Array.from(this.analytics.values());
  }

  /**
   * Get current position.
   */
  getPosition(): number {
    return this.position;
  }

  /**
   * Rebuild projection from scratch.
   */
  rebuild(events: EventEnvelope[]): void {
    this.analytics.clear();
    this.position = 0;
    for (const envelope of events) {
      this.apply(envelope);
    }
  }
}

/**
 * Projection manager coordinates multiple projections.
 *
 * Ensures all projections process events in order and tracks
 * their positions for catch-up after restart.
 */
export class ProjectionManager {
  private projections: Map<string, {
    projection: ConversationSummaryProjection | TenantAnalyticsProjection;
    position: number;
  }>;
  private eventStore: InMemoryEventStore;

  constructor(eventStore: InMemoryEventStore) {
    this.projections = new Map();
    this.eventStore = eventStore;
  }

  /**
   * Register a projection.
   */
  register(
    name: string,
    projection: ConversationSummaryProjection | TenantAnalyticsProjection
  ): void {
    this.projections.set(name, {
      projection,
      position: projection.getPosition(),
    });
  }

  /**
   * Catch up all projections to current event position.
   */
  catchUp(): { processed: number; projections: string[] } {
    let totalProcessed = 0;
    const updated: string[] = [];

    for (const [name, entry] of this.projections) {
      const events = this.eventStore.readAll(entry.position);
      if (events.length > 0) {
        for (const envelope of events) {
          entry.projection.apply(envelope);
        }
        entry.position = entry.projection.getPosition();
        totalProcessed += events.length;
        updated.push(name);
      }
    }

    return { processed: totalProcessed, projections: updated };
  }

  /**
   * Get projection by name.
   */
  getProjection(
    name: string
  ): ConversationSummaryProjection | TenantAnalyticsProjection | null {
    return this.projections.get(name)?.projection ?? null;
  }

  /**
   * Get positions of all projections.
   */
  getPositions(): Record<string, number> {
    const positions: Record<string, number> = {};
    for (const [name, entry] of this.projections) {
      positions[name] = entry.position;
    }
    return positions;
  }
}
