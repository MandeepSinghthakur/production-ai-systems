// Saga pattern implementation for distributed transactions.
// Coordinates multi-step operations with compensation for failures.

import type {
  Saga,
  SagaStep,
  SagaState,
  SagaStepState,
  SagaStepDefinition,
  SagaConfig,
  StepResult,
  CompensationResult,
  TransactionMetrics,
} from './types.ts';

/**
 * Result of saga execution.
 */
export interface SagaExecutionResult {
  sagaId: string;
  success: boolean;
  state: SagaState;
  steps: SagaStep[];
  error: string | null;
  compensated: boolean;
  durationMs: number;
}

/**
 * Saga definition with ordered steps.
 */
export interface SagaDefinition {
  type: string;
  steps: SagaStepDefinition[];
}

/**
 * Saga orchestrator.
 *
 * The saga pattern coordinates distributed transactions by:
 * 1. Executing steps in order, each with its own local transaction.
 * 2. If any step fails, executing compensation for all completed steps
 *    in reverse order.
 *
 * This achieves eventual consistency without distributed locks.
 * Each step must be idempotent and have a compensating action.
 */
export class SagaOrchestrator {
  private definitions: Map<string, SagaDefinition>;
  private sagas: Map<string, Saga>;
  private config: SagaConfig;
  private metrics: TransactionMetrics;

  constructor(config?: Partial<SagaConfig>) {
    this.definitions = new Map();
    this.sagas = new Map();
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
      timeoutMs: config?.timeoutMs ?? 60000,
    };
    this.metrics = this.createEmptyMetrics();
  }

  private createEmptyMetrics(): TransactionMetrics {
    return {
      outboxEntriesCreated: 0,
      outboxEntriesPublished: 0,
      outboxEntriesFailed: 0,
      sagasStarted: 0,
      sagasCompleted: 0,
      sagasFailed: 0,
      compensationsTriggered: 0,
      compensationsCompleted: 0,
      duplicatesDetected: 0,
      avgPublishLatencyMs: 0,
      avgSagaDurationMs: 0,
    };
  }

  /**
   * Register a saga definition.
   */
  registerSaga(definition: SagaDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  /**
   * Start a new saga instance.
   */
  async execute(
    type: string,
    context: Record<string, unknown>
  ): Promise<SagaExecutionResult> {
    const definition = this.definitions.get(type);
    if (!definition) {
      throw new Error(`Unknown saga type: ${type}`);
    }

    const startTime = Date.now();
    const sagaId = `saga_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const saga: Saga = {
      id: sagaId,
      type,
      state: 'running',
      steps: definition.steps.map((step) => ({
        name: step.name,
        state: 'pending',
        startedAt: null,
        completedAt: null,
        error: null,
        output: null,
      })),
      context: { ...context },
      createdAt: Date.now(),
      completedAt: null,
      compensationIndex: -1,
    };

    this.sagas.set(sagaId, saga);
    this.metrics.sagasStarted++;

    // Execute steps in order
    let lastCompletedIndex = -1;

    for (let i = 0; i < definition.steps.length; i++) {
      const stepDef = definition.steps[i];
      const step = saga.steps[i];

      step.state = 'running';
      step.startedAt = Date.now();

      try {
        const result = await this.executeStepWithRetry(stepDef, saga.context);

        if (result.success) {
          step.state = 'completed';
          step.completedAt = Date.now();
          step.output = result.output;
          lastCompletedIndex = i;

          // Update context with step output
          if (result.output !== undefined) {
            saga.context[`${step.name}_result`] = result.output;
          }
        } else {
          step.state = 'failed';
          step.completedAt = Date.now();
          step.error = result.error ?? 'Step failed';

          // Trigger compensation
          saga.state = 'compensating';
          this.metrics.compensationsTriggered++;

          await this.compensate(saga, definition, lastCompletedIndex);

          const durationMs = Date.now() - startTime;
          this.updateAvgDuration(durationMs);

          return {
            sagaId,
            success: false,
            state: saga.state,
            steps: saga.steps.map((s) => ({ ...s })),
            error: step.error,
            compensated: saga.state === 'compensated',
            durationMs,
          };
        }
      } catch (error) {
        step.state = 'failed';
        step.completedAt = Date.now();
        step.error = error instanceof Error ? error.message : String(error);

        saga.state = 'compensating';
        this.metrics.compensationsTriggered++;

        await this.compensate(saga, definition, lastCompletedIndex);

        const durationMs = Date.now() - startTime;
        this.updateAvgDuration(durationMs);

        return {
          sagaId,
          success: false,
          state: saga.state,
          steps: saga.steps.map((s) => ({ ...s })),
          error: step.error,
          compensated: saga.state === 'compensated',
          durationMs,
        };
      }
    }

    // All steps completed
    saga.state = 'completed';
    saga.completedAt = Date.now();
    this.metrics.sagasCompleted++;

    const durationMs = Date.now() - startTime;
    this.updateAvgDuration(durationMs);

    return {
      sagaId,
      success: true,
      state: saga.state,
      steps: saga.steps.map((s) => ({ ...s })),
      error: null,
      compensated: false,
      durationMs,
    };
  }

  /**
   * Execute a step with retry logic.
   */
  private async executeStepWithRetry(
    stepDef: SagaStepDefinition,
    context: Record<string, unknown>
  ): Promise<StepResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const result = await stepDef.execute(context);
        if (result.success) {
          return result;
        }
        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      // Only delay if we will retry
      if (attempt < this.config.maxRetries - 1) {
        await this.delay(this.config.retryDelayMs);
      }
    }

    return {
      success: false,
      error: lastError ?? 'Max retries exceeded',
    };
  }

  /**
   * Execute compensation for completed steps in reverse order.
   */
  private async compensate(
    saga: Saga,
    definition: SagaDefinition,
    lastCompletedIndex: number
  ): Promise<void> {
    saga.compensationIndex = lastCompletedIndex;

    // Compensate in reverse order
    for (let i = lastCompletedIndex; i >= 0; i--) {
      const stepDef = definition.steps[i];
      const step = saga.steps[i];

      if (step.state !== 'completed') {
        continue;
      }

      step.state = 'compensating';

      try {
        const result = await stepDef.compensate(saga.context);

        if (result.success) {
          step.state = 'compensated';
        } else {
          // Compensation failed - this is a serious problem
          // In production, this would trigger alerts and manual intervention
          step.error = `Compensation failed: ${result.error}`;
          saga.state = 'failed';
          this.metrics.sagasFailed++;
          return;
        }
      } catch (error) {
        step.error = `Compensation error: ${
          error instanceof Error ? error.message : String(error)
        }`;
        saga.state = 'failed';
        this.metrics.sagasFailed++;
        return;
      }
    }

    saga.state = 'compensated';
    saga.completedAt = Date.now();
    this.metrics.compensationsCompleted++;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private updateAvgDuration(durationMs: number): void {
    const alpha = 0.1;
    this.metrics.avgSagaDurationMs =
      alpha * durationMs + (1 - alpha) * this.metrics.avgSagaDurationMs;
  }

  /**
   * Get a saga by ID.
   */
  getSaga(sagaId: string): Saga | null {
    const saga = this.sagas.get(sagaId);
    return saga ? { ...saga, steps: saga.steps.map((s) => ({ ...s })) } : null;
  }

  /**
   * Get all sagas.
   */
  getAllSagas(): Saga[] {
    return Array.from(this.sagas.values()).map((saga) => ({
      ...saga,
      steps: saga.steps.map((s) => ({ ...s })),
    }));
  }

  /**
   * Get sagas by state.
   */
  getSagasByState(state: SagaState): Saga[] {
    return this.getAllSagas().filter((saga) => saga.state === state);
  }

  /**
   * Get metrics.
   */
  getMetrics(): TransactionMetrics {
    return { ...this.metrics };
  }
}

/**
 * Common saga step implementations for LLM workflows.
 */
export class LLMSagaSteps {
  /**
   * Create a step that reserves capacity.
   */
  static reserveCapacity(
    checkCapacity: (tenant: string, tokens: number) => boolean,
    reserveCapacity: (tenant: string, tokens: number) => string,
    releaseCapacity: (reservationId: string) => void
  ): SagaStepDefinition {
    return {
      name: 'reserve_capacity',
      execute: async (context) => {
        const tenant = context.tenant as string;
        const tokens = context.estimatedTokens as number;

        const hasCapacity = checkCapacity(tenant, tokens);
        if (!hasCapacity) {
          return { success: false, error: 'Insufficient capacity' };
        }

        const reservationId = reserveCapacity(tenant, tokens);
        return { success: true, output: { reservationId } };
      },
      compensate: async (context) => {
        const result = context.reserve_capacity_result as
          | { reservationId: string }
          | undefined;
        if (result?.reservationId) {
          releaseCapacity(result.reservationId);
        }
        return { success: true };
      },
    };
  }

  /**
   * Create a step that calls an LLM.
   */
  static callLLM(
    callModel: (
      prompt: string,
      tier: string
    ) => Promise<{ output: string; tokens: number }>
  ): SagaStepDefinition {
    return {
      name: 'call_llm',
      execute: async (context) => {
        const prompt = context.prompt as string;
        const tier = context.tier as string;

        try {
          const result = await callModel(prompt, tier);
          return { success: true, output: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      compensate: async () => {
        // LLM calls cannot be compensated - they are already executed
        // This is acceptable because the cost is sunk
        // The reservation release handles the business impact
        return { success: true };
      },
    };
  }

  /**
   * Create a step that persists results.
   */
  static persistResult(
    save: (id: string, data: unknown) => void,
    remove: (id: string) => void
  ): SagaStepDefinition {
    return {
      name: 'persist_result',
      execute: async (context) => {
        const requestId = context.requestId as string;
        const llmResult = context.call_llm_result as unknown;

        try {
          save(requestId, llmResult);
          return { success: true, output: { persisted: true } };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      compensate: async (context) => {
        const requestId = context.requestId as string;
        try {
          remove(requestId);
          return { success: true };
        } catch {
          // Best effort - log but don't fail
          return { success: true };
        }
      },
    };
  }

  /**
   * Create a step that charges for usage.
   */
  static chargeUsage(
    charge: (tenant: string, amount: number) => string,
    refund: (chargeId: string) => void
  ): SagaStepDefinition {
    return {
      name: 'charge_usage',
      execute: async (context) => {
        const tenant = context.tenant as string;
        const llmResult = context.call_llm_result as
          | { tokens: number }
          | undefined;
        const tokens = llmResult?.tokens ?? 0;

        // Calculate cost (simplified)
        const amount = tokens * 0.001;

        try {
          const chargeId = charge(tenant, amount);
          return { success: true, output: { chargeId, amount } };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      compensate: async (context) => {
        const result = context.charge_usage_result as
          | { chargeId: string }
          | undefined;
        if (result?.chargeId) {
          refund(result.chargeId);
        }
        return { success: true };
      },
    };
  }
}
