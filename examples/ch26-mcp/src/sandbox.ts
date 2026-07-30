// Tool execution sandboxing for MCP.
// Isolates tool execution to prevent runaway processes and resource exhaustion.
// Defense in depth: even trusted tools run with constraints.

import type { SandboxContext, SandboxResult } from './types.ts';

/**
 * Default sandbox configuration.
 */
const DEFAULT_CONTEXT: SandboxContext = {
  maxExecutionMs: 5000,
  maxMemoryMb: 128,
  allowedOperations: ['compute', 'format', 'transform'],
  isolationLevel: 'strict',
};

/**
 * ToolSandbox executes tool handlers with resource limits.
 *
 * In production, this would use VM2, isolated-vm, or a container.
 * Here we simulate the interface with timeout enforcement.
 *
 * Usage:
 *   const sandbox = new ToolSandbox();
 *   const result = await sandbox.execute(handler, args, context);
 *   if (result.terminated) { log(result.terminationReason); }
 */
export class ToolSandbox {
  private defaultContext: SandboxContext;

  constructor(defaultContext?: Partial<SandboxContext>) {
    this.defaultContext = { ...DEFAULT_CONTEXT, ...defaultContext };
  }

  /**
   * Execute a tool handler within the sandbox.
   */
  async execute(
    handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
    args: Record<string, unknown>,
    context?: Partial<SandboxContext>
  ): Promise<SandboxResult> {
    const ctx = { ...this.defaultContext, ...context };
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      // Execute with timeout
      const output = await this.executeWithTimeout(
        handler,
        args,
        ctx.maxExecutionMs
      );

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      return {
        success: true,
        output,
        error: null,
        executionMs: endTime - startTime,
        memoryUsedMb: Math.max(0, (endMemory - startMemory) / (1024 * 1024)),
        terminated: false,
        terminationReason: null,
      };
    } catch (err) {
      const endTime = Date.now();
      const executionMs = endTime - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = errorMessage.includes('Execution timeout');

      return {
        success: false,
        output: null,
        error: errorMessage,
        executionMs,
        memoryUsedMb: 0,
        terminated: isTimeout,
        terminationReason: isTimeout ? 'Execution timeout exceeded' : null,
      };
    }
  }

  /**
   * Execute with timeout using AbortController.
   */
  private async executeWithTimeout(
    handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout: ${timeoutMs}ms exceeded`));
      }, timeoutMs);

      // Execute the handler
      Promise.resolve()
        .then(() => handler(args))
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Validate that operation is allowed in the sandbox context.
   */
  isOperationAllowed(operation: string, context?: SandboxContext): boolean {
    const ctx = context ?? this.defaultContext;
    return ctx.allowedOperations.includes(operation);
  }

  /**
   * Get the default context.
   */
  getDefaultContext(): SandboxContext {
    return { ...this.defaultContext };
  }
}

/**
 * Validate tool arguments before sandbox execution.
 * Prevents injection of dangerous values.
 */
export function validateSandboxInput(
  args: Record<string, unknown>
): { valid: boolean; reason: string | null } {
  // Check for function values (cannot be sandboxed safely)
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'function') {
      return {
        valid: false,
        reason: `Argument '${key}' contains a function which is not allowed`,
      };
    }

    // Check for prototype pollution attempts
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return {
        valid: false,
        reason: `Argument key '${key}' is not allowed (prototype pollution)`,
      };
    }

    // Check for very large strings (potential DoS)
    if (typeof value === 'string' && value.length > 1_000_000) {
      return {
        valid: false,
        reason: `Argument '${key}' exceeds maximum string length`,
      };
    }
  }

  return { valid: true, reason: null };
}

/**
 * Create a restricted context for untrusted tools.
 */
export function createRestrictedContext(): SandboxContext {
  return {
    maxExecutionMs: 1000,
    maxMemoryMb: 32,
    allowedOperations: ['compute'],
    isolationLevel: 'strict',
  };
}
