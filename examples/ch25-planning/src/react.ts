// ReAct loop implementation.
//
// Implements the Reason-Act-Observe cycle with reflection,
// loop detection, and goal tracking.

import type {
  Thought,
  Action,
  Observation,
  ReActStep,
  ReActResult,
  ReActConfig,
  TerminationReason,
  GoalState,
} from './types.ts';
import { ActionExecutor } from './executor.ts';
import { Reflector } from './reflection.ts';
import { LoopDetector, ProgressDetector } from './loop-detector.ts';
import { Planner, createGoalState, markSubgoalComplete } from './planner.ts';

/**
 * Default ReAct configuration.
 */
export const DEFAULT_REACT_CONFIG: ReActConfig = {
  maxIterations: 10,
  loopDetectionWindow: 6,
  maxConsecutiveErrors: 3,
  reflectionThreshold: 0.5,
};

/**
 * ReAct loop executor.
 *
 * Implements the Reason -> Act -> Observe cycle with support for
 * reflection, loop detection, and planning.
 */
export class ReActLoop {
  private config: ReActConfig;
  private executor: ActionExecutor;
  private reflector: Reflector;
  private loopDetector: LoopDetector;
  private progressDetector: ProgressDetector;
  private planner: Planner;
  private reasoningFn: ReasoningFunction;

  constructor(
    executor: ActionExecutor,
    reasoningFn: ReasoningFunction,
    config?: Partial<ReActConfig>
  ) {
    this.config = { ...DEFAULT_REACT_CONFIG, ...config };
    this.executor = executor;
    this.reflector = new Reflector();
    this.loopDetector = new LoopDetector(this.config.loopDetectionWindow);
    this.progressDetector = new ProgressDetector(5);
    this.planner = new Planner();
    this.reasoningFn = reasoningFn;
  }

  /**
   * Execute the ReAct loop for a goal.
   */
  async run(goal: string): Promise<ReActResult> {
    const startTime = Date.now();
    const steps: ReActStep[] = [];
    let iteration = 0;
    let consecutiveErrors = 0;
    let terminationReason: TerminationReason = 'max_iterations';
    let finalAnswer: string | null = null;

    // Create initial goal state
    const plan = this.planner.decompose(goal);
    let goalState = createGoalState(plan);

    while (iteration < this.config.maxIterations) {
      iteration++;

      // Phase 1: Reason
      const thought = await this.reason(goal, steps, goalState, iteration);

      // Phase 2: Act
      const action = await this.selectAction(thought, steps, goal, iteration);

      // Phase 3: Observe
      const observation = await this.executor.execute(action);

      // Record the step
      steps.push({ thought, action, observation });

      // Check for loop
      const loopState = this.loopDetector.recordObservation(action, observation);
      if (loopState.loopDetected && loopState.iterationsInLoop >= 2) {
        terminationReason = 'loop_detected';
        break;
      }

      // Check for consecutive errors
      if (!observation.success) {
        consecutiveErrors++;
        if (consecutiveErrors >= this.config.maxConsecutiveErrors) {
          terminationReason = 'error_limit';
          break;
        }

        // Reflect on failure
        const reflection = this.reflector.reflect(
          action,
          observation,
          this.executor.getAvailableActions(),
          goal
        );

        // If reflection suggests alternative, we'll use it in next iteration
        if (reflection.alternativeAction) {
          // Alternative is available for next reasoning step
        }
      } else {
        consecutiveErrors = 0;
        this.progressDetector.recordMilestone(`${action.name}:success`);
      }

      // Check for goal completion
      if (this.isGoalAchieved(action, observation)) {
        terminationReason = 'goal_achieved';
        finalAnswer = this.extractAnswer(observation);
        break;
      }

      // Update goal state
      goalState = this.updateGoalState(goalState, action, observation);

      // Track progress
      this.progressDetector.recordIteration();
    }

    return {
      goal,
      steps,
      finalAnswer,
      success: terminationReason === 'goal_achieved',
      terminationReason,
      totalIterations: iteration,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Generate a thought based on current state.
   */
  private async reason(
    goal: string,
    steps: ReActStep[],
    goalState: GoalState,
    iteration: number
  ): Promise<Thought> {
    const context = this.buildReasoningContext(goal, steps, goalState);
    const content = await this.reasoningFn(context);

    return {
      content,
      timestamp: Date.now(),
      iteration,
    };
  }

  /**
   * Build context for reasoning.
   */
  private buildReasoningContext(
    goal: string,
    steps: ReActStep[],
    goalState: GoalState
  ): ReasoningContext {
    const recentSteps = steps.slice(-3);
    const lastObservation = steps.length > 0
      ? steps[steps.length - 1].observation
      : null;

    // Get lessons from reflector
    const lessons = this.reflector.getAllLessons();
    const lessonSummary = Array.from(lessons.entries())
      .map(([action, actionLessons]) => `${action}: ${actionLessons[actionLessons.length - 1]}`)
      .join('; ');

    return {
      goal,
      recentSteps,
      lastObservation,
      goalState,
      availableActions: this.executor.getAvailableActions(),
      lessonsSummary: lessonSummary || 'No lessons yet',
    };
  }

  /**
   * Select an action based on thought.
   */
  private async selectAction(
    thought: Thought,
    steps: ReActStep[],
    goal: string,
    iteration: number
  ): Promise<Action> {
    // Simple rule-based action selection based on thought content
    const content = thought.content.toLowerCase();
    const availableActions = this.executor.getAvailableActions();

    // If thought mentions finishing
    if (content.includes('finish') || content.includes('answer is') ||
        content.includes('found the') || content.includes('complete')) {
      if (availableActions.includes('finish')) {
        const answerMatch = thought.content.match(/answer[:\s]+([^.]+)/i);
        return {
          type: 'direct',
          name: 'finish',
          parameters: { answer: answerMatch ? answerMatch[1].trim() : 'Task complete' },
          timestamp: Date.now(),
          iteration,
        };
      }
    }

    // If thought mentions calculation
    if (content.includes('calculate') || content.includes('compute') ||
        content.includes('math')) {
      if (availableActions.includes('calculate')) {
        const exprMatch = thought.content.match(/calculate[:\s]+([^.]+)/i);
        return {
          type: 'direct',
          name: 'calculate',
          parameters: { expression: exprMatch ? exprMatch[1].trim() : '0' },
          timestamp: Date.now(),
          iteration,
        };
      }
    }

    // If thought mentions lookup
    if (content.includes('lookup') || content.includes('look up') ||
        content.includes('find') || content.includes('what is')) {
      if (availableActions.includes('lookup')) {
        // Try to extract "capital of France" pattern
        const capitalOfMatch = thought.content.match(/capital\s+of\s+(\w+)/i);
        if (capitalOfMatch) {
          return {
            type: 'direct',
            name: 'lookup',
            parameters: {
              entity: capitalOfMatch[1].toLowerCase(),
              attribute: 'capital',
            },
            timestamp: Date.now(),
            iteration,
          };
        }

        // Try to extract "population of France" pattern
        const attrOfMatch = thought.content.match(/(\w+)\s+of\s+(\w+)/i);
        if (attrOfMatch) {
          return {
            type: 'direct',
            name: 'lookup',
            parameters: {
              entity: attrOfMatch[2].toLowerCase(),
              attribute: attrOfMatch[1].toLowerCase(),
            },
            timestamp: Date.now(),
            iteration,
          };
        }

        // Fallback: extract from goal
        const goalCapitalMatch = goal.match(/capital\s+of\s+(\w+)/i);
        if (goalCapitalMatch) {
          return {
            type: 'direct',
            name: 'lookup',
            parameters: {
              entity: goalCapitalMatch[1].toLowerCase(),
              attribute: 'capital',
            },
            timestamp: Date.now(),
            iteration,
          };
        }

        return {
          type: 'direct',
          name: 'lookup',
          parameters: {
            entity: goal.split(' ').pop()?.toLowerCase() ?? 'unknown',
            attribute: 'capital',
          },
          timestamp: Date.now(),
          iteration,
        };
      }
    }

    // Default to search
    if (availableActions.includes('search')) {
      return {
        type: 'direct',
        name: 'search',
        parameters: { query: goal },
        timestamp: Date.now(),
        iteration,
      };
    }

    // Fallback to first available action
    return {
      type: 'fallback',
      name: availableActions[0] ?? 'unknown',
      parameters: {},
      timestamp: Date.now(),
      iteration,
    };
  }

  /**
   * Check if the goal has been achieved.
   */
  private isGoalAchieved(action: Action, observation: Observation): boolean {
    if (!observation.success) {
      return false;
    }

    // Check if finish action was called
    if (action.name === 'finish') {
      return true;
    }

    // Check if result indicates completion
    const result = observation.result as Record<string, unknown> | null;
    if (result && result.finished === true) {
      return true;
    }

    return false;
  }

  /**
   * Extract the final answer from an observation.
   */
  private extractAnswer(observation: Observation): string | null {
    if (!observation.success) {
      return null;
    }

    const result = observation.result as Record<string, unknown> | null;
    if (result) {
      if (result.answer) {
        return String(result.answer);
      }
      if (result.value) {
        return String(result.value);
      }
      if (result.results && Array.isArray(result.results)) {
        return result.results.join('; ');
      }
      if (result.result !== undefined) {
        return String(result.result);
      }
    }

    return JSON.stringify(observation.result);
  }

  /**
   * Update goal state based on action/observation.
   */
  private updateGoalState(
    state: GoalState,
    action: Action,
    observation: Observation
  ): GoalState {
    if (!observation.success) {
      return state;
    }

    // Check if current subgoal is addressed
    if (state.currentSubgoal) {
      const subgoalWords = state.currentSubgoal.toLowerCase().split(/\s+/);
      const resultStr = JSON.stringify(observation.result).toLowerCase();

      const addressed = subgoalWords.some((word) =>
        word.length > 3 && resultStr.includes(word)
      );

      if (addressed) {
        return markSubgoalComplete(state, state.currentSubgoal);
      }
    }

    return state;
  }

  /**
   * Get the reflector for inspection.
   */
  getReflector(): Reflector {
    return this.reflector;
  }

  /**
   * Get the loop detector for inspection.
   */
  getLoopDetector(): LoopDetector {
    return this.loopDetector;
  }

  /**
   * Get the progress detector for inspection.
   */
  getProgressDetector(): ProgressDetector {
    return this.progressDetector;
  }

  /**
   * Reset all internal state.
   */
  reset(): void {
    this.reflector.reset();
    this.loopDetector.reset();
    this.progressDetector.reset();
    this.planner.clearCheckpoints();
  }
}

/**
 * Context provided to the reasoning function.
 */
export interface ReasoningContext {
  goal: string;
  recentSteps: ReActStep[];
  lastObservation: Observation | null;
  goalState: GoalState;
  availableActions: string[];
  lessonsSummary: string;
}

/**
 * Function type for generating reasoning.
 */
export type ReasoningFunction = (context: ReasoningContext) => Promise<string>;

/**
 * Create a simple rule-based reasoning function for testing.
 */
export function createSimpleReasoning(): ReasoningFunction {
  return async (context: ReasoningContext) => {
    const { goal, recentSteps, lastObservation, availableActions } = context;

    // No steps yet - start with search or lookup
    if (recentSteps.length === 0) {
      if (goal.toLowerCase().includes('capital')) {
        return `I need to find the capital. I should lookup the capital of the country mentioned in the goal: ${goal}`;
      }
      return `Starting to work on goal: ${goal}. I should search for relevant information.`;
    }

    // Last action succeeded
    if (lastObservation && lastObservation.success) {
      const result = JSON.stringify(lastObservation.result);

      // Check if we have a good answer
      if (result.includes('Paris') || result.includes('Berlin') || result.includes('Tokyo')) {
        return `I found the answer: ${result}. I should finish with this answer.`;
      }

      // Check if finish action is available and we have results
      if (availableActions.includes('finish') && lastObservation.result) {
        const answer = typeof lastObservation.result === 'object'
          ? JSON.stringify(lastObservation.result)
          : String(lastObservation.result);
        return `The answer is ${answer}. Finish with this answer.`;
      }
    }

    // Last action failed
    if (lastObservation && !lastObservation.success) {
      const error = lastObservation.error ?? 'Unknown error';

      if (error.includes('not found')) {
        return `The lookup failed because the entity was not found. I should try a search instead.`;
      }

      return `Last action failed with: ${error}. I need to try a different approach.`;
    }

    // Default reasoning
    return `Continuing to work on: ${goal}. Next step is to gather more information.`;
  };
}

/**
 * Create a reasoning function that always suggests the same action (for testing loops).
 */
export function createRepeatingReasoning(actionName: string): ReasoningFunction {
  return async () => {
    return `I should try ${actionName} again.`;
  };
}
