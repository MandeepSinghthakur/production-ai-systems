// Tool definitions and handlers for MCP server.
// Each tool has a schema, required permissions, and handler function.
// Tools are validated before execution and responses are scanned.

import type {
  ToolDefinition,
  ToolCallRequest,
  ToolCallResult,
  ToolSchema,
  InjectionScanResult,
  InjectionThreat,
} from './types.ts';

/**
 * Tool handler function type.
 */
export type ToolHandler = (
  args: Record<string, unknown>
) => unknown | Promise<unknown>;

/**
 * Registered tool with definition and handler.
 */
interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * ToolRegistry manages tool definitions and execution.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.register(definition, handler);
 *   const result = await registry.execute(request);
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool>;
  private scanResponses: boolean;

  constructor(scanResponses: boolean = true) {
    this.tools = new Map();
    this.scanResponses = scanResponses;
  }

  /**
   * Register a tool with its handler.
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Get tool definition by name.
   */
  getDefinition(name: string): ToolDefinition | null {
    const tool = this.tools.get(name);
    return tool ? tool.definition : null;
  }

  /**
   * List all registered tools.
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Validate tool arguments against schema.
   */
  validateArguments(
    toolName: string,
    args: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool '${toolName}' not found`] };
    }

    const errors: string[] = [];
    const schema = tool.definition.inputSchema;

    // Check required properties
    for (const required of schema.required) {
      if (!(required in args)) {
        errors.push(`Missing required argument: ${required}`);
      }
    }

    // Validate property types
    for (const [key, value] of Object.entries(args)) {
      const propSchema = schema.properties[key];
      if (!propSchema) {
        errors.push(`Unknown argument: ${key}`);
        continue;
      }

      const typeValid = this.validateType(value, propSchema.type);
      if (!typeValid) {
        errors.push(
          `Argument '${key}' has wrong type: expected ${propSchema.type}`
        );
      }

      // Check string constraints
      if (propSchema.type === 'string' && typeof value === 'string') {
        if (propSchema.minLength && value.length < propSchema.minLength) {
          errors.push(
            `Argument '${key}' is too short: min ${propSchema.minLength}`
          );
        }
        if (propSchema.maxLength && value.length > propSchema.maxLength) {
          errors.push(
            `Argument '${key}' is too long: max ${propSchema.maxLength}`
          );
        }
        if (propSchema.pattern && !new RegExp(propSchema.pattern).test(value)) {
          errors.push(
            `Argument '${key}' does not match pattern: ${propSchema.pattern}`
          );
        }
        if (propSchema.enum && !propSchema.enum.includes(value)) {
          errors.push(
            `Argument '${key}' must be one of: ${propSchema.enum.join(', ')}`
          );
        }
      }

      // Check number constraints
      if (propSchema.type === 'number' && typeof value === 'number') {
        if (propSchema.minimum !== undefined && value < propSchema.minimum) {
          errors.push(
            `Argument '${key}' is below minimum: ${propSchema.minimum}`
          );
        }
        if (propSchema.maximum !== undefined && value > propSchema.maximum) {
          errors.push(
            `Argument '${key}' is above maximum: ${propSchema.maximum}`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a value against a type.
   */
  private validateType(
    value: unknown,
    type: string
  ): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Execute a tool call.
   */
  async execute(
    request: ToolCallRequest,
    sandboxExecutor?: (
      handler: ToolHandler,
      args: Record<string, unknown>
    ) => Promise<{ success: boolean; output: unknown; error: string | null; executionMs: number }>
  ): Promise<ToolCallResult> {
    const startTime = Date.now();
    const tool = this.tools.get(request.toolName);

    if (!tool) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: `Tool '${request.toolName}' not found`,
        executionMs: Date.now() - startTime,
        sandboxed: false,
      };
    }

    // Validate arguments
    const validation = this.validateArguments(
      request.toolName,
      request.arguments
    );
    if (!validation.valid) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: `Validation failed: ${validation.errors.join('; ')}`,
        executionMs: Date.now() - startTime,
        sandboxed: false,
      };
    }

    try {
      let result: unknown;
      let executionMs: number;
      let sandboxed = false;

      if (sandboxExecutor && tool.definition.sandboxed) {
        // Execute in sandbox
        const sandboxResult = await sandboxExecutor(
          tool.handler,
          request.arguments
        );
        if (!sandboxResult.success) {
          return {
            callId: request.callId,
            toolName: request.toolName,
            success: false,
            result: null,
            error: sandboxResult.error,
            executionMs: sandboxResult.executionMs,
            sandboxed: true,
          };
        }
        result = sandboxResult.output;
        executionMs = sandboxResult.executionMs;
        sandboxed = true;
      } else {
        // Direct execution
        result = await tool.handler(request.arguments);
        executionMs = Date.now() - startTime;
      }

      // Scan response for injection if enabled
      if (this.scanResponses && typeof result === 'string') {
        const scan = scanForInjection(result);
        if (!scan.safe) {
          return {
            callId: request.callId,
            toolName: request.toolName,
            success: false,
            result: null,
            error: `Tool response contains potential injection: ${scan.threats.map((t) => t.type).join(', ')}`,
            executionMs,
            sandboxed,
          };
        }
      }

      return {
        callId: request.callId,
        toolName: request.toolName,
        success: true,
        result,
        error: null,
        executionMs,
        sandboxed,
      };
    } catch (err) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: err instanceof Error ? err.message : String(err),
        executionMs: Date.now() - startTime,
        sandboxed: tool.definition.sandboxed,
      };
    }
  }
}

/**
 * Injection patterns to detect in tool responses.
 * These catch attempts to inject instructions via tool output.
 */
const INJECTION_PATTERNS = [
  {
    type: 'prompt_injection' as const,
    pattern: /ignore\s+(all\s+)?(previous|prior)?\s*instructions?/i,
    confidence: 0.95,
  },
  {
    type: 'prompt_injection' as const,
    pattern: /you\s+are\s+now\s+a/i,
    confidence: 0.90,
  },
  {
    type: 'prompt_injection' as const,
    pattern: /disregard\s+(all\s+)?(prior|previous)?\s*(context|instructions?)/i,
    confidence: 0.95,
  },
  {
    type: 'delimiter_attack' as const,
    pattern: /<\/?system>|<\/?user>|<\/?assistant>/i,
    confidence: 0.90,
  },
  {
    type: 'delimiter_attack' as const,
    pattern: /\[\/?(system|user|assistant|INST)\]/i,
    confidence: 0.90,
  },
  {
    type: 'instruction_override' as const,
    pattern: /new\s+instructions?:/i,
    confidence: 0.85,
  },
  {
    type: 'instruction_override' as const,
    pattern: /forget\s+(everything|all|what)\s+(you\s+)?(know|were told)/i,
    confidence: 0.90,
  },
];

/**
 * Scan tool output for potential injection attacks.
 */
export function scanForInjection(content: string): InjectionScanResult {
  const threats: InjectionThreat[] = [];

  for (const { type, pattern, confidence } of INJECTION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      threats.push({
        type,
        confidence,
        location: `index ${match.index}`,
        fragment: extractFragment(content, match.index ?? 0, match[0].length),
      });
    }
  }

  return {
    safe: threats.length === 0,
    threats,
    sanitizedContent: threats.length > 0 ? null : content,
  };
}

/**
 * Extract a fragment around a match for logging.
 */
function extractFragment(
  content: string,
  index: number,
  matchLength: number
): string {
  const contextChars = 20;
  const start = Math.max(0, index - contextChars);
  const end = Math.min(content.length, index + matchLength + contextChars);

  let fragment = content.slice(start, end);
  if (start > 0) fragment = '...' + fragment;
  if (end < content.length) fragment = fragment + '...';

  return fragment;
}

/**
 * Create standard tool definitions for testing.
 */
export function createStandardTools(): ToolDefinition[] {
  return [
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      inputSchema: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
            minLength: 1,
            maxLength: 100,
          },
          units: {
            type: 'string',
            description: 'Temperature units',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
      requiredScope: 'read',
      timeoutMs: 5000,
      sandboxed: false,
    },
    {
      name: 'create_file',
      description: 'Create a new file with content',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9/_.-]+$',
          },
          content: {
            type: 'string',
            description: 'File content',
            maxLength: 10000,
          },
        },
        required: ['path', 'content'],
      },
      requiredScope: 'write',
      timeoutMs: 10000,
      sandboxed: true,
    },
    {
      name: 'run_calculation',
      description: 'Run a calculation expression',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Math expression to evaluate',
            minLength: 1,
            maxLength: 500,
          },
        },
        required: ['expression'],
      },
      requiredScope: 'execute',
      timeoutMs: 1000,
      sandboxed: true,
    },
    {
      name: 'admin_config',
      description: 'Update server configuration',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Configuration key',
          },
          value: {
            type: 'string',
            description: 'Configuration value',
          },
        },
        required: ['key', 'value'],
      },
      requiredScope: 'admin',
      timeoutMs: 5000,
      sandboxed: false,
    },
  ];
}

/**
 * Create standard tool handlers for testing.
 */
export function createStandardHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  handlers.set('get_weather', (args) => {
    const location = args.location as string;
    const units = (args.units as string) ?? 'celsius';
    // Simulated weather data
    const temp = units === 'celsius' ? 22 : 72;
    return {
      location,
      temperature: temp,
      units,
      conditions: 'partly cloudy',
      humidity: 65,
    };
  });

  handlers.set('create_file', (args) => {
    const path = args.path as string;
    const content = args.content as string;
    // Simulated file creation
    return {
      path,
      size: content.length,
      created: true,
      timestamp: Date.now(),
    };
  });

  handlers.set('run_calculation', (args) => {
    const expression = args.expression as string;
    // Safe evaluation: only allow basic math
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    if (sanitized !== expression) {
      throw new Error('Expression contains invalid characters');
    }
    // Still dangerous in real code - use a proper parser
    const result = Function(`"use strict"; return (${sanitized})`)();
    return { expression, result };
  });

  handlers.set('admin_config', (args) => {
    const key = args.key as string;
    const value = args.value as string;
    // Simulated config update
    return {
      key,
      value,
      updated: true,
      previousValue: 'default',
    };
  });

  return handlers;
}
