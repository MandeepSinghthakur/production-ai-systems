// Connection rebalancing for long-lived connections.
// See Chapter 3, "Building Production AI Systems".

import type {
  Backend,
  Connection,
  RebalanceConfig,
  RebalanceResult,
} from './types.ts';

const DEFAULT_CONFIG: RebalanceConfig = {
  enabled: true,
  intervalMs: 60000,
  imbalanceThreshold: 0.3, // Coefficient of variation
  maxMigrationsPerCycle: 10,
  drainTimeoutMs: 30000,
};

/**
 * Connection state for the rebalancer.
 */
interface ManagedConnection extends Connection {
  drainStarted?: number;
  migrationTarget?: string;
}

/**
 * Connection rebalancer that gracefully migrates connections
 * from overloaded backends to underloaded ones without dropping
 * in-flight requests.
 */
export class ConnectionRebalancer {
  private config: RebalanceConfig;
  private connections: Map<string, ManagedConnection>;
  private backends: Map<string, Backend>;

  constructor(config: Partial<RebalanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connections = new Map();
    this.backends = new Map();
  }

  /**
   * Register a backend.
   */
  registerBackend(backend: Backend): void {
    this.backends.set(backend.id, backend);
  }

  /**
   * Unregister a backend.
   */
  unregisterBackend(backendId: string): void {
    this.backends.delete(backendId);
  }

  /**
   * Add a connection to be managed.
   */
  addConnection(conn: Connection): void {
    this.connections.set(conn.id, { ...conn });
    this.updateBackendCount(conn.backendId, 1);
  }

  /**
   * Remove a connection.
   */
  removeConnection(connId: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn) return false;

    this.updateBackendCount(conn.backendId, -1);
    return this.connections.delete(connId);
  }

  /**
   * Get a connection by ID.
   */
  getConnection(connId: string): Connection | null {
    const conn = this.connections.get(connId);
    return conn ? { ...conn } : null;
  }

  /**
   * Update backend connection count.
   */
  private updateBackendCount(backendId: string, delta: number): void {
    const backend = this.backends.get(backendId);
    if (backend) {
      backend.activeConnections = Math.max(
        0,
        backend.activeConnections + delta
      );
    }
  }

  /**
   * Calculate imbalance as coefficient of variation.
   */
  calculateImbalance(): number {
    const healthyBackends = Array.from(this.backends.values()).filter(
      (b) => b.healthy
    );
    if (healthyBackends.length < 2) return 0;

    const counts = healthyBackends.map((b) => b.activeConnections);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;

    if (mean === 0) return 0;

    const variance =
      counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    return stdDev / mean;
  }

  /**
   * Identify connections that should be migrated.
   */
  identifyMigrations(): Array<{ connId: string; from: string; to: string }> {
    if (!this.config.enabled) return [];

    const imbalance = this.calculateImbalance();
    if (imbalance < this.config.imbalanceThreshold) return [];

    const healthyBackends = Array.from(this.backends.values()).filter(
      (b) => b.healthy
    );
    if (healthyBackends.length < 2) return [];

    // Sort by connection count
    const sorted = [...healthyBackends].sort(
      (a, b) => b.activeConnections - a.activeConnections
    );

    const overloaded = sorted[0];
    const underloaded = sorted[sorted.length - 1];

    // Only migrate if there is a significant difference
    const diff = overloaded.activeConnections - underloaded.activeConnections;
    if (diff < 2) return [];

    // Find connections on the overloaded backend
    const candidateConnections = Array.from(this.connections.values())
      .filter(
        (c) =>
          c.backendId === overloaded.id &&
          c.state === 'active' &&
          !c.drainStarted
      )
      .slice(0, Math.min(this.config.maxMigrationsPerCycle, Math.floor(diff / 2)));

    return candidateConnections.map((c) => ({
      connId: c.id,
      from: overloaded.id,
      to: underloaded.id,
    }));
  }

  /**
   * Start draining a connection for migration.
   */
  startDrain(connId: string, targetBackendId: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn || conn.state !== 'active') return false;

    conn.state = 'draining';
    conn.drainStarted = Date.now();
    conn.migrationTarget = targetBackendId;

    return true;
  }

  /**
   * Complete a migration after draining.
   */
  completeMigration(connId: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn || conn.state !== 'draining' || !conn.migrationTarget) {
      return false;
    }

    const oldBackendId = conn.backendId;
    const newBackendId = conn.migrationTarget;

    // Update counts
    this.updateBackendCount(oldBackendId, -1);
    this.updateBackendCount(newBackendId, 1);

    // Update connection
    conn.backendId = newBackendId;
    conn.state = 'active';
    conn.drainStarted = undefined;
    conn.migrationTarget = undefined;

    return true;
  }

  /**
   * Cancel a migration.
   */
  cancelMigration(connId: string): boolean {
    const conn = this.connections.get(connId);
    if (!conn || conn.state !== 'draining') return false;

    conn.state = 'active';
    conn.drainStarted = undefined;
    conn.migrationTarget = undefined;

    return true;
  }

  /**
   * Execute a full rebalancing cycle.
   */
  rebalance(): RebalanceResult {
    const imbalanceBefore = this.calculateImbalance();
    const migrations = this.identifyMigrations();

    let completed = 0;
    let preserved = 0;

    for (const m of migrations) {
      const conn = this.connections.get(m.connId);
      if (!conn) continue;

      // Simulate drain and migration
      // In production, this would be asynchronous with actual drain timeout
      if (this.startDrain(m.connId, m.to)) {
        // Immediately complete for simulation
        // In production, you would wait for in-flight requests to complete
        if (this.completeMigration(m.connId)) {
          completed++;
        }
      }
    }

    // Count connections that were not migrated
    preserved = this.connections.size - completed;

    return {
      timestamp: Date.now(),
      migrationsAttempted: migrations.length,
      migrationsCompleted: completed,
      connectionsPreserved: preserved,
      imbalanceBefore,
      imbalanceAfter: this.calculateImbalance(),
    };
  }

  /**
   * Check for timed-out drains and cancel them.
   */
  checkDrainTimeouts(): number {
    const now = Date.now();
    let cancelled = 0;

    for (const conn of this.connections.values()) {
      if (
        conn.state === 'draining' &&
        conn.drainStarted &&
        now - conn.drainStarted > this.config.drainTimeoutMs
      ) {
        this.cancelMigration(conn.id);
        cancelled++;
      }
    }

    return cancelled;
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalConnections: number;
    drainingConnections: number;
    imbalance: number;
    backendCounts: Map<string, number>;
  } {
    const backendCounts = new Map<string, number>();

    for (const backend of this.backends.values()) {
      backendCounts.set(backend.id, backend.activeConnections);
    }

    let draining = 0;
    for (const conn of this.connections.values()) {
      if (conn.state === 'draining') draining++;
    }

    return {
      totalConnections: this.connections.size,
      drainingConnections: draining,
      imbalance: this.calculateImbalance(),
      backendCounts,
    };
  }

  /**
   * Get configuration.
   */
  getConfig(): RebalanceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<RebalanceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export { DEFAULT_CONFIG as DEFAULT_REBALANCE_CONFIG };
