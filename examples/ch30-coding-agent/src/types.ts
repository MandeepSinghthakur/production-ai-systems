// Core types for coding agent design.
// See Chapter 30, "Building Production AI Systems".

/**
 * A tool available to the coding agent.
 */
export interface AgentTool {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: ToolParameter[];
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Tool permission levels.
 */
export type ToolPermission = 'read' | 'write' | 'execute' | 'system';

/**
 * Tool parameter definition.
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required: boolean;
  description: string;
  pattern?: string;
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Code generation request.
 */
export interface CodeGenRequest {
  prompt: string;
  language: 'typescript' | 'javascript' | 'python';
  context: CodeContext;
  constraints?: CodeConstraints;
}

/**
 * Code context from the codebase.
 */
export interface CodeContext {
  relevantFiles: ContextFile[];
  totalTokens: number;
  budgetTokens: number;
  truncated: boolean;
}

/**
 * A file included in the context.
 */
export interface ContextFile {
  path: string;
  content: string;
  relevanceScore: number;
  tokenCount: number;
  included: boolean;
}

/**
 * Constraints on generated code.
 */
export interface CodeConstraints {
  maxLines?: number;
  allowedImports?: string[];
  blockedPatterns?: string[];
}

/**
 * Code generation result.
 */
export interface CodeGenResult {
  code: string;
  language: string;
  valid: boolean;
  validationErrors: ValidationError[];
  safetyViolations: SafetyViolation[];
}

/**
 * Syntax validation error.
 */
export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Safety check violation.
 */
export interface SafetyViolation {
  type: SafetyViolationType;
  pattern: string;
  location: string;
  severity: 'block' | 'warn';
}

export type SafetyViolationType =
  | 'destructive_command'
  | 'file_escape'
  | 'network_access'
  | 'credential_exposure'
  | 'infinite_loop'
  | 'resource_exhaustion';

/**
 * Sandbox execution configuration.
 */
export interface SandboxConfig {
  timeoutMs: number;
  maxOutputBytes: number;
  allowedPaths: string[];
  blockedCommands: string[];
  resourceLimits: ResourceLimits;
}

/**
 * Resource limits for sandbox execution.
 */
export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuSeconds: number;
  maxFileOperations: number;
  maxProcesses: number;
}

/**
 * Sandbox execution result.
 */
export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  memoryUsedMb: number;
  cpuTimeMs: number;
  fileOperations: number;
  pathViolation?: string;
}

/**
 * Agent action from the ReAct loop.
 */
export interface AgentAction {
  id: string;
  type: 'tool_call' | 'code_gen' | 'code_exec' | 'file_op';
  name: string;
  parameters: Record<string, unknown>;
  timestamp: number;
}

/**
 * Agent observation (result of an action).
 */
export interface AgentObservation {
  actionId: string;
  success: boolean;
  result: unknown;
  error?: string;
  blocked?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Agent session state.
 */
export interface AgentSession {
  id: string;
  workspaceRoot: string;
  allowedPaths: string[];
  tokenBudget: number;
  tokensUsed: number;
  actions: AgentAction[];
  observations: AgentObservation[];
  startedAt: number;
  lastActivityAt: number;
}

/**
 * Default sandbox configuration.
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeoutMs: 30000,
  maxOutputBytes: 1024 * 1024, // 1 MB
  allowedPaths: [],
  blockedCommands: [
    'rm -rf',
    'rm -r',
    'rmdir',
    'del /s',
    'format',
    'mkfs',
    'dd if=',
    'DROP TABLE',
    'DROP DATABASE',
    'DELETE FROM',
    'TRUNCATE',
    'shutdown',
    'reboot',
    'kill -9',
    'killall',
    'pkill',
    'curl',
    'wget',
    'nc ',
    'netcat',
  ],
  resourceLimits: {
    maxMemoryMb: 512,
    maxCpuSeconds: 30,
    maxFileOperations: 100,
    maxProcesses: 5,
  },
};

/**
 * Destructive patterns that should always be blocked.
 */
export const DESTRUCTIVE_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  description: string;
}> = [
  {
    pattern: /rm\s+(-[rfRF]+\s+)?[\/~]/,
    name: 'recursive_delete',
    description: 'Recursive file deletion',
  },
  {
    pattern: /DROP\s+(TABLE|DATABASE|SCHEMA)/i,
    name: 'sql_drop',
    description: 'SQL DROP statement',
  },
  {
    pattern: /DELETE\s+FROM\s+\w+\s*(;|$)/i,
    name: 'sql_delete_all',
    description: 'SQL DELETE without WHERE',
  },
  {
    pattern: /TRUNCATE\s+TABLE/i,
    name: 'sql_truncate',
    description: 'SQL TRUNCATE statement',
  },
  {
    pattern: />\s*\/dev\/sd[a-z]/,
    name: 'disk_overwrite',
    description: 'Direct disk write',
  },
  {
    pattern: /mkfs\./,
    name: 'filesystem_format',
    description: 'Filesystem format command',
  },
  {
    pattern: /chmod\s+777/,
    name: 'unsafe_permissions',
    description: 'World-writable permissions',
  },
  {
    pattern: /eval\s*\(/,
    name: 'code_eval',
    description: 'Dynamic code evaluation',
  },
  {
    pattern: /exec\s*\(/,
    name: 'code_exec',
    description: 'Process execution function',
  },
  {
    pattern: /child_process/,
    name: 'child_process',
    description: 'Child process spawning',
  },
];

/**
 * Path escape patterns.
 */
export const PATH_ESCAPE_PATTERNS: RegExp[] = [
  /\.\.\//,                    // Parent directory traversal
  /^\/etc\//,                  // System config
  /^\/var\/log\//,             // System logs
  /^\/root\//,                 // Root home
  /^\/home\/[^\/]+\//,         // Other user homes
  /^~\//,                      // Home directory expansion
  /\$HOME/,                    // Home variable
  /\$\{HOME\}/,                // Home variable (braces)
];
