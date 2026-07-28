// Self-reflection on action results.
//
// Analyzes observations to determine next steps, identify
// alternatives, and learn from failures.

import type { Action, Observation, Reflection } from './types.ts';

/**
 * Generates reflections on action results.
 */
export class Reflector {
  private reflectionHistory: Reflection[];
  private lessonsLearned: Map<string, string[]>;

  constructor() {
    this.reflectionHistory = [];
    this.lessonsLearned = new Map();
  }

  /**
   * Reflect on an observation and decide next steps.
   */
  reflect(
    action: Action,
    observation: Observation,
    availableActions: string[],
    goal: string
  ): Reflection {
    const reflection: Reflection = {
      observation,
      analysis: this.analyzeObservation(action, observation, goal),
      shouldRetry: this.shouldRetry(action, observation),
      lessonLearned: this.extractLesson(action, observation),
      timestamp: Date.now(),
    };

    // Suggest alternative if retry is not recommended
    if (!reflection.shouldRetry && !observation.success) {
      reflection.alternativeAction = this.suggestAlternative(
        action,
        observation,
        availableActions,
        goal
      );
    }

    this.reflectionHistory.push(reflection);
    this.recordLesson(action.name, reflection.lessonLearned);

    return reflection;
  }

  /**
   * Analyze the observation in context of the goal.
   */
  private analyzeObservation(
    action: Action,
    observation: Observation,
    goal: string
  ): string {
    if (observation.success) {
      const result = JSON.stringify(observation.result);
      const relevant = this.isResultRelevantToGoal(observation.result, goal);
      if (relevant) {
        return `Action ${action.name} succeeded with relevant result: ${result}. ` +
          `This contributes to the goal: "${goal}".`;
      } else {
        return `Action ${action.name} succeeded but result may not directly ` +
          `address the goal. Result: ${result}. Consider if a different approach ` +
          `would be more direct.`;
      }
    } else {
      const error = observation.error ?? 'Unknown error';
      return `Action ${action.name} failed with error: ${error}. ` +
        `Need to either retry with different parameters or try an alternative action.`;
    }
  }

  /**
   * Determine if the result is relevant to the goal.
   */
  private isResultRelevantToGoal(result: unknown, goal: string): boolean {
    if (result === null || result === undefined) {
      return false;
    }

    const resultStr = JSON.stringify(result).toLowerCase();
    const goalWords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

    // Check if any significant goal words appear in the result
    return goalWords.some((word) => resultStr.includes(word));
  }

  /**
   * Decide if the action should be retried.
   */
  private shouldRetry(action: Action, observation: Observation): boolean {
    if (observation.success) {
      return false; // No need to retry success
    }

    const error = observation.error ?? '';

    // Transient errors worth retrying
    if (
      error.includes('timeout') ||
      error.includes('temporarily') ||
      error.includes('retry')
    ) {
      return true;
    }

    // Permanent errors not worth retrying
    if (
      error.includes('not found') ||
      error.includes('invalid') ||
      error.includes('Unknown action')
    ) {
      return false;
    }

    // Check history - have we tried this exact action before?
    const sameActionFailures = this.reflectionHistory.filter(
      (r) =>
        r.observation.actionName === action.name &&
        !r.observation.success &&
        JSON.stringify(r.observation.result) === JSON.stringify(observation.result)
    );

    // Don't retry if we've already failed with the same action and result
    return sameActionFailures.length === 0;
  }

  /**
   * Extract a lesson from the action/observation pair.
   */
  private extractLesson(action: Action, observation: Observation): string {
    if (observation.success) {
      return `Action ${action.name} with parameters ` +
        `${JSON.stringify(action.parameters)} produces useful results.`;
    }

    const error = observation.error ?? 'Unknown error';

    if (error.includes('not found')) {
      return `The entity or resource requested by ${action.name} does not exist. ` +
        `Try a different entity or verify the spelling.`;
    }

    if (error.includes('invalid')) {
      return `The parameters to ${action.name} were invalid. ` +
        `Check parameter types and formats.`;
    }

    return `Action ${action.name} failed. The error "${error}" suggests ` +
      `this approach may not work for this type of query.`;
  }

  /**
   * Suggest an alternative action based on the failure.
   */
  private suggestAlternative(
    failedAction: Action,
    observation: Observation,
    availableActions: string[],
    goal: string
  ): Action | undefined {
    // Remove the failed action from candidates
    const alternatives = availableActions.filter((a) => a !== failedAction.name);

    if (alternatives.length === 0) {
      return undefined;
    }

    // Simple heuristic: suggest search if lookup failed, or vice versa
    const error = observation.error ?? '';

    if (failedAction.name === 'lookup' && alternatives.includes('search')) {
      return {
        type: 'alternative',
        name: 'search',
        parameters: {
          query: Object.values(failedAction.parameters).join(' '),
        },
        timestamp: Date.now(),
        iteration: failedAction.iteration,
      };
    }

    if (failedAction.name === 'search' && alternatives.includes('lookup')) {
      // Extract entity and attribute from search query
      const query = (failedAction.parameters.query as string) ?? '';
      const words = query.split(/\s+/);
      if (words.length >= 2) {
        return {
          type: 'alternative',
          name: 'lookup',
          parameters: {
            entity: words[0],
            attribute: words.slice(1).join(' '),
          },
          timestamp: Date.now(),
          iteration: failedAction.iteration,
        };
      }
    }

    // Default: return the first alternative with empty parameters
    return {
      type: 'alternative',
      name: alternatives[0],
      parameters: {},
      timestamp: Date.now(),
      iteration: failedAction.iteration,
    };
  }

  /**
   * Record a lesson for future reference.
   */
  private recordLesson(actionName: string, lesson: string): void {
    const existing = this.lessonsLearned.get(actionName) ?? [];
    existing.push(lesson);
    this.lessonsLearned.set(actionName, existing);
  }

  /**
   * Get all reflections.
   */
  getReflections(): Reflection[] {
    return [...this.reflectionHistory];
  }

  /**
   * Get lessons learned for an action.
   */
  getLessonsForAction(actionName: string): string[] {
    return this.lessonsLearned.get(actionName) ?? [];
  }

  /**
   * Get all lessons learned.
   */
  getAllLessons(): Map<string, string[]> {
    return new Map(this.lessonsLearned);
  }

  /**
   * Count total reflections.
   */
  getReflectionCount(): number {
    return this.reflectionHistory.length;
  }

  /**
   * Count reflections that suggested retry.
   */
  countRetryRecommendations(): number {
    return this.reflectionHistory.filter((r) => r.shouldRetry).length;
  }

  /**
   * Count reflections that suggested alternatives.
   */
  countAlternativesSuggested(): number {
    return this.reflectionHistory.filter((r) => r.alternativeAction !== undefined).length;
  }

  /**
   * Reset reflector state.
   */
  reset(): void {
    this.reflectionHistory = [];
    this.lessonsLearned.clear();
  }
}

/**
 * Analyze a sequence of reflections to detect patterns.
 */
export function analyzeReflectionPatterns(
  reflections: Reflection[]
): { repeatedFailures: string[]; successfulApproaches: string[] } {
  const failureCounts = new Map<string, number>();
  const successfulApproaches: string[] = [];

  for (const reflection of reflections) {
    const actionName = reflection.observation.actionName;

    if (!reflection.observation.success) {
      const count = failureCounts.get(actionName) ?? 0;
      failureCounts.set(actionName, count + 1);
    } else {
      successfulApproaches.push(
        `${actionName}: ${JSON.stringify(reflection.observation.result)}`
      );
    }
  }

  const repeatedFailures = Array.from(failureCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([name]) => name);

  return { repeatedFailures, successfulApproaches };
}
