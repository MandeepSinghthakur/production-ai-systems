// Base agent implementation with message handling.
// See Chapter 27, "Building Production AI Systems".

import type {
  AgentConfig,
  AgentMessage,
  AgentState,
  AgentTask,
  ConversationTurn,
} from './types.ts';
import type { TraceContext } from './tracing.ts';
import {
  TraceCollector,
  createChildSpan,
  completeSpan,
  generateId,
} from './tracing.ts';

/**
 * Base agent class that all agent types extend.
 */
export class Agent {
  protected config: AgentConfig;
  protected state: AgentState;
  protected messageQueue: AgentMessage[];
  protected currentTasks: Map<string, AgentTask>;
  protected conversationHistory: ConversationTurn[];
  protected traceCollector: TraceCollector;
  protected interrupted: boolean;

  constructor(config: AgentConfig, traceCollector: TraceCollector) {
    this.config = config;
    this.state = 'idle';
    this.messageQueue = [];
    this.currentTasks = new Map();
    this.conversationHistory = [];
    this.traceCollector = traceCollector;
    this.interrupted = false;
  }

  /**
   * Get the agent's ID.
   */
  getId(): string {
    return this.config.id;
  }

  /**
   * Get the agent's role.
   */
  getRole(): string {
    return this.config.role;
  }

  /**
   * Get the agent's current state.
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get the agent's capabilities.
   */
  getCapabilities(): string[] {
    return this.config.capabilities;
  }

  /**
   * Check if the agent can handle a specific capability.
   */
  hasCapability(capability: string): boolean {
    return this.config.capabilities.includes(capability);
  }

  /**
   * Get the conversation history.
   */
  getConversationHistory(): ConversationTurn[] {
    return [...this.conversationHistory];
  }

  /**
   * Add a turn to conversation history.
   */
  addToHistory(turn: ConversationTurn): void {
    this.conversationHistory.push(turn);
  }

  /**
   * Set the full conversation history (used during handoff).
   */
  setConversationHistory(history: ConversationTurn[]): void {
    this.conversationHistory = [...history];
  }

  /**
   * Check if agent was interrupted.
   */
  isInterrupted(): boolean {
    return this.interrupted;
  }

  /**
   * Receive a message.
   */
  receiveMessage(message: AgentMessage): void {
    this.messageQueue.push(message);

    if (message.type === 'interrupt') {
      this.handleInterrupt(message);
    }
  }

  /**
   * Handle an interrupt message.
   */
  protected handleInterrupt(message: AgentMessage): void {
    this.interrupted = true;
    this.state = 'idle';

    // Cancel all current tasks
    for (const [taskId, task] of this.currentTasks) {
      task.status = 'interrupted';
      task.error = 'Interrupted by supervisor';
      this.currentTasks.set(taskId, task);
    }
  }

  /**
   * Process a task.
   */
  async processTask(
    task: AgentTask,
    parentContext: TraceContext
  ): Promise<AgentTask> {
    if (this.interrupted) {
      return {
        ...task,
        status: 'interrupted',
        error: 'Agent was interrupted',
      };
    }

    this.state = 'working';
    this.currentTasks.set(task.id, task);

    // Create a child span for this task
    const { context, span } = createChildSpan(
      parentContext,
      `${this.config.role}:${task.type}`,
      this.config.id
    );

    span.tags['task.id'] = task.id;
    span.tags['task.type'] = task.type;

    try {
      // Simulate work
      const result = await this.executeTask(task, context);

      const completedSpan = completeSpan(span, 'completed');
      this.traceCollector.record(completedSpan);

      const completedTask: AgentTask = {
        ...task,
        status: 'completed',
        result,
      };

      this.currentTasks.set(task.id, completedTask);
      this.state = 'idle';

      return completedTask;
    } catch (error) {
      const errorSpan = completeSpan(span, 'error');
      this.traceCollector.record(errorSpan);

      const failedTask: AgentTask = {
        ...task,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };

      this.currentTasks.set(task.id, failedTask);
      this.state = 'idle';

      return failedTask;
    }
  }

  /**
   * Execute the actual task work. Override in subclasses.
   */
  protected async executeTask(
    task: AgentTask,
    context: TraceContext
  ): Promise<unknown> {
    // Default implementation - just return the payload
    return { processed: task.payload };
  }

  /**
   * Get pending task count.
   */
  getPendingTaskCount(): number {
    let count = 0;
    for (const task of this.currentTasks.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if agent can accept more tasks.
   */
  canAcceptTask(): boolean {
    return (
      !this.interrupted &&
      this.getPendingTaskCount() < this.config.maxConcurrentTasks
    );
  }

  /**
   * Reset the agent state.
   */
  reset(): void {
    this.state = 'idle';
    this.messageQueue = [];
    this.currentTasks.clear();
    this.conversationHistory = [];
    this.interrupted = false;
  }
}

/**
 * Create a basic agent with the given configuration.
 */
export function createAgent(
  config: AgentConfig,
  traceCollector: TraceCollector
): Agent {
  return new Agent(config, traceCollector);
}
