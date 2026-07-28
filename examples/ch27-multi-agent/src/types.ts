// Core types for multi-agent orchestration.
// See Chapter 27, "Building Production AI Systems".

/**
 * Agent role in the orchestration hierarchy.
 */
export type AgentRole = 'supervisor' | 'worker' | 'specialist';

/**
 * Agent state in the lifecycle.
 */
export type AgentState = 'idle' | 'working' | 'waiting' | 'terminated';

/**
 * Message passed between agents.
 */
export interface AgentMessage {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  spanId: string;
  fromAgent: string;
  toAgent: string;
  type: 'request' | 'response' | 'interrupt' | 'handoff';
  payload: unknown;
  timestamp: number;
}

/**
 * Conversation turn in the context.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  agentId?: string;
}

/**
 * Context passed during agent handoff.
 */
export interface HandoffContext {
  conversationHistory: ConversationTurn[];
  metadata: Record<string, unknown>;
  traceId: string;
  parentSpanId: string;
  originalRequest: unknown;
}

/**
 * Agent configuration.
 */
export interface AgentConfig {
  id: string;
  role: AgentRole;
  capabilities: string[];
  maxConcurrentTasks: number;
  timeoutMs: number;
}

/**
 * Task assigned to an agent.
 */
export interface AgentTask {
  id: string;
  traceId: string;
  spanId: string;
  type: string;
  payload: unknown;
  assignedTo: string;
  assignedAt: number;
  deadline: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted';
  result?: unknown;
  error?: string;
}

/**
 * Trace span for distributed tracing.
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  agentId: string;
  startTime: number;
  endTime: number | null;
  status: 'running' | 'completed' | 'error';
  tags: Record<string, string>;
}

/**
 * Deadlock detection state.
 */
export interface WaitState {
  agentId: string;
  waitingFor: string;
  since: number;
  taskId: string;
}

/**
 * Result of deadlock detection.
 */
export interface DeadlockResult {
  detected: boolean;
  cycle: string[];
  waitStates: WaitState[];
}

/**
 * Orchestration pattern type.
 */
export type OrchestrationPattern = 'pipeline' | 'swarm' | 'hierarchical';

/**
 * Pipeline stage definition.
 */
export interface PipelineStage {
  agentId: string;
  transform: (input: unknown) => unknown;
}

/**
 * Result of swarm execution.
 */
export interface SwarmResult {
  results: Array<{ agentId: string; result: unknown }>;
  aggregated: unknown;
  completedAt: number;
}

/**
 * Supervisor interrupt command.
 */
export interface InterruptCommand {
  targetAgent: string;
  taskId: string;
  reason: string;
  timestamp: number;
}

/**
 * Metrics for multi-agent orchestration.
 */
export interface OrchestratorMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  tasksInterrupted: number;
  handoffsSuccessful: number;
  handoffsFailed: number;
  deadlocksDetected: number;
  deadlocksResolved: number;
  averageTaskDurationMs: number;
}
