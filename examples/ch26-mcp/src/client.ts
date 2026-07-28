// MCP client for testing server functionality.
// Simulates client-side protocol operations.

import type {
  ClientCapabilities,
  MCPCapability,
  NegotiatedCapabilities,
  ToolDefinition,
  ResourceDefinition,
  ToolCallResult,
  ResourceContent,
} from './types.ts';
import { MCPServer } from './server.ts';

/**
 * MCPClient simulates client-side MCP operations.
 *
 * Usage:
 *   const client = new MCPClient('my-client', server);
 *   await client.connect(['tools', 'resources']);
 *   const result = await client.callTool('get_weather', { location: 'NYC' });
 */
export class MCPClient {
  private clientId: string;
  private clientVersion: string;
  private server: MCPServer;
  private sessionId: string | null;
  private negotiatedCapabilities: MCPCapability[];

  constructor(
    clientId: string,
    server: MCPServer,
    clientVersion: string = '1.0.0'
  ) {
    this.clientId = clientId;
    this.clientVersion = clientVersion;
    this.server = server;
    this.sessionId = null;
    this.negotiatedCapabilities = [];
  }

  /**
   * Connect to the server and negotiate capabilities.
   */
  connect(
    requestedCapabilities: MCPCapability[],
    requestedScopes: ('read' | 'write' | 'execute' | 'admin')[] = ['read']
  ): NegotiatedCapabilities {
    const clientCaps: ClientCapabilities = {
      requestedCapabilities,
      clientId: this.clientId,
      clientVersion: this.clientVersion,
    };

    const result = this.server.negotiate(clientCaps, requestedScopes);
    this.sessionId = result.sessionId;
    this.negotiatedCapabilities = result.agreed;

    return result;
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): boolean {
    if (!this.sessionId) {
      return false;
    }

    const result = this.server.revokeSession(this.sessionId);
    this.sessionId = null;
    this.negotiatedCapabilities = [];
    return result;
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    if (!this.sessionId) {
      return false;
    }

    const session = this.server.getSession(this.sessionId);
    return session !== null;
  }

  /**
   * Get session ID.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get negotiated capabilities.
   */
  getCapabilities(): MCPCapability[] {
    return [...this.negotiatedCapabilities];
  }

  /**
   * Check if a capability is available.
   */
  hasCapability(cap: MCPCapability): boolean {
    return this.negotiatedCapabilities.includes(cap);
  }

  /**
   * List available tools.
   */
  listTools(): ToolDefinition[] {
    if (!this.hasCapability('tools')) {
      throw new Error('Tools capability not negotiated');
    }

    return this.server.listTools();
  }

  /**
   * List available resources.
   */
  listResources(): ResourceDefinition[] {
    if (!this.hasCapability('resources')) {
      throw new Error('Resources capability not negotiated');
    }

    if (!this.sessionId) {
      throw new Error('Not connected');
    }

    return this.server.listAccessibleResources(this.sessionId);
  }

  /**
   * Call a tool.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    if (!this.hasCapability('tools')) {
      return {
        callId: `call-${Date.now()}`,
        toolName,
        success: false,
        result: null,
        error: 'Tools capability not negotiated',
        executionMs: 0,
        sandboxed: false,
      };
    }

    if (!this.sessionId) {
      return {
        callId: `call-${Date.now()}`,
        toolName,
        success: false,
        result: null,
        error: 'Not connected',
        executionMs: 0,
        sandboxed: false,
      };
    }

    return this.server.callTool({
      toolName,
      arguments: args,
      callId: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.sessionId,
      clientId: this.clientId,
    });
  }

  /**
   * Get a resource.
   */
  getResource(uri: string): { content: ResourceContent | null; error: string | null } {
    if (!this.hasCapability('resources')) {
      return {
        content: null,
        error: 'Resources capability not negotiated',
      };
    }

    if (!this.sessionId) {
      return {
        content: null,
        error: 'Not connected',
      };
    }

    return this.server.getResource({
      uri,
      sessionId: this.sessionId,
      clientId: this.clientId,
    });
  }
}

/**
 * Create a test client with standard configuration.
 */
export function createTestClient(
  server: MCPServer,
  clientId: string = 'test-client'
): MCPClient {
  return new MCPClient(clientId, server);
}
