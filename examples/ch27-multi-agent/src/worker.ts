// Worker agent implementation.
// See Chapter 27, "Building Production AI Systems".

import type { AgentConfig, AgentTask } from './types.ts';
import type { TraceContext } from './tracing.ts';
import { Agent } from './agent.ts';
import { TraceCollector } from './tracing.ts';

/**
 * Worker agent that performs specific tasks.
 */
export class WorkerAgent extends Agent {
  private processingTimeMs: number;
  private errorRate: number;

  constructor(
    config: AgentConfig,
    traceCollector: TraceCollector,
    options?: { processingTimeMs?: number; errorRate?: number }
  ) {
    super(config, traceCollector);
    this.processingTimeMs = options?.processingTimeMs ?? 10;
    this.errorRate = options?.errorRate ?? 0;
  }

  /**
   * Execute a task with simulated work.
   */
  protected async executeTask(
    task: AgentTask,
    context: TraceContext
  ): Promise<unknown> {
    // Simulate processing time
    await this.simulateWork();

    // Check if we should simulate an error
    if (Math.random() < this.errorRate) {
      throw new Error('Simulated worker error');
    }

    // Check for interrupt during work
    if (this.interrupted) {
      throw new Error('Task interrupted');
    }

    // Process based on task type
    const payload = task.payload as Record<string, unknown>;

    switch (task.type) {
      case 'extract':
        return this.extract(payload);
      case 'transform':
        return this.transform(payload);
      case 'analyze':
        return this.analyze(payload);
      default:
        return { processed: payload, by: this.config.id };
    }
  }

  /**
   * Simulate processing time.
   */
  private async simulateWork(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, this.processingTimeMs);
    });
  }

  /**
   * Extract data from payload.
   */
  private extract(payload: Record<string, unknown>): unknown {
    return {
      type: 'extraction',
      result: {
        extracted: payload.data ?? 'no data',
        worker: this.config.id,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Transform data.
   */
  private transform(payload: Record<string, unknown>): unknown {
    const input = payload.input ?? payload;
    return {
      type: 'transformation',
      result: {
        transformed: `transformed:${JSON.stringify(input)}`,
        worker: this.config.id,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Analyze data.
   */
  private analyze(payload: Record<string, unknown>): unknown {
    return {
      type: 'analysis',
      result: {
        analyzed: true,
        summary: `Analysis of ${JSON.stringify(payload).length} bytes`,
        worker: this.config.id,
        timestamp: Date.now(),
      },
    };
  }
}

/**
 * Specialist agent with specific domain expertise.
 */
export class SpecialistAgent extends WorkerAgent {
  private domain: string;

  constructor(
    config: AgentConfig,
    traceCollector: TraceCollector,
    domain: string,
    options?: { processingTimeMs?: number; errorRate?: number }
  ) {
    super(config, traceCollector, options);
    this.domain = domain;
  }

  /**
   * Get the specialist's domain.
   */
  getDomain(): string {
    return this.domain;
  }

  /**
   * Execute a domain-specific task.
   */
  protected async executeTask(
    task: AgentTask,
    context: TraceContext
  ): Promise<unknown> {
    const baseResult = await super.executeTask(task, context);
    return {
      ...baseResult as object,
      domain: this.domain,
      specialist: true,
    };
  }
}

/**
 * Create a worker agent with the given configuration.
 */
export function createWorker(
  id: string,
  capabilities: string[],
  traceCollector: TraceCollector,
  options?: { processingTimeMs?: number; errorRate?: number }
): WorkerAgent {
  const config: AgentConfig = {
    id,
    role: 'worker',
    capabilities,
    maxConcurrentTasks: 3,
    timeoutMs: 30000,
  };
  return new WorkerAgent(config, traceCollector, options);
}

/**
 * Create a specialist agent with the given configuration.
 */
export function createSpecialist(
  id: string,
  domain: string,
  capabilities: string[],
  traceCollector: TraceCollector,
  options?: { processingTimeMs?: number; errorRate?: number }
): SpecialistAgent {
  const config: AgentConfig = {
    id,
    role: 'specialist',
    capabilities,
    maxConcurrentTasks: 2,
    timeoutMs: 60000,
  };
  return new SpecialistAgent(config, traceCollector, domain, options);
}
