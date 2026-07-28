// Core types for Model Context Protocol (MCP) implementation.
// See Chapter 26, "Building Production AI Systems".

/**
 * MCP capability that can be negotiated between client and server.
 */
export type MCPCapability =
  | 'tools'
  | 'resources'
  | 'prompts'
  | 'sampling'
  | 'logging';

/**
 * Permission scope for tool access.
 */
export type PermissionScope =
  | 'read'
  | 'write'
  | 'execute'
  | 'admin';

/**
 * Resource types the server can expose.
 */
export type ResourceType = 'text' | 'binary' | 'structured';

/**
 * MCP server capabilities declaration.
 */
export interface ServerCapabilities {
  supportedCapabilities: MCPCapability[];
  maxConcurrentTools: number;
  toolTimeoutMs: number;
  supportedResourceTypes: ResourceType[];
}

/**
 * MCP client capabilities declaration.
 */
export interface ClientCapabilities {
  requestedCapabilities: MCPCapability[];
  clientId: string;
  clientVersion: string;
}

/**
 * Result of capability negotiation.
 */
export interface NegotiatedCapabilities {
  agreed: MCPCapability[];
  rejected: MCPCapability[];
  serverVersion: string;
  clientId: string;
  sessionId: string;
}

/**
 * Tool definition exposed by the server.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  requiredScope: PermissionScope;
  timeoutMs: number;
  sandboxed: boolean;
}

/**
 * JSON Schema for tool input validation.
 */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
  required: string[];
}

/**
 * Property definition in a tool schema.
 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

/**
 * Request to execute a tool.
 */
export interface ToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
  sessionId: string;
  clientId: string;
}

/**
 * Result of tool execution.
 */
export interface ToolCallResult {
  callId: string;
  toolName: string;
  success: boolean;
  result: unknown;
  error: string | null;
  executionMs: number;
  sandboxed: boolean;
}

/**
 * Resource definition exposed by the server.
 */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  type: ResourceType;
  mimeType: string;
  requiredScope: PermissionScope;
}

/**
 * Resource content returned by the server.
 */
export interface ResourceContent {
  uri: string;
  type: ResourceType;
  mimeType: string;
  content: string | Buffer | Record<string, unknown>;
  size: number;
}

/**
 * Request to access a resource.
 */
export interface ResourceRequest {
  uri: string;
  sessionId: string;
  clientId: string;
}

/**
 * Session with granted permissions.
 */
export interface MCPSession {
  sessionId: string;
  clientId: string;
  grantedScopes: PermissionScope[];
  negotiatedCapabilities: MCPCapability[];
  createdAt: number;
  expiresAt: number;
}

/**
 * Permission check result.
 */
export interface PermissionCheck {
  allowed: boolean;
  requiredScope: PermissionScope;
  grantedScopes: PermissionScope[];
  reason: string | null;
}

/**
 * Sandbox execution context.
 */
export interface SandboxContext {
  maxExecutionMs: number;
  maxMemoryMb: number;
  allowedOperations: string[];
  isolationLevel: 'strict' | 'relaxed';
}

/**
 * Sandbox execution result.
 */
export interface SandboxResult {
  success: boolean;
  output: unknown;
  error: string | null;
  executionMs: number;
  memoryUsedMb: number;
  terminated: boolean;
  terminationReason: string | null;
}

/**
 * Injection scan result for tool responses.
 */
export interface InjectionScanResult {
  safe: boolean;
  threats: InjectionThreat[];
  sanitizedContent: string | null;
}

/**
 * Detected injection threat.
 */
export interface InjectionThreat {
  type: 'prompt_injection' | 'delimiter_attack' | 'instruction_override';
  confidence: number;
  location: string;
  fragment: string;
}

/**
 * MCP server configuration.
 */
export interface MCPServerConfig {
  serverId: string;
  serverVersion: string;
  capabilities: ServerCapabilities;
  defaultTimeoutMs: number;
  maxSessionDurationMs: number;
  enableSandbox: boolean;
  scanToolResponses: boolean;
}

/**
 * Default server configuration.
 */
export const DEFAULT_SERVER_CONFIG: MCPServerConfig = {
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
