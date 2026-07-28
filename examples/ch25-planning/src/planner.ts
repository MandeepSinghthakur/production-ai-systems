// Task decomposition and plan management.
//
// Breaks complex goals into subtasks, tracks dependencies,
// and manages plan execution state.

import type {
  Task,
  Plan,
  TaskStatus,
  PlanStatus,
  GoalState,
  Checkpoint,
} from './types.ts';

/**
 * Creates and manages task plans.
 */
export class Planner {
  private checkpoints: Checkpoint[];

  constructor() {
    this.checkpoints = [];
  }

  /**
   * Decompose a goal into a plan with tasks.
   */
  decompose(goal: string): Plan {
    const tasks = this.generateTasks(goal);

    return {
      id: `plan_${Date.now()}`,
      goal,
      tasks,
      createdAt: Date.now(),
      status: 'created',
    };
  }

  /**
   * Generate tasks for a goal using simple heuristics.
   *
   * In production, this would call a model to generate tasks.
   */
  private generateTasks(goal: string): Task[] {
    const tasks: Task[] = [];
    const goalLower = goal.toLowerCase();

    // Pattern: "Find X and Y"
    const andMatch = goal.match(/find\s+(.+?)\s+and\s+(.+)/i);
    if (andMatch) {
      tasks.push(
        this.createTask(`find_first`, `Find ${andMatch[1]}`, []),
        this.createTask(`find_second`, `Find ${andMatch[2]}`, []),
        this.createTask(`combine`, 'Combine results', ['find_first', 'find_second'])
      );
      return tasks;
    }

    // Pattern: "Calculate X given Y"
    if (goalLower.includes('calculate')) {
      tasks.push(
        this.createTask('gather_inputs', 'Gather calculation inputs', []),
        this.createTask('perform_calculation', 'Perform the calculation', ['gather_inputs']),
        this.createTask('verify_result', 'Verify the result', ['perform_calculation'])
      );
      return tasks;
    }

    // Pattern: "Compare X to Y"
    const compareMatch = goal.match(/compare\s+(.+?)\s+to\s+(.+)/i);
    if (compareMatch) {
      tasks.push(
        this.createTask('lookup_first', `Look up ${compareMatch[1]}`, []),
        this.createTask('lookup_second', `Look up ${compareMatch[2]}`, []),
        this.createTask('compare', 'Compare the two values', ['lookup_first', 'lookup_second'])
      );
      return tasks;
    }

    // Default: simple single-step task
    tasks.push(this.createTask('main', goal, []));
    return tasks;
  }

  /**
   * Create a task with defaults.
   */
  private createTask(
    id: string,
    description: string,
    dependencies: string[]
  ): Task {
    return {
      id,
      description,
      status: 'pending',
      dependencies,
      subtasks: [],
      attempts: 0,
      maxAttempts: 3,
    };
  }

  /**
   * Get the next executable task from a plan.
   */
  getNextTask(plan: Plan): Task | null {
    for (const task of plan.tasks) {
      if (task.status === 'pending' && this.dependenciesMet(task, plan)) {
        return task;
      }

      // Check subtasks
      for (const subtask of task.subtasks) {
        if (subtask.status === 'pending' && this.dependenciesMet(subtask, plan)) {
          return subtask;
        }
      }
    }
    return null;
  }

  /**
   * Check if all dependencies of a task are completed.
   */
  private dependenciesMet(task: Task, plan: Plan): boolean {
    for (const depId of task.dependencies) {
      const dep = this.findTask(plan, depId);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Find a task by ID in a plan.
   */
  private findTask(plan: Plan, taskId: string): Task | null {
    for (const task of plan.tasks) {
      if (task.id === taskId) {
        return task;
      }
      for (const subtask of task.subtasks) {
        if (subtask.id === taskId) {
          return subtask;
        }
      }
    }
    return null;
  }

  /**
   * Update a task's status.
   */
  updateTaskStatus(plan: Plan, taskId: string, status: TaskStatus, result?: unknown): void {
    const task = this.findTask(plan, taskId);
    if (task) {
      task.status = status;
      if (result !== undefined) {
        task.result = result;
      }
      this.updatePlanStatus(plan);
    }
  }

  /**
   * Mark a task as failed with an error.
   */
  markTaskFailed(plan: Plan, taskId: string, error: string): void {
    const task = this.findTask(plan, taskId);
    if (task) {
      task.attempts++;
      if (task.attempts >= task.maxAttempts) {
        task.status = 'failed';
        task.error = error;
      }
      this.updatePlanStatus(plan);
    }
  }

  /**
   * Update plan status based on task statuses.
   */
  private updatePlanStatus(plan: Plan): void {
    const allTasks = this.getAllTasks(plan);

    const hasInProgress = allTasks.some((t) => t.status === 'in_progress');
    const allCompleted = allTasks.every((t) => t.status === 'completed');
    const hasFailed = allTasks.some((t) => t.status === 'failed');
    const allBlockedOrFailed = allTasks.every(
      (t) => t.status === 'failed' || t.status === 'blocked'
    );

    if (allCompleted) {
      plan.status = 'completed';
      plan.completedAt = Date.now();
    } else if (hasFailed && allBlockedOrFailed) {
      plan.status = 'failed';
    } else if (hasInProgress) {
      plan.status = 'executing';
    } else if (this.isStuck(plan)) {
      plan.status = 'stuck';
    }
  }

  /**
   * Check if a plan is stuck (no executable tasks, but not complete or failed).
   */
  private isStuck(plan: Plan): boolean {
    const next = this.getNextTask(plan);
    if (next) {
      return false;
    }

    const allTasks = this.getAllTasks(plan);
    const pending = allTasks.filter((t) => t.status === 'pending');
    const inProgress = allTasks.filter((t) => t.status === 'in_progress');

    // Stuck if there are pending tasks but none are executable
    return pending.length > 0 && inProgress.length === 0;
  }

  /**
   * Get all tasks from a plan (including subtasks).
   */
  private getAllTasks(plan: Plan): Task[] {
    const result: Task[] = [];
    for (const task of plan.tasks) {
      result.push(task);
      for (const subtask of task.subtasks) {
        result.push(subtask);
      }
    }
    return result;
  }

  /**
   * Add a subtask to an existing task.
   */
  addSubtask(plan: Plan, parentId: string, subtask: Task): void {
    const parent = this.findTask(plan, parentId);
    if (parent) {
      parent.subtasks.push(subtask);
    }
  }

  /**
   * Create a checkpoint for backtracking.
   */
  createCheckpoint(plan: Plan, goalState: GoalState, iteration: number): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `checkpoint_${Date.now()}`,
      timestamp: Date.now(),
      planState: JSON.parse(JSON.stringify(plan)),
      goalState: JSON.parse(JSON.stringify(goalState)),
      iteration,
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  /**
   * Restore from a checkpoint.
   */
  restoreFromCheckpoint(checkpointId: string): { plan: Plan; goalState: GoalState } | null {
    const checkpoint = this.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      return null;
    }
    return {
      plan: JSON.parse(JSON.stringify(checkpoint.planState)),
      goalState: JSON.parse(JSON.stringify(checkpoint.goalState)),
    };
  }

  /**
   * Get all checkpoints.
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get the most recent checkpoint.
   */
  getLastCheckpoint(): Checkpoint | null {
    if (this.checkpoints.length === 0) {
      return null;
    }
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /**
   * Clear all checkpoints.
   */
  clearCheckpoints(): void {
    this.checkpoints = [];
  }

  /**
   * Count completed tasks in a plan.
   */
  countCompleted(plan: Plan): number {
    return this.getAllTasks(plan).filter((t) => t.status === 'completed').length;
  }

  /**
   * Count total tasks in a plan.
   */
  countTotal(plan: Plan): number {
    return this.getAllTasks(plan).length;
  }

  /**
   * Get plan progress as a percentage.
   */
  getProgress(plan: Plan): number {
    const total = this.countTotal(plan);
    if (total === 0) {
      return 0;
    }
    return (this.countCompleted(plan) / total) * 100;
  }
}

/**
 * Create a goal state from a plan.
 */
export function createGoalState(plan: Plan): GoalState {
  const taskDescriptions = plan.tasks.map((t) => t.description);

  return {
    originalGoal: plan.goal,
    currentSubgoal: taskDescriptions.length > 0 ? taskDescriptions[0] : null,
    completedSubgoals: [],
    remainingSubgoals: taskDescriptions,
    driftDetected: false,
  };
}

/**
 * Update goal state when a subgoal is completed.
 */
export function markSubgoalComplete(
  state: GoalState,
  subgoal: string
): GoalState {
  return {
    ...state,
    completedSubgoals: [...state.completedSubgoals, subgoal],
    remainingSubgoals: state.remainingSubgoals.filter((s) => s !== subgoal),
    currentSubgoal:
      state.remainingSubgoals.filter((s) => s !== subgoal)[0] ?? null,
  };
}

/**
 * Detect goal drift by comparing current actions to original goal.
 */
export function detectGoalDrift(
  state: GoalState,
  recentActions: string[]
): GoalState {
  // Simple heuristic: if recent actions don't mention any goal keywords, flag drift
  const goalWords = state.originalGoal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const recentText = recentActions.join(' ').toLowerCase();

  const relevantActions = goalWords.some((word) => recentText.includes(word));

  if (!relevantActions && recentActions.length >= 3) {
    return {
      ...state,
      driftDetected: true,
      driftReason: `Recent actions do not relate to goal: "${state.originalGoal}"`,
    };
  }

  return state;
}
