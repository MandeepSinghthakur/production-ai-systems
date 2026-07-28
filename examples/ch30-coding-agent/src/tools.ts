// Tool definitions and permission enforcement for coding agents.
// Tools are the interface between the agent and the environment.

import type {
  AgentTool,
  ToolParameter,
  ToolPermission,
  ToolResult,
} from './types.ts';

/**
 * ToolRegistry manages available tools and their permissions.
 */
export class ToolRegistry {
  private tools: Map<string, AgentTool>;
  private allowedPermissions: Set<ToolPermission>;

  constructor() {
    this.tools = new Map();
    this.allowedPermissions = new Set(['read']); // Default: read-only
  }

  /**
   * Register a tool.
   */
  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): AgentTool | null {
    return this.tools.get(name) ?? null;
  }

  /**
   * List all available tools.
   */
  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools the agent can currently use.
   */
  listAvailable(): AgentTool[] {
    return this.list().filter((t) =>
      this.allowedPermissions.has(t.permission)
    );
  }

  /**
   * Set allowed permission levels.
   */
  setPermissions(permissions: ToolPermission[]): void {
    this.allowedPermissions = new Set(permissions);
  }

  /**
   * Check if a tool is allowed.
   */
  isAllowed(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    return this.allowedPermissions.has(tool.permission);
  }

  /**
   * Execute a tool with permission checks.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Unknown tool: ${toolName}`,
        blocked: true,
        blockReason: 'tool_not_found',
      };
    }

    if (!this.allowedPermissions.has(tool.permission)) {
      return {
        success: false,
        output: null,
        error: `Permission denied: ${tool.permission} not allowed`,
        blocked: true,
        blockReason: 'permission_denied',
      };
    }

    // Validate arguments
    const validation = this.validateArgs(tool.parameters, args);
    if (!validation.valid) {
      return {
        success: false,
        output: null,
        error: `Invalid arguments: ${validation.errors.join(', ')}`,
        blocked: false,
      };
    }

    // Execute the tool
    try {
      return await tool.execute(args);
    } catch (error) {
      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        blocked: false,
      };
    }
  }

  /**
   * Validate tool arguments.
   */
  private validateArgs(
    parameters: ToolParameter[],
    args: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of parameters) {
      const value = args[param.name];

      if (param.required && value === undefined) {
        errors.push(`Missing required parameter: ${param.name}`);
        continue;
      }

      if (value !== undefined) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== param.type) {
          errors.push(
            `Parameter ${param.name}: expected ${param.type}, got ${actualType}`
          );
        }

        if (param.pattern && typeof value === 'string') {
          const regex = new RegExp(param.pattern);
          if (!regex.test(value)) {
            errors.push(
              `Parameter ${param.name}: does not match pattern ${param.pattern}`
            );
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create standard coding agent tools.
 */
export function createStandardTools(): AgentTool[] {
  const tools: AgentTool[] = [];

  // File read tool
  tools.push({
    name: 'read_file',
    description: 'Read the contents of a file',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Path to the file to read',
      },
    ],
    execute: async (args) => {
      const path = args.path as string;
      // Simulate file read
      return {
        success: true,
        output: `Contents of ${path}`,
      };
    },
  });

  // File write tool
  tools.push({
    name: 'write_file',
    description: 'Write contents to a file',
    permission: 'write',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Path to the file to write',
      },
      {
        name: 'content',
        type: 'string',
        required: true,
        description: 'Content to write',
      },
    ],
    execute: async (args) => {
      const path = args.path as string;
      // Simulate file write
      return {
        success: true,
        output: `Wrote to ${path}`,
      };
    },
  });

  // Directory list tool
  tools.push({
    name: 'list_directory',
    description: 'List files in a directory',
    permission: 'read',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Directory path to list',
      },
    ],
    execute: async (args) => {
      const path = args.path as string;
      // Simulate directory listing
      return {
        success: true,
        output: ['file1.ts', 'file2.ts', 'package.json'],
      };
    },
  });

  // Search tool
  tools.push({
    name: 'search_codebase',
    description: 'Search for text in the codebase',
    permission: 'read',
    parameters: [
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'Search query',
      },
      {
        name: 'file_pattern',
        type: 'string',
        required: false,
        description: 'File pattern to search (e.g., *.ts)',
      },
    ],
    execute: async (args) => {
      const query = args.query as string;
      // Simulate search
      return {
        success: true,
        output: [
          { path: 'src/main.ts', line: 42, match: `Found: ${query}` },
        ],
      };
    },
  });

  // Run command tool
  tools.push({
    name: 'run_command',
    description: 'Run a terminal command',
    permission: 'execute',
    parameters: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: 'Command to run',
      },
      {
        name: 'cwd',
        type: 'string',
        required: false,
        description: 'Working directory',
      },
    ],
    execute: async (args) => {
      const command = args.command as string;

      // Check for blocked commands
      const blocked = [
        'rm -rf',
        'rm -r',
        'DROP TABLE',
        'DELETE FROM',
        'format',
        'mkfs',
      ];
      for (const b of blocked) {
        if (command.toLowerCase().includes(b.toLowerCase())) {
          return {
            success: false,
            output: null,
            error: `Blocked command: ${b}`,
            blocked: true,
            blockReason: 'destructive_command',
          };
        }
      }

      // Simulate command execution
      return {
        success: true,
        output: `Executed: ${command}`,
      };
    },
  });

  // Edit file tool
  tools.push({
    name: 'edit_file',
    description: 'Edit a specific part of a file',
    permission: 'write',
    parameters: [
      {
        name: 'path',
        type: 'string',
        required: true,
        description: 'Path to the file',
      },
      {
        name: 'old_text',
        type: 'string',
        required: true,
        description: 'Text to find and replace',
      },
      {
        name: 'new_text',
        type: 'string',
        required: true,
        description: 'Replacement text',
      },
    ],
    execute: async (args) => {
      const path = args.path as string;
      // Simulate edit
      return {
        success: true,
        output: `Edited ${path}`,
      };
    },
  });

  return tools;
}

/**
 * Create a permission-restricted tool registry.
 */
export function createRestrictedRegistry(
  permissions: ToolPermission[]
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.setPermissions(permissions);

  const tools = createStandardTools();
  for (const tool of tools) {
    registry.register(tool);
  }

  return registry;
}

/**
 * Validate a tool call request.
 */
export function validateToolCall(
  registry: ToolRegistry,
  toolName: string,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  const tool = registry.get(toolName);

  if (!tool) {
    return { valid: false, error: `Unknown tool: ${toolName}` };
  }

  if (!registry.isAllowed(toolName)) {
    return { valid: false, error: `Tool not allowed: ${toolName}` };
  }

  // Check required parameters
  for (const param of tool.parameters) {
    if (param.required && args[param.name] === undefined) {
      return {
        valid: false,
        error: `Missing required parameter: ${param.name}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Format tool definitions for the model prompt.
 */
export function formatToolsForPrompt(tools: AgentTool[]): string {
  const lines: string[] = ['Available tools:'];

  for (const tool of tools) {
    lines.push(`\n## ${tool.name}`);
    lines.push(tool.description);
    lines.push('Parameters:');

    for (const param of tool.parameters) {
      const required = param.required ? '(required)' : '(optional)';
      lines.push(`  - ${param.name}: ${param.type} ${required}`);
      lines.push(`    ${param.description}`);
    }
  }

  return lines.join('\n');
}
