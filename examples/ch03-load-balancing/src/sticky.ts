// Sticky session management for long-lived connections.
// See Chapter 3, "Building Production AI Systems".

import type {
  Backend,
  StickyConfig,
  StickySession,
  StickyResult,
} from './types.ts';

const DEFAULT_CONFIG: StickyConfig = {
  enabled: true,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  cookieName: 'backend_affinity',
  hashFunction: 'tenant',
};

/**
 * Sticky session manager that maintains affinity between clients
 * and backends. Essential for stateful conversations where switching
 * backends mid-stream causes context loss.
 */
export class StickySessionManager {
  private config: StickyConfig;
  private sessions: Map<string, StickySession>;
  private backendLookup: Map<string, Backend>;

  constructor(config: Partial<StickyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessions = new Map();
    this.backendLookup = new Map();
  }

  /**
   * Register a backend for sticky routing.
   */
  registerBackend(backend: Backend): void {
    this.backendLookup.set(backend.id, backend);
  }

  /**
   * Unregister a backend and invalidate all its sticky sessions.
   */
  unregisterBackend(backendId: string): number {
    this.backendLookup.delete(backendId);

    let invalidated = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (session.backendId === backendId) {
        this.sessions.delete(key);
        invalidated++;
      }
    }

    return invalidated;
  }

  /**
   * Look up or create a sticky session.
   */
  lookup(key: string): StickyResult {
    if (!this.config.enabled) {
      return {
        hit: false,
        session: null,
        backend: null,
        fallback: false,
      };
    }

    const session = this.sessions.get(key);

    if (!session) {
      return {
        hit: false,
        session: null,
        backend: null,
        fallback: false,
      };
    }

    // Check TTL
    const now = Date.now();
    if (now - session.lastAccessedAt > this.config.ttlMs) {
      this.sessions.delete(key);
      return {
        hit: false,
        session: null,
        backend: null,
        fallback: false,
      };
    }

    // Check if backend is still available
    const backend = this.backendLookup.get(session.backendId);

    if (!backend) {
      // Backend removed - invalidate session
      this.sessions.delete(key);
      return {
        hit: false,
        session,
        backend: null,
        fallback: true,
      };
    }

    if (!backend.healthy) {
      // Backend unhealthy - return session but signal fallback may be needed
      return {
        hit: true,
        session,
        backend,
        fallback: true,
      };
    }

    // Update last accessed time
    session.lastAccessedAt = now;
    session.requestCount++;

    return {
      hit: true,
      session,
      backend,
      fallback: false,
    };
  }

  /**
   * Create a new sticky session.
   */
  create(key: string, backend: Backend): StickySession {
    const now = Date.now();

    const session: StickySession = {
      key,
      backendId: backend.id,
      createdAt: now,
      lastAccessedAt: now,
      requestCount: 1,
    };

    this.sessions.set(key, session);
    return session;
  }

  /**
   * Invalidate a specific session.
   */
  invalidate(key: string): boolean {
    return this.sessions.delete(key);
  }

  /**
   * Invalidate all sessions for a backend.
   */
  invalidateByBackend(backendId: string): number {
    let count = 0;
    for (const [key, session] of this.sessions.entries()) {
      if (session.backendId === backendId) {
        this.sessions.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clean up expired sessions.
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > this.config.ttlMs) {
        this.sessions.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get distribution of sessions across backends.
   */
  getDistribution(): Map<string, number> {
    const dist = new Map<string, number>();

    for (const session of this.sessions.values()) {
      const count = dist.get(session.backendId) ?? 0;
      dist.set(session.backendId, count + 1);
    }

    return dist;
  }

  /**
   * Get total session count.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get sessions by backend.
   */
  getSessionsByBackend(backendId: string): StickySession[] {
    const result: StickySession[] = [];
    for (const session of this.sessions.values()) {
      if (session.backendId === backendId) {
        result.push({ ...session });
      }
    }
    return result;
  }

  /**
   * Generate a sticky key based on configuration.
   */
  generateKey(
    tenantId: string,
    sessionId?: string,
    ipAddress?: string
  ): string {
    switch (this.config.hashFunction) {
      case 'tenant':
        return `tenant:${tenantId}`;
      case 'session':
        return `session:${sessionId ?? tenantId}`;
      case 'ip':
        return `ip:${ipAddress ?? tenantId}`;
      default:
        return `tenant:${tenantId}`;
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): StickyConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<StickyConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export { DEFAULT_CONFIG as DEFAULT_STICKY_CONFIG };
