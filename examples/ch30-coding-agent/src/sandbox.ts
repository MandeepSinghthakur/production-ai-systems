// Sandboxed execution for coding agents.
// Prevents code from escaping the workspace or exhausting resources.

import type {
  SandboxConfig,
  SandboxResult,
  ResourceLimits,
} from './types.ts';
import { DEFAULT_SANDBOX_CONFIG } from './types.ts';

/**
 * Sandbox executes code with resource limits and path restrictions.
 *
 * In production, this would use:
 * - Container isolation (Docker, Firecracker)
 * - Process sandboxing (seccomp, AppArmor)
 * - Resource cgroups
 *
 * Here we simulate the interface and demonstrate the checks.
 */
export class Sandbox {
  private config: SandboxConfig;
  private fileOpCount: number;
  private startTime: number;
  private memoryBaseline: number;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    this.fileOpCount = 0;
    this.startTime = 0;
    this.memoryBaseline = 0;
  }

  /**
   * Execute code in the sandbox.
   */
  async execute(
    code: string,
    language: string
  ): Promise<SandboxResult> {
    this.startTime = Date.now();
    this.memoryBaseline = process.memoryUsage().heapUsed;
    this.fileOpCount = 0;

    // Pre-execution safety checks
    const pathViolation = this.checkPathViolations(code);
    if (pathViolation) {
      return {
        success: false,
        stdout: '',
        stderr: `Path violation: ${pathViolation}`,
        exitCode: 1,
        timedOut: false,
        memoryUsedMb: 0,
        cpuTimeMs: 0,
        fileOperations: 0,
        pathViolation,
      };
    }

    const commandViolation = this.checkBlockedCommands(code);
    if (commandViolation) {
      return {
        success: false,
        stdout: '',
        stderr: `Blocked command: ${commandViolation}`,
        exitCode: 1,
        timedOut: false,
        memoryUsedMb: 0,
        cpuTimeMs: 0,
        fileOperations: 0,
      };
    }

    // Simulate execution
    try {
      const result = await this.simulateExecution(code, language);
      return result;
    } catch (error) {
      const elapsed = Date.now() - this.startTime;
      const memoryUsed = process.memoryUsage().heapUsed - this.memoryBaseline;

      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        timedOut: elapsed >= this.config.timeoutMs,
        memoryUsedMb: memoryUsed / (1024 * 1024),
        cpuTimeMs: elapsed,
        fileOperations: this.fileOpCount,
      };
    }
  }

  /**
   * Check for path violations in code.
   */
  checkPathViolations(code: string): string | null {
    // Check for parent directory traversal
    if (code.includes('../')) {
      return 'Parent directory traversal detected';
    }

    // Check for absolute paths outside workspace
    const absolutePathPattern = /['"`]\/(?!workspace\/)[a-zA-Z]/;
    if (absolutePathPattern.test(code)) {
      return 'Absolute path outside workspace';
    }

    // Check for home directory access
    if (code.includes('$HOME') || code.includes('${HOME}') || code.match(/~\//)) {
      return 'Home directory access detected';
    }

    // Check for system directories
    const systemDirs = ['/etc/', '/var/', '/usr/', '/root/', '/home/'];
    for (const dir of systemDirs) {
      if (code.includes(dir)) {
        return `System directory access: ${dir}`;
      }
    }

    return null;
  }

  /**
   * Check for blocked commands in code.
   */
  checkBlockedCommands(code: string): string | null {
    for (const command of this.config.blockedCommands) {
      if (code.toLowerCase().includes(command.toLowerCase())) {
        return command;
      }
    }
    return null;
  }

  /**
   * Validate a file path is within allowed paths.
   */
  isPathAllowed(filePath: string): boolean {
    // Normalize the path
    const normalized = filePath.replace(/\\/g, '/');

    // Check for traversal attempts
    if (normalized.includes('../') || normalized.includes('/..')) {
      return false;
    }

    // Must be within allowed paths
    for (const allowed of this.config.allowedPaths) {
      if (normalized.startsWith(allowed) || normalized === allowed) {
        return true;
      }
    }

    // If no allowed paths configured, allow relative paths only
    if (this.config.allowedPaths.length === 0) {
      return !normalized.startsWith('/');
    }

    return false;
  }

  /**
   * Record a file operation and check limits.
   */
  recordFileOperation(): boolean {
    this.fileOpCount++;
    return this.fileOpCount <= this.config.resourceLimits.maxFileOperations;
  }

  /**
   * Check if execution has timed out.
   */
  hasTimedOut(): boolean {
    return Date.now() - this.startTime >= this.config.timeoutMs;
  }

  /**
   * Get current resource usage.
   */
  getResourceUsage(): {
    elapsedMs: number;
    memoryMb: number;
    fileOps: number;
  } {
    const memoryUsed = process.memoryUsage().heapUsed - this.memoryBaseline;
    return {
      elapsedMs: Date.now() - this.startTime,
      memoryMb: memoryUsed / (1024 * 1024),
      fileOps: this.fileOpCount,
    };
  }

  /**
   * Update sandbox configuration.
   */
  configure(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  /**
   * Simulate code execution.
   * In production, this would spawn an isolated process.
   */
  private async simulateExecution(
    code: string,
    language: string
  ): Promise<SandboxResult> {
    // Simulate execution time
    await this.delay(5);

    const elapsed = Date.now() - this.startTime;
    const memoryUsed = process.memoryUsage().heapUsed - this.memoryBaseline;

    // Check for infinite loop patterns and simulate timeout
    if (code.includes('while (true)') && !code.includes('break')) {
      return {
        success: false,
        stdout: '',
        stderr: 'Execution timed out',
        exitCode: 124,
        timedOut: true,
        memoryUsedMb: memoryUsed / (1024 * 1024),
        cpuTimeMs: this.config.timeoutMs,
        fileOperations: this.fileOpCount,
      };
    }

    // Simulate memory exhaustion
    if (code.includes('new Array(1000000)') || code.includes('push(new Array')) {
      return {
        success: false,
        stdout: '',
        stderr: 'Out of memory',
        exitCode: 137,
        timedOut: false,
        memoryUsedMb: this.config.resourceLimits.maxMemoryMb,
        cpuTimeMs: elapsed,
        fileOperations: this.fileOpCount,
      };
    }

    // Successful execution
    return {
      success: true,
      stdout: this.generateSimulatedOutput(code, language),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      memoryUsedMb: memoryUsed / (1024 * 1024),
      cpuTimeMs: elapsed,
      fileOperations: this.fileOpCount,
    };
  }

  /**
   * Generate simulated output for test code.
   */
  private generateSimulatedOutput(code: string, language: string): string {
    // Match common patterns and return appropriate output
    if (code.includes('console.log') || code.includes('print(')) {
      return 'Output from code execution\n';
    }
    if (code.includes('return')) {
      return 'Function executed successfully\n';
    }
    return '';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a sandbox with workspace restrictions.
 */
export function createWorkspaceSandbox(
  workspaceRoot: string,
  options?: Partial<SandboxConfig>
): Sandbox {
  const config: Partial<SandboxConfig> = {
    ...options,
    allowedPaths: [workspaceRoot, ...(options?.allowedPaths ?? [])],
  };
  return new Sandbox(config);
}

/**
 * Create a restricted sandbox for untrusted code.
 */
export function createRestrictedSandbox(): Sandbox {
  return new Sandbox({
    timeoutMs: 5000,
    maxOutputBytes: 100 * 1024, // 100 KB
    allowedPaths: [],
    blockedCommands: [
      ...DEFAULT_SANDBOX_CONFIG.blockedCommands,
      'import',
      'require',
      '__import__',
    ],
    resourceLimits: {
      maxMemoryMb: 128,
      maxCpuSeconds: 5,
      maxFileOperations: 10,
      maxProcesses: 1,
    },
  });
}

/**
 * Validate sandbox result indicates safe execution.
 */
export function isSandboxResultSafe(result: SandboxResult): boolean {
  return (
    result.success &&
    !result.timedOut &&
    !result.pathViolation &&
    result.exitCode === 0
  );
}
