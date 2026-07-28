// Action execution with observation generation.
//
// Executes actions and captures observations including success,
// failure, and error information.

import type { Action, Observation, AvailableAction } from './types.ts';

/**
 * Executes actions and produces observations.
 */
export class ActionExecutor {
  private actions: Map<string, AvailableAction>;
  private executionHistory: Array<{ action: Action; observation: Observation }>;

  constructor() {
    this.actions = new Map();
    this.executionHistory = [];
  }

  /**
   * Register an available action.
   */
  registerAction(action: AvailableAction): void {
    this.actions.set(action.name, action);
  }

  /**
   * Register multiple actions.
   */
  registerActions(actions: AvailableAction[]): void {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  /**
   * Execute an action and return an observation.
   */
  async execute(action: Action): Promise<Observation> {
    const availableAction = this.actions.get(action.name);

    if (!availableAction) {
      const observation: Observation = {
        actionName: action.name,
        success: false,
        result: null,
        error: `Unknown action: ${action.name}`,
        timestamp: Date.now(),
        iteration: action.iteration,
      };
      this.executionHistory.push({ action, observation });
      return observation;
    }

    try {
      const result = await availableAction.execute(action.parameters);
      const observation: Observation = {
        actionName: action.name,
        success: true,
        result,
        timestamp: Date.now(),
        iteration: action.iteration,
      };
      this.executionHistory.push({ action, observation });
      return observation;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const observation: Observation = {
        actionName: action.name,
        success: false,
        result: null,
        error: errorMessage,
        timestamp: Date.now(),
        iteration: action.iteration,
      };
      this.executionHistory.push({ action, observation });
      return observation;
    }
  }

  /**
   * Get all available action names.
   */
  getAvailableActions(): string[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Get action description.
   */
  getActionDescription(name: string): string | null {
    const action = this.actions.get(name);
    return action ? action.description : null;
  }

  /**
   * Check if an action is registered.
   */
  hasAction(name: string): boolean {
    return this.actions.has(name);
  }

  /**
   * Get execution history.
   */
  getHistory(): Array<{ action: Action; observation: Observation }> {
    return [...this.executionHistory];
  }

  /**
   * Get last observation.
   */
  getLastObservation(): Observation | null {
    if (this.executionHistory.length === 0) {
      return null;
    }
    return this.executionHistory[this.executionHistory.length - 1].observation;
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.executionHistory = [];
  }

  /**
   * Count successful executions.
   */
  countSuccesses(): number {
    return this.executionHistory.filter((h) => h.observation.success).length;
  }

  /**
   * Count failed executions.
   */
  countFailures(): number {
    return this.executionHistory.filter((h) => !h.observation.success).length;
  }
}

/**
 * Create standard actions for testing.
 */
export function createTestActions(): AvailableAction[] {
  return [
    {
      name: 'search',
      description: 'Search for information',
      parameters: [
        { name: 'query', type: 'string', required: true, description: 'Search query' },
      ],
      execute: async (params) => {
        const query = params.query as string;
        // Simulate search results
        if (query.toLowerCase().includes('capital')) {
          return { results: ['Paris is the capital of France'] };
        }
        if (query.toLowerCase().includes('population')) {
          return { results: ['France population: 67 million'] };
        }
        return { results: [] };
      },
    },
    {
      name: 'calculate',
      description: 'Perform a calculation',
      parameters: [
        { name: 'expression', type: 'string', required: true, description: 'Math expression' },
      ],
      execute: async (params) => {
        const expr = params.expression as string;
        // Simple evaluation for basic math
        const result = evaluateSimpleExpression(expr);
        return { result };
      },
    },
    {
      name: 'lookup',
      description: 'Look up a fact',
      parameters: [
        { name: 'entity', type: 'string', required: true, description: 'Entity to look up' },
        { name: 'attribute', type: 'string', required: true, description: 'Attribute to retrieve' },
      ],
      execute: async (params) => {
        const entity = (params.entity as string).toLowerCase();
        const attribute = (params.attribute as string).toLowerCase();

        const data: Record<string, Record<string, string>> = {
          france: { capital: 'Paris', population: '67 million', language: 'French' },
          germany: { capital: 'Berlin', population: '83 million', language: 'German' },
          japan: { capital: 'Tokyo', population: '125 million', language: 'Japanese' },
        };

        const entityData = data[entity];
        if (!entityData) {
          throw new Error(`Entity not found: ${entity}`);
        }
        const value = entityData[attribute];
        if (!value) {
          throw new Error(`Attribute not found: ${attribute} for ${entity}`);
        }
        return { value };
      },
    },
    {
      name: 'finish',
      description: 'Signal that the goal has been achieved',
      parameters: [
        { name: 'answer', type: 'string', required: true, description: 'Final answer' },
      ],
      execute: async (params) => {
        return { answer: params.answer, finished: true };
      },
    },
  ];
}

/**
 * Create an action that always fails (for testing error handling).
 */
export function createFailingAction(name: string, errorMessage: string): AvailableAction {
  return {
    name,
    description: `Action that fails with: ${errorMessage}`,
    parameters: [],
    execute: async () => {
      throw new Error(errorMessage);
    },
  };
}

/**
 * Create an action that succeeds after N failures (for testing retry).
 */
export function createEventuallySucceedingAction(
  name: string,
  failuresBeforeSuccess: number,
  successResult: unknown
): AvailableAction {
  let failures = 0;
  return {
    name,
    description: `Action that succeeds after ${failuresBeforeSuccess} failures`,
    parameters: [],
    execute: async () => {
      if (failures < failuresBeforeSuccess) {
        failures++;
        throw new Error(`Attempt ${failures} failed`);
      }
      return successResult;
    },
  };
}

/**
 * Simple expression evaluator for basic math.
 */
function evaluateSimpleExpression(expr: string): number {
  // Remove whitespace
  const cleaned = expr.replace(/\s/g, '');

  // Only allow numbers and basic operators
  if (!/^[\d+\-*/().]+$/.test(cleaned)) {
    throw new Error(`Invalid expression: ${expr}`);
  }

  // Use a simple recursive descent parser for safety
  return parseExpression(cleaned);
}

function parseExpression(expr: string): number {
  let pos = 0;

  function parseNumber(): number {
    let numStr = '';
    while (pos < expr.length && /[\d.]/.test(expr[pos])) {
      numStr += expr[pos];
      pos++;
    }
    if (numStr === '') {
      throw new Error('Expected number');
    }
    return parseFloat(numStr);
  }

  function parseFactor(): number {
    if (expr[pos] === '(') {
      pos++;
      const result = parseAddSub();
      if (expr[pos] !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      pos++;
      return result;
    }
    return parseNumber();
  }

  function parseMulDiv(): number {
    let result = parseFactor();
    while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
      const op = expr[pos];
      pos++;
      const right = parseFactor();
      if (op === '*') {
        result *= right;
      } else {
        result /= right;
      }
    }
    return result;
  }

  function parseAddSub(): number {
    let result = parseMulDiv();
    while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
      const op = expr[pos];
      pos++;
      const right = parseMulDiv();
      if (op === '+') {
        result += right;
      } else {
        result -= right;
      }
    }
    return result;
  }

  const result = parseAddSub();
  if (pos < expr.length) {
    throw new Error(`Unexpected character: ${expr[pos]}`);
  }
  return result;
}
