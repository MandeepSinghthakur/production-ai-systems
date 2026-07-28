// Resource providers for MCP server.
// Exposes text, binary, and structured data to clients.
// Resources are access-controlled via permission scopes.

import type {
  ResourceDefinition,
  ResourceContent,
  ResourceRequest,
  ResourceType,
  PermissionScope,
} from './types.ts';

/**
 * ResourceProvider manages resource registration and access.
 *
 * Usage:
 *   const provider = new ResourceProvider();
 *   provider.register(definition, content);
 *   const content = await provider.get(request);
 */
export class ResourceProvider {
  private resources: Map<string, { definition: ResourceDefinition; content: () => ResourceContent }>;

  constructor() {
    this.resources = new Map();
  }

  /**
   * Register a resource with its content provider.
   */
  register(
    definition: ResourceDefinition,
    contentProvider: () => ResourceContent
  ): void {
    this.resources.set(definition.uri, { definition, content: contentProvider });
  }

  /**
   * Register a static text resource.
   */
  registerText(
    uri: string,
    name: string,
    description: string,
    text: string,
    requiredScope: PermissionScope = 'read'
  ): void {
    const definition: ResourceDefinition = {
      uri,
      name,
      description,
      type: 'text',
      mimeType: 'text/plain',
      requiredScope,
    };

    this.register(definition, () => ({
      uri,
      type: 'text',
      mimeType: 'text/plain',
      content: text,
      size: text.length,
    }));
  }

  /**
   * Register a static binary resource.
   */
  registerBinary(
    uri: string,
    name: string,
    description: string,
    data: Buffer,
    mimeType: string,
    requiredScope: PermissionScope = 'read'
  ): void {
    const definition: ResourceDefinition = {
      uri,
      name,
      description,
      type: 'binary',
      mimeType,
      requiredScope,
    };

    this.register(definition, () => ({
      uri,
      type: 'binary',
      mimeType,
      content: data,
      size: data.length,
    }));
  }

  /**
   * Register a static structured resource.
   */
  registerStructured(
    uri: string,
    name: string,
    description: string,
    data: Record<string, unknown>,
    requiredScope: PermissionScope = 'read'
  ): void {
    const definition: ResourceDefinition = {
      uri,
      name,
      description,
      type: 'structured',
      mimeType: 'application/json',
      requiredScope,
    };

    this.register(definition, () => ({
      uri,
      type: 'structured',
      mimeType: 'application/json',
      content: data,
      size: JSON.stringify(data).length,
    }));
  }

  /**
   * Get resource definition by URI.
   */
  getDefinition(uri: string): ResourceDefinition | null {
    const resource = this.resources.get(uri);
    return resource ? resource.definition : null;
  }

  /**
   * List all registered resources.
   */
  listResources(): ResourceDefinition[] {
    return Array.from(this.resources.values()).map((r) => r.definition);
  }

  /**
   * List resources by type.
   */
  listByType(type: ResourceType): ResourceDefinition[] {
    return this.listResources().filter((r) => r.type === type);
  }

  /**
   * List resources accessible with given scopes.
   */
  listAccessible(grantedScopes: PermissionScope[]): ResourceDefinition[] {
    return this.listResources().filter((r) => {
      return this.scopeAllows(grantedScopes, r.requiredScope);
    });
  }

  /**
   * Get resource content.
   */
  get(uri: string): ResourceContent | null {
    const resource = this.resources.get(uri);
    if (!resource) {
      return null;
    }

    return resource.content();
  }

  /**
   * Check if scope list allows access to required scope.
   */
  private scopeAllows(
    granted: PermissionScope[],
    required: PermissionScope
  ): boolean {
    const hierarchy: Record<PermissionScope, number> = {
      read: 1,
      write: 2,
      execute: 3,
      admin: 4,
    };

    const requiredLevel = hierarchy[required];

    for (const scope of granted) {
      if (hierarchy[scope] >= requiredLevel) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove a resource by URI.
   */
  remove(uri: string): boolean {
    return this.resources.delete(uri);
  }

  /**
   * Get count of registered resources.
   */
  count(): number {
    return this.resources.size;
  }
}

/**
 * Create standard resources for testing.
 */
export function createStandardResources(): ResourceProvider {
  const provider = new ResourceProvider();

  // Text resources
  provider.registerText(
    'docs://readme',
    'README',
    'Project documentation',
    '# MCP Server\n\nThis is the documentation for the MCP server.',
    'read'
  );

  provider.registerText(
    'docs://api',
    'API Reference',
    'API documentation',
    '## API Reference\n\n- GET /health - Health check\n- POST /tools/call - Execute a tool',
    'read'
  );

  provider.registerText(
    'config://settings',
    'Server Settings',
    'Server configuration (requires write access)',
    'max_connections=100\ntimeout_ms=30000\ndebug=false',
    'write'
  );

  // Structured resources
  provider.registerStructured(
    'data://users',
    'User List',
    'List of users (requires read access)',
    {
      users: [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
        { id: 3, name: 'Charlie', role: 'user' },
      ],
      total: 3,
    },
    'read'
  );

  provider.registerStructured(
    'data://secrets',
    'Secrets',
    'Secret configuration (requires admin access)',
    {
      apiKey: 'sk-xxx-redacted',
      databaseUrl: 'postgres://user:pass@host/db',
      encryptionKey: 'aes-256-key-here',
    },
    'admin'
  );

  // Binary resource
  provider.registerBinary(
    'files://logo.png',
    'Logo',
    'Company logo image',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG header
    'image/png',
    'read'
  );

  return provider;
}
