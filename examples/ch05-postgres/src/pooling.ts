// Connection pooling simulation for Postgres.
//
// The key insight: Postgres connections are expensive to establish
// (process forking, authentication, SSL handshake). A pool amortizes
// this cost across many queries. For AI workloads with bursty traffic,
// proper pool sizing prevents connection storms while avoiding idle waste.
//
// This is an in-memory simulation that models PgBouncer-like behavior.

import type {
  PoolConfig,
  PooledConnection,
  PoolStats,
  QueryResult,
} from './types.ts';
import { randomUUID } from 'node:crypto';

const DEFAULT_CONFIG: PoolConfig = {
  maxConnections: 20,
  minConnections: 2,
  acquireTimeoutMs: 5000,
  idleTimeoutMs: 30000,
  maxLifetimeMs: 3600000, // 1 hour
};

export class ConnectionPool {
  private connections: Map<string, PooledConnection>;
  private config: PoolConfig;
  private stats: PoolStats;
  private waitQueue: Array<{
    resolve: (conn: PooledConnection) => void;
    reject: (err: Error) => void;
    enqueuedAt: number;
  }>;

  constructor(config: Partial<PoolConfig> = {}) {
    this.connections = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      acquireTimeouts: 0,
      connectionsCreated: 0,
      connectionsDestroyed: 0,
    };
    this.waitQueue = [];

    // Initialize minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      this.createConnection();
    }
  }

  /**
   * Create a new connection (simulates Postgres connection establishment).
   */
  private createConnection(): PooledConnection {
    const now = Date.now();
    const conn: PooledConnection = {
      id: randomUUID(),
      createdAt: now,
      lastUsedAt: now,
      inUse: false,
      queryCount: 0,
    };
    this.connections.set(conn.id, conn);
    this.stats.totalConnections++;
    this.stats.idleConnections++;
    this.stats.connectionsCreated++;
    return conn;
  }

  /**
   * Destroy a connection.
   */
  private destroyConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;

    if (conn.inUse) {
      this.stats.activeConnections--;
    } else {
      this.stats.idleConnections--;
    }
    this.connections.delete(id);
    this.stats.totalConnections--;
    this.stats.connectionsDestroyed++;
  }

  /**
   * Acquire a connection from the pool.
   * If none available and under max, creates a new one.
   * If at max, waits in queue until timeout.
   */
  async acquire(): Promise<PooledConnection> {
    // First, try to find an idle connection
    for (const conn of this.connections.values()) {
      if (!conn.inUse && !this.isConnectionExpired(conn)) {
        conn.inUse = true;
        conn.lastUsedAt = Date.now();
        this.stats.idleConnections--;
        this.stats.activeConnections++;
        return conn;
      }
    }

    // Clean up expired connections
    this.cleanupExpired();

    // If under max, create a new connection
    if (this.stats.totalConnections < this.config.maxConnections) {
      const conn = this.createConnection();
      conn.inUse = true;
      this.stats.idleConnections--;
      this.stats.activeConnections++;
      return conn;
    }

    // At max capacity, wait in queue
    return new Promise<PooledConnection>((resolve, reject) => {
      const request = {
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };
      this.waitQueue.push(request);
      this.stats.waitingRequests++;

      // Set timeout
      setTimeout(() => {
        const idx = this.waitQueue.indexOf(request);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
          this.stats.waitingRequests--;
          this.stats.acquireTimeouts++;
          reject(new Error('Connection acquire timeout'));
        }
      }, this.config.acquireTimeoutMs);
    });
  }

  /**
   * Release a connection back to the pool.
   */
  release(connection: PooledConnection): void {
    const conn = this.connections.get(connection.id);
    if (!conn || !conn.inUse) return;

    conn.inUse = false;
    conn.lastUsedAt = Date.now();
    conn.queryCount++;
    this.stats.activeConnections--;

    // Check if connection should be retired due to max lifetime
    if (this.isConnectionExpired(conn)) {
      this.destroyConnection(conn.id);
      return;
    }

    // Check wait queue first
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        this.stats.waitingRequests--;
        conn.inUse = true;
        conn.lastUsedAt = Date.now();
        this.stats.activeConnections++;
        waiter.resolve(conn);
        return;
      }
    }

    this.stats.idleConnections++;
  }

  /**
   * Check if a connection has exceeded its lifetime.
   */
  private isConnectionExpired(conn: PooledConnection): boolean {
    const age = Date.now() - conn.createdAt;
    return age > this.config.maxLifetimeMs;
  }

  /**
   * Clean up idle and expired connections.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const toDestroy: string[] = [];

    for (const conn of this.connections.values()) {
      if (conn.inUse) continue;

      // Check max lifetime
      if (now - conn.createdAt > this.config.maxLifetimeMs) {
        toDestroy.push(conn.id);
        continue;
      }

      // Check idle timeout (but keep minimum connections)
      if (
        now - conn.lastUsedAt > this.config.idleTimeoutMs &&
        this.stats.totalConnections > this.config.minConnections
      ) {
        toDestroy.push(conn.id);
      }
    }

    for (const id of toDestroy) {
      this.destroyConnection(id);
    }
  }

  /**
   * Execute a query using a pooled connection.
   */
  async query(
    _sql: string,
    simulatedLatencyMs: number = 10
  ): Promise<QueryResult> {
    const conn = await this.acquire();
    const start = Date.now();

    try {
      // Simulate query execution
      await new Promise((r) => setTimeout(r, simulatedLatencyMs));

      return {
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - start,
        fromReplica: false,
      };
    } finally {
      this.release(conn);
    }
  }

  /**
   * Get current pool statistics.
   */
  getStats(): PoolStats {
    return { ...this.stats };
  }

  /**
   * Get pool utilization (active / total).
   */
  getUtilization(): number {
    if (this.stats.totalConnections === 0) return 0;
    return this.stats.activeConnections / this.stats.totalConnections;
  }

  /**
   * Drain the pool (for graceful shutdown).
   */
  async drain(): Promise<void> {
    // Wait for all connections to be released
    while (this.stats.activeConnections > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Destroy all connections
    for (const id of Array.from(this.connections.keys())) {
      this.destroyConnection(id);
    }

    // Reject all waiters
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('Pool is draining'));
    }
    this.waitQueue = [];
    this.stats.waitingRequests = 0;
  }

  /**
   * Force close all connections.
   */
  forceClose(): void {
    for (const id of Array.from(this.connections.keys())) {
      this.destroyConnection(id);
    }
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('Pool force closed'));
    }
    this.waitQueue = [];
    this.stats.waitingRequests = 0;
  }
}

/**
 * Simulate the overhead of establishing connections without a pool.
 * Each connection takes ~50-100ms to establish (TCP, SSL, auth).
 */
export async function simulateWithoutPool(
  queries: number,
  connectionOverheadMs: number = 50,
  queryTimeMs: number = 10
): Promise<{ totalMs: number; queriesCompleted: number }> {
  let totalMs = 0;

  for (let i = 0; i < queries; i++) {
    // Connection establishment
    await new Promise((r) => setTimeout(r, connectionOverheadMs));
    totalMs += connectionOverheadMs;

    // Query execution
    await new Promise((r) => setTimeout(r, queryTimeMs));
    totalMs += queryTimeMs;
  }

  return { totalMs, queriesCompleted: queries };
}

/**
 * Simulate queries with pooling.
 */
export async function simulateWithPool(
  pool: ConnectionPool,
  queries: number,
  queryTimeMs: number = 10
): Promise<{ totalMs: number; queriesCompleted: number }> {
  const start = Date.now();

  const promises: Promise<QueryResult>[] = [];
  for (let i = 0; i < queries; i++) {
    promises.push(pool.query('SELECT 1', queryTimeMs));
  }

  await Promise.all(promises);
  return { totalMs: Date.now() - start, queriesCompleted: queries };
}
