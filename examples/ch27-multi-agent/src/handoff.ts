// Context-preserving agent handoff.
// See Chapter 27, "Building Production AI Systems".

import type {
  AgentMessage,
  ConversationTurn,
  HandoffContext,
} from './types.ts';
import type { TraceContext } from './tracing.ts';
import { Agent } from './agent.ts';
import {
  TraceCollector,
  createChildSpan,
  completeSpan,
  generateId,
} from './tracing.ts';

/**
 * Result of an agent handoff.
 */
export interface HandoffResult {
  success: boolean;
  fromAgent: string;
  toAgent: string;
  contextPreserved: boolean;
  historyLength: number;
  traceCorrelated: boolean;
  error?: string;
}

/**
 * Manages handoffs between agents with context preservation.
 */
export class HandoffManager {
  private agents: Map<string, Agent>;
  private traceCollector: TraceCollector;

  constructor(traceCollector: TraceCollector) {
    this.agents = new Map();
    this.traceCollector = traceCollector;
  }

  /**
   * Register an agent with the handoff manager.
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.getId(), agent);
  }

  /**
   * Get a registered agent by ID.
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Perform a handoff from one agent to another.
   * Preserves conversation history and maintains trace correlation.
   */
  handoff(
    fromAgentId: string,
    toAgentId: string,
    parentContext: TraceContext,
    additionalPayload?: unknown
  ): HandoffResult {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    if (!fromAgent) {
      return {
        success: false,
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        contextPreserved: false,
        historyLength: 0,
        traceCorrelated: false,
        error: `Source agent ${fromAgentId} not found`,
      };
    }

    if (!toAgent) {
      return {
        success: false,
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        contextPreserved: false,
        historyLength: 0,
        traceCorrelated: false,
        error: `Target agent ${toAgentId} not found`,
      };
    }

    // Create a handoff span
    const { context, span } = createChildSpan(
      parentContext,
      'handoff',
      fromAgentId
    );
    span.tags['handoff.from'] = fromAgentId;
    span.tags['handoff.to'] = toAgentId;

    try {
      // Get conversation history from source agent
      const history = fromAgent.getConversationHistory();

      // Build handoff context
      const handoffContext: HandoffContext = {
        conversationHistory: history,
        metadata: {
          handoffTime: Date.now(),
          fromAgent: fromAgentId,
          toAgent: toAgentId,
        },
        traceId: parentContext.traceId,
        parentSpanId: context.spanId,
        originalRequest: additionalPayload,
      };

      // Transfer conversation history to target agent
      toAgent.setConversationHistory(history);

      // Add a system turn to note the handoff
      toAgent.addToHistory({
        role: 'system',
        content: `Conversation handed off from ${fromAgentId}`,
        timestamp: Date.now(),
        agentId: toAgentId,
      });

      // Create handoff message
      const message: AgentMessage = {
        id: generateId(),
        traceId: parentContext.traceId,
        parentSpanId: context.spanId,
        spanId: generateId(),
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        type: 'handoff',
        payload: handoffContext,
        timestamp: Date.now(),
      };

      toAgent.receiveMessage(message);

      // Complete the handoff span
      const completedSpan = completeSpan(span, 'completed');
      this.traceCollector.record(completedSpan);

      return {
        success: true,
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        contextPreserved: true,
        historyLength: toAgent.getConversationHistory().length,
        traceCorrelated: true,
      };
    } catch (error) {
      const errorSpan = completeSpan(span, 'error');
      this.traceCollector.record(errorSpan);

      return {
        success: false,
        fromAgent: fromAgentId,
        toAgent: toAgentId,
        contextPreserved: false,
        historyLength: 0,
        traceCorrelated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Verify that a handoff preserved context correctly.
   */
  verifyHandoff(
    fromAgentId: string,
    toAgentId: string
  ): {
    contextPreserved: boolean;
    fromHistory: ConversationTurn[];
    toHistory: ConversationTurn[];
  } {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    const fromHistory = fromAgent?.getConversationHistory() ?? [];
    const toHistory = toAgent?.getConversationHistory() ?? [];

    // Check if toAgent has all the history from fromAgent
    // (toHistory will have one extra system message about the handoff)
    const contextPreserved =
      toHistory.length >= fromHistory.length &&
      fromHistory.every((turn, i) => {
        const toTurn = toHistory[i];
        return (
          toTurn &&
          toTurn.role === turn.role &&
          toTurn.content === turn.content
        );
      });

    return {
      contextPreserved,
      fromHistory,
      toHistory,
    };
  }

  /**
   * Clear all registered agents.
   */
  clear(): void {
    this.agents.clear();
  }
}
