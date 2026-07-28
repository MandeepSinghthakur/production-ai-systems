// Supervisor agent and orchestration patterns.
// See Chapter 27, "Building Production AI Systems".

import type {
  AgentConfig,
  AgentMessage,
  AgentTask,
  InterruptCommand,
  OrchestratorMetrics,
  PipelineStage,
  SwarmResult,
} from './types.ts';
import { Agent } from './agent.ts';
import { WorkerAgent, SpecialistAgent } from './worker.ts';
import { HandoffManager } from './handoff.ts';
import { DeadlockDetector } from './deadlock.ts';
import {
  TraceCollector,
  createTrace,
  createChildSpan,
  completeSpan,
  generateId,
} from './tracing.ts';

/**
 * Supervisor agent that orchestrates other agents.
 */
export class SupervisorAgent extends Agent {
  private workers: Map<string, WorkerAgent | SpecialistAgent>;
  private handoffManager: HandoffManager;
  private deadlockDetector: DeadlockDetector;
  private metrics: OrchestratorMetrics;

  constructor(config: AgentConfig, traceCollector: TraceCollector) {
    super(config, traceCollector);
    this.workers = new Map();
    this.handoffManager = new HandoffManager(traceCollector);
    this.deadlockDetector = new DeadlockDetector(5000);
    this.metrics = this.initMetrics();
  }

  private initMetrics(): OrchestratorMetrics {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksInterrupted: 0,
      handoffsSuccessful: 0,
      handoffsFailed: 0,
      deadlocksDetected: 0,
      deadlocksResolved: 0,
      averageTaskDurationMs: 0,
    };
  }

  /**
   * Register a worker with this supervisor.
   */
  registerWorker(worker: WorkerAgent | SpecialistAgent): void {
    this.workers.set(worker.getId(), worker);
    this.handoffManager.registerAgent(worker);
  }

  /**
   * Get a registered worker by ID.
   */
  getWorker(workerId: string): WorkerAgent | SpecialistAgent | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all registered workers.
   */
  getWorkers(): Array<WorkerAgent | SpecialistAgent> {
    return Array.from(this.workers.values());
  }

  /**
   * Get the handoff manager.
   */
  getHandoffManager(): HandoffManager {
    return this.handoffManager;
  }

  /**
   * Get the deadlock detector.
   */
  getDeadlockDetector(): DeadlockDetector {
    return this.deadlockDetector;
  }

  /**
   * Get current metrics.
   */
  getMetrics(): OrchestratorMetrics {
    return { ...this.metrics };
  }

  /**
   * Find a worker with the required capability.
   */
  findWorkerWithCapability(
    capability: string
  ): WorkerAgent | SpecialistAgent | undefined {
    for (const worker of this.workers.values()) {
      if (worker.hasCapability(capability) && worker.canAcceptTask()) {
        return worker;
      }
    }
    return undefined;
  }

  /**
   * Dispatch a task to an appropriate worker.
   */
  async dispatchTask(
    taskType: string,
    payload: unknown,
    capability: string
  ): Promise<AgentTask> {
    const { context, span } = createTrace('dispatch', this.config.id);
    span.tags['task.type'] = taskType;
    span.tags['capability'] = capability;
    this.traceCollector.record(span);

    const worker = this.findWorkerWithCapability(capability);

    if (!worker) {
      const errorSpan = completeSpan(span, 'error');
      this.traceCollector.record(errorSpan);
      this.metrics.tasksFailed++;

      return {
        id: generateId(),
        traceId: context.traceId,
        spanId: context.spanId,
        type: taskType,
        payload,
        assignedTo: 'none',
        assignedAt: Date.now(),
        deadline: Date.now() + 30000,
        status: 'failed',
        error: `No worker with capability: ${capability}`,
      };
    }

    const task: AgentTask = {
      id: generateId(),
      traceId: context.traceId,
      spanId: context.spanId,
      type: taskType,
      payload,
      assignedTo: worker.getId(),
      assignedAt: Date.now(),
      deadline: Date.now() + 30000,
      status: 'pending',
    };

    const startTime = Date.now();
    const result = await worker.processTask(task, context);
    const duration = Date.now() - startTime;

    // Update metrics
    if (result.status === 'completed') {
      this.metrics.tasksCompleted++;
      this.updateAverageDuration(duration);
    } else if (result.status === 'failed') {
      this.metrics.tasksFailed++;
    } else if (result.status === 'interrupted') {
      this.metrics.tasksInterrupted++;
    }

    const completedSpan = completeSpan(
      span,
      result.status === 'completed' ? 'completed' : 'error'
    );
    this.traceCollector.record(completedSpan);

    return result;
  }

  private updateAverageDuration(newDuration: number): void {
    const total = this.metrics.tasksCompleted;
    const oldAvg = this.metrics.averageTaskDurationMs;
    this.metrics.averageTaskDurationMs =
      (oldAvg * (total - 1) + newDuration) / total;
  }

  /**
   * Interrupt a worker agent.
   */
  interrupt(workerId: string, taskId: string, reason: string): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return false;
    }

    const command: InterruptCommand = {
      targetAgent: workerId,
      taskId,
      reason,
      timestamp: Date.now(),
    };

    const message: AgentMessage = {
      id: generateId(),
      traceId: generateId(),
      parentSpanId: null,
      spanId: generateId(),
      fromAgent: this.config.id,
      toAgent: workerId,
      type: 'interrupt',
      payload: command,
      timestamp: Date.now(),
    };

    worker.receiveMessage(message);
    this.metrics.tasksInterrupted++;
    return true;
  }

  /**
   * Execute tasks in a pipeline pattern.
   * Each stage's output becomes the next stage's input.
   */
  async executePipeline(
    stages: PipelineStage[],
    initialInput: unknown
  ): Promise<{ success: boolean; output: unknown; stagesCompleted: number }> {
    const { context, span } = createTrace('pipeline', this.config.id);
    span.tags['pipeline.stages'] = String(stages.length);
    this.traceCollector.record(span);

    let currentInput = initialInput;
    let stagesCompleted = 0;

    for (const stage of stages) {
      const worker = this.workers.get(stage.agentId);
      if (!worker) {
        const errorSpan = completeSpan(span, 'error');
        this.traceCollector.record(errorSpan);
        return {
          success: false,
          output: null,
          stagesCompleted,
        };
      }

      const task: AgentTask = {
        id: generateId(),
        traceId: context.traceId,
        spanId: generateId(),
        type: 'pipeline-stage',
        payload: currentInput,
        assignedTo: stage.agentId,
        assignedAt: Date.now(),
        deadline: Date.now() + 30000,
        status: 'pending',
      };

      const result = await worker.processTask(task, context);

      if (result.status !== 'completed') {
        const errorSpan = completeSpan(span, 'error');
        this.traceCollector.record(errorSpan);
        return {
          success: false,
          output: result.error,
          stagesCompleted,
        };
      }

      currentInput = stage.transform(result.result);
      stagesCompleted++;
    }

    const completedSpan = completeSpan(span, 'completed');
    this.traceCollector.record(completedSpan);

    return {
      success: true,
      output: currentInput,
      stagesCompleted,
    };
  }

  /**
   * Execute tasks in parallel across multiple workers (swarm pattern).
   */
  async executeSwarm(
    workerIds: string[],
    taskType: string,
    payload: unknown,
    aggregator: (results: unknown[]) => unknown
  ): Promise<SwarmResult> {
    const { context, span } = createTrace('swarm', this.config.id);
    span.tags['swarm.workers'] = String(workerIds.length);
    this.traceCollector.record(span);

    const taskPromises = workerIds.map(async (workerId) => {
      const worker = this.workers.get(workerId);
      if (!worker) {
        return { agentId: workerId, result: null, error: 'Worker not found' };
      }

      const task: AgentTask = {
        id: generateId(),
        traceId: context.traceId,
        spanId: generateId(),
        type: taskType,
        payload,
        assignedTo: workerId,
        assignedAt: Date.now(),
        deadline: Date.now() + 30000,
        status: 'pending',
      };

      const result = await worker.processTask(task, context);
      return { agentId: workerId, result: result.result };
    });

    const results = await Promise.all(taskPromises);
    const successfulResults = results
      .filter((r) => r.result !== null)
      .map((r) => r.result);

    const aggregated = aggregator(successfulResults);

    const completedSpan = completeSpan(span, 'completed');
    this.traceCollector.record(completedSpan);

    return {
      results,
      aggregated,
      completedAt: Date.now(),
    };
  }

  /**
   * Reset supervisor and all workers.
   */
  reset(): void {
    super.reset();
    for (const worker of this.workers.values()) {
      worker.reset();
    }
    this.deadlockDetector.clear();
    this.metrics = this.initMetrics();
  }
}

/**
 * Create a supervisor agent.
 */
export function createSupervisor(
  id: string,
  traceCollector: TraceCollector
): SupervisorAgent {
  const config: AgentConfig = {
    id,
    role: 'supervisor',
    capabilities: ['orchestrate', 'dispatch', 'interrupt'],
    maxConcurrentTasks: 10,
    timeoutMs: 60000,
  };
  return new SupervisorAgent(config, traceCollector);
}
