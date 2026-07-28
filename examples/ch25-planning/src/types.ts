// Core types for planning, reflection, and ReAct patterns.
// See Chapter 25, "Building Production AI Systems".

/**
 * A thought in the ReAct loop.
 */
export interface Thought {
  content: string;
  timestamp: number;
  iteration: number;
}

/**
 * An action to be executed.
 */
export interface Action {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  timestamp: number;
  iteration: number;
}

/**
 * An observation from executing an action.
 */
export interface Observation {
  actionName: string;
  success: boolean;
  result: unknown;
  error?: string;
  timestamp: number;
  iteration: number;
}

/**
 * A single step in the ReAct loop.
 */
export interface ReActStep {
  thought: Thought;
  action: Action;
  observation: Observation;
}

/**
 * Result of a ReAct execution.
 */
export interface ReActResult {
  goal: string;
  steps: ReActStep[];
  finalAnswer: string | null;
  success: boolean;
  terminationReason: TerminationReason;
  totalIterations: number;
  durationMs: number;
}

/**
 * Reasons for ReAct loop termination.
 */
export type TerminationReason =
  | 'goal_achieved'
  | 'max_iterations'
  | 'loop_detected'
  | 'error_limit'
  | 'manual_stop';

/**
 * Configuration for the ReAct loop.
 */
export interface ReActConfig {
  maxIterations: number;
  loopDetectionWindow: number;
  maxConsecutiveErrors: number;
  reflectionThreshold: number;
}

/**
 * A task in a plan.
 */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  subtasks: Task[];
  result?: unknown;
  error?: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Task status values.
 */
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

/**
 * A plan consisting of tasks.
 */
export interface Plan {
  id: string;
  goal: string;
  tasks: Task[];
  createdAt: number;
  completedAt?: number;
  status: PlanStatus;
}

/**
 * Plan status values.
 */
export type PlanStatus =
  | 'created'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'stuck';

/**
 * A reflection on action results.
 */
export interface Reflection {
  observation: Observation;
  analysis: string;
  shouldRetry: boolean;
  alternativeAction?: Action;
  lessonLearned: string;
  timestamp: number;
}

/**
 * Loop detection state.
 */
export interface LoopDetectorState {
  history: string[];
  loopDetected: boolean;
  loopPattern?: string[];
  iterationsInLoop: number;
}

/**
 * An available action that can be executed.
 */
export interface AvailableAction {
  name: string;
  description: string;
  parameters: ActionParameter[];
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * A parameter for an action.
 */
export interface ActionParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description: string;
}

/**
 * State for goal tracking across plan execution.
 */
export interface GoalState {
  originalGoal: string;
  currentSubgoal: string | null;
  completedSubgoals: string[];
  remainingSubgoals: string[];
  driftDetected: boolean;
  driftReason?: string;
}

/**
 * Checkpoint for backtracking.
 */
export interface Checkpoint {
  id: string;
  timestamp: number;
  planState: Plan;
  goalState: GoalState;
  iteration: number;
}
