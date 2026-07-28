// MCP server implementation.
// Handles capability negotiation, tool execution, and resource access.
// This is the central component that ties together permissions, tools,
// resources, and sandboxing.

import type {
  MCPServerConfig,
  ClientCapabilities,
  NegotiatedCapabilities,
  MCPCapability,
  MCPSession,
  ToolCallRequest,
  ToolCallResult,
  ResourceRequest,
  ResourceContent,
  ToolDefinition,
  ResourceDefinition,
  PermissionScope,
  DEFAULT_SERVER_CONFIG,
} from './types.ts';
import { PermissionManager } from './permissions.ts';
import { ToolRegistry } from './tools.ts';
import type { ToolHandler } from './tools.ts';
import { ResourceProvider } from './resources.ts';
import { ToolSandbox, validateSandboxInput } from './sandbox.ts';

/**
 * MCPServer is the main entry point for MCP protocol handling.
 *
 * Usage:
 *   const server = new MCPServer(config);
 *   server.registerTool(definition, handler);
 *   server.registerResource(definition, provider);
 *
 *   const session = server.negotiate(clientCaps);
 *   const result = await server.callTool(request);
 */
export class MCPServer {
  private config: MCPServerConfig;
  private permissions: PermissionManager;
  private tools: ToolRegistry;
  private resources: ResourceProvider;
  private sandbox: ToolSandbox;

  constructor(config?: Partial<MCPServerConfig>) {
    // Build config with defaults
    const defaultConfig: MCPServerConfig = {
      serverId: 'mcp-server-1',
      serverVersion: '1.0.0',
      capabilities: {
        supportedCapabilities: ['tools', 'resources', 'prompts'],
        maxConcurrentTools: 10,
        toolTimeoutMs: 30000,
        supportedResourceTypes: ['text', 'binary', 'structured'],
      },
      defaultTimeoutMs: 30000,
      maxSessionDurationMs: 3600000,
      enableSandbox: true,
      scanToolResponses: true,
    };

    this.config = { ...defaultConfig, ...config };
    this.permissions = new PermissionManager(this.config.maxSessionDurationMs);
    this.tools = new ToolRegistry(this.config.scanToolResponses);
    this.resources = new ResourceProvider();
    this.sandbox = new ToolSandbox({
      maxExecutionMs: this.config.defaultTimeoutMs,
    });
  }

  /**
   * Negotiate capabilities with a client.
   * Returns agreed capabilities and creates a session.
   */
  negotiate(
    clientCaps: ClientCapabilities,
    grantedScopes: PermissionScope[] = ['read']
  ): NegotiatedCapabilities {
    const serverCaps = this.config.capabilities.supportedCapabilities;
    const clientRequested = clientCaps.requestedCapabilities;

    // Find intersection of capabilities
    const agreed: MCPCapability[] = [];
    const rejected: MCPCapability[] = [];

    for (const cap of clientRequested) {
      if (serverCaps.includes(cap)) {
        agreed.push(cap);
      } else {
        rejected.push(cap);
      }
    }

    // Create session with granted scopes
    const session = this.permissions.createSession(
      clientCaps.clientId,
      grantedScopes,
      agreed
    );

    return {
      agreed,
      rejected,
      serverVersion: this.config.serverVersion,
      clientId: clientCaps.clientId,
      sessionId: session.sessionId,
    };
  }

  /**
   * Register a tool with its handler.
   */
  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.register(definition, handler);
  }

  /**
   * Register a resource with its content provider.
   */
  registerResource(
    definition: ResourceDefinition,
    contentProvider: () => ResourceContent
  ): void {
    this.resources.register(definition, contentProvider);
  }

  /**
   * List available tools.
   */
  listTools(): ToolDefinition[] {
    return this.tools.listTools();
  }

  /**
   * List available resources.
   */
  listResources(): ResourceDefinition[] {
    return this.resources.listResources();
  }

  /**
   * List resources accessible to a session.
   */
  listAccessibleResources(sessionId: string): ResourceDefinition[] {
    const session = this.permissions.getSession(sessionId);
    if (!session) {
      return [];
    }

    return this.resources.listAccessible(session.grantedScopes);
  }

  /**
   * Call a tool.
   */
  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    // Check session
    const session = this.permissions.getSession(request.sessionId);
    if (!session) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: 'Session not found or expired',
        executionMs: 0,
        sandboxed: false,
      };
    }

    // Get tool definition
    const tool = this.tools.getDefinition(request.toolName);
    if (!tool) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: `Tool '${request.toolName}' not found`,
        executionMs: 0,
        sandboxed: false,
      };
    }

    // Check permission
    const permCheck = this.permissions.checkToolPermission(session, tool);
    if (!permCheck.allowed) {
      return {
        callId: request.callId,
        toolName: request.toolName,
        success: false,
        result: null,
        error: permCheck.reason ?? 'Permission denied',
        executionMs: 0,
        sandboxed: false,
      };
    }

    // Validate sandbox input
    if (this.config.enableSandbox && tool.sandboxed) {
      const inputValidation = validateSandboxInput(request.arguments);
      if (!inputValidation.valid) {
        return {
          callId: request.callId,
          toolName: request.toolName,
          success: false,
          result: null,
          error: inputValidation.reason ?? 'Invalid sandbox input',
          executionMs: 0,
          sandboxed: true,
        };
      }
    }

    // Execute tool
    const sandboxExecutor = this.config.enableSandbox
      ? async (handler: ToolHandler, args: Record<string, unknown>) => {
          const result = await this.sandbox.execute(handler, args, {
            maxExecutionMs: tool.timeoutMs,
          });
          return {
            success: result.success,
            output: result.output,
            error: result.error,
            executionMs: result.executionMs,
          };
        }
      : undefined;

    return this.tools.execute(request, sandboxExecutor);
  }

  /**
   * Get a resource.
   */
  getResource(request: ResourceRequest): {
    content: ResourceContent | null;
    error: string | null;
  } {
    // Check session
    const session = this.permissions.getSession(request.sessionId);
    if (!session) {
      return {
        content: null,
        error: 'Session not found or expired',
      };
    }

    // Get resource definition
    const resource = this.resources.getDefinition(request.uri);
    if (!resource) {
      return {
        content: null,
        error: `Resource '${request.uri}' not found`,
      };
    }

    // Check permission
    const permCheck = this.permissions.checkResourcePermission(session, resource);
    if (!permCheck.allowed) {
      return {
        content: null,
        error: permCheck.reason ?? 'Permission denied',
      };
    }

    // Get content
    const content = this.resources.get(request.uri);
    if (!content) {
      return {
        content: null,
        error: `Resource '${request.uri}' content not available`,
      };
    }

    return { content, error: null };
  }

  /**
   * Get session by ID.
   */
  getSession(sessionId: string): MCPSession | null {
    return this.permissions.getSession(sessionId);
  }

  /**
   * Revoke a session.
   */
  revokeSession(sessionId: string): boolean {
    return this.permissions.revokeSession(sessionId);
  }

  /**
   * Get server configuration.
   */
  getConfig(): MCPServerConfig {
    return { ...this.config };
  }

  /**
   * Get server statistics.
   */
  getStats(): {
    toolCount: number;
    resourceCount: number;
    activeSessions: number;
  } {
    return {
      toolCount: this.tools.listTools().length,
      resourceCount: this.resources.count(),
      activeSessions: this.permissions.getActiveSessions().length,
    };
  }
}
