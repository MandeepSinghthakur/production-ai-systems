// Permission scope enforcement for MCP.
// Validates that sessions have required permissions before tool/resource access.
// Defense in depth: permissions are checked at multiple layers.

import type {
  MCPSession,
  PermissionCheck,
  PermissionScope,
  ToolDefinition,
  ResourceDefinition,
} from './types.ts';

/**
 * Scope hierarchy: higher scopes include lower ones.
 * admin > execute > write > read
 */
const SCOPE_HIERARCHY: Record<PermissionScope, number> = {
  read: 1,
  write: 2,
  execute: 3,
  admin: 4,
};

/**
 * PermissionManager validates session permissions against required scopes.
 *
 * Usage:
 *   const manager = new PermissionManager();
 *   const session = manager.createSession('client-1', ['read', 'execute']);
 *   const check = manager.checkToolPermission(session, toolDef);
 *   if (!check.allowed) { reject(check.reason); }
 */
export class PermissionManager {
  private sessions: Map<string, MCPSession>;
  private sessionDurationMs: number;

  constructor(sessionDurationMs: number = 3600000) {
    this.sessions = new Map();
    this.sessionDurationMs = sessionDurationMs;
  }

  /**
   * Create a new session with granted scopes.
   */
  createSession(
    clientId: string,
    grantedScopes: PermissionScope[],
    capabilities: string[] = []
  ): MCPSession {
    const now = Date.now();
    const sessionId = `session-${clientId}-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const session: MCPSession = {
      sessionId,
      clientId,
      grantedScopes,
      negotiatedCapabilities: capabilities as any,
      createdAt: now,
      expiresAt: now + this.sessionDurationMs,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID, returns null if expired or not found.
   */
  getSession(sessionId: string): MCPSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Revoke a session.
   */
  revokeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if session has required scope.
   * Higher scopes include lower ones (admin includes all).
   */
  hasScope(session: MCPSession, requiredScope: PermissionScope): boolean {
    const requiredLevel = SCOPE_HIERARCHY[requiredScope];

    for (const granted of session.grantedScopes) {
      const grantedLevel = SCOPE_HIERARCHY[granted];
      if (grantedLevel >= requiredLevel) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check permission for tool access.
   */
  checkToolPermission(
    session: MCPSession | null,
    tool: ToolDefinition
  ): PermissionCheck {
    if (!session) {
      return {
        allowed: false,
        requiredScope: tool.requiredScope,
        grantedScopes: [],
        reason: 'Session not found or expired',
      };
    }

    if (Date.now() > session.expiresAt) {
      return {
        allowed: false,
        requiredScope: tool.requiredScope,
        grantedScopes: session.grantedScopes,
        reason: 'Session expired',
      };
    }

    const allowed = this.hasScope(session, tool.requiredScope);

    return {
      allowed,
      requiredScope: tool.requiredScope,
      grantedScopes: session.grantedScopes,
      reason: allowed
        ? null
        : `Scope '${tool.requiredScope}' required but not granted`,
    };
  }

  /**
   * Check permission for resource access.
   */
  checkResourcePermission(
    session: MCPSession | null,
    resource: ResourceDefinition
  ): PermissionCheck {
    if (!session) {
      return {
        allowed: false,
        requiredScope: resource.requiredScope,
        grantedScopes: [],
        reason: 'Session not found or expired',
      };
    }

    if (Date.now() > session.expiresAt) {
      return {
        allowed: false,
        requiredScope: resource.requiredScope,
        grantedScopes: session.grantedScopes,
        reason: 'Session expired',
      };
    }

    const allowed = this.hasScope(session, resource.requiredScope);

    return {
      allowed,
      requiredScope: resource.requiredScope,
      grantedScopes: session.grantedScopes,
      reason: allowed
        ? null
        : `Scope '${resource.requiredScope}' required but not granted`,
    };
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): MCPSession[] {
    const now = Date.now();
    const active: MCPSession[] = [];

    for (const [id, session] of this.sessions) {
      if (now <= session.expiresAt) {
        active.push(session);
      } else {
        this.sessions.delete(id);
      }
    }

    return active;
  }

  /**
   * Clear expired sessions.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * Validate that a scope string is valid.
 */
export function isValidScope(scope: string): scope is PermissionScope {
  return scope in SCOPE_HIERARCHY;
}

/**
 * Parse scope strings into validated scopes.
 */
export function parseScopes(scopes: string[]): PermissionScope[] {
  const valid: PermissionScope[] = [];
  for (const scope of scopes) {
    if (isValidScope(scope)) {
      valid.push(scope);
    }
  }
  return valid;
}
