// Query optimization patterns for AI workloads.
//
// The key insight: AI systems have distinct read patterns. Embedding
// lookup is latency-critical and read-heavy. Audit logging is
// write-heavy and rarely read. JSONB enables schema evolution without
// migrations. Read replicas handle the read amplification from
// retrieval pipelines.
//
// This simulates read/write routing and JSONB query patterns.

import type {
  RoutingConfig,
  ReplicaState,
  QueryResult,
  DocumentRow,
  AIRequest,
} from './types.ts';

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  primaryHost: 'primary.db.local',
  replicaHosts: ['replica1.db.local', 'replica2.db.local'],
  replicaLagThresholdMs: 1000,
  loadBalanceStrategy: 'round_robin',
};

/**
 * Read/write router that directs queries to appropriate nodes.
 */
export class QueryRouter {
  private config: RoutingConfig;
  private replicaStates: Map<string, ReplicaState>;
  private roundRobinIndex: number;
  private queryStats: {
    primaryReads: number;
    replicaReads: number;
    writes: number;
    replicaFallbacks: number;
  };

  constructor(config: Partial<RoutingConfig> = {}) {
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config };
    this.replicaStates = new Map();
    this.roundRobinIndex = 0;
    this.queryStats = {
      primaryReads: 0,
      replicaReads: 0,
      writes: 0,
      replicaFallbacks: 0,
    };

    // Initialize replica states
    for (const host of this.config.replicaHosts) {
      this.replicaStates.set(host, {
        host,
        lagMs: 0,
        activeConnections: 0,
        healthy: true,
        lastHealthCheck: Date.now(),
      });
    }
  }

  /**
   * Route a read query to the appropriate node.
   */
  routeRead(request: AIRequest): { host: string; fromReplica: boolean } {
    // If request requires fresh data, use primary
    if (request.requiresFreshData) {
      this.queryStats.primaryReads++;
      return { host: this.config.primaryHost, fromReplica: false };
    }

    // If request has tight latency requirements, prefer primary
    // (replica may have lag overhead)
    if (request.maxLatencyMs < 50) {
      this.queryStats.primaryReads++;
      return { host: this.config.primaryHost, fromReplica: false };
    }

    // Try to find a healthy replica with acceptable lag
    const replica = this.selectReplica();
    if (replica) {
      this.queryStats.replicaReads++;
      return { host: replica.host, fromReplica: true };
    }

    // Fall back to primary if no healthy replicas
    this.queryStats.replicaFallbacks++;
    this.queryStats.primaryReads++;
    return { host: this.config.primaryHost, fromReplica: false };
  }

  /**
   * Route a write query (always to primary).
   */
  routeWrite(): { host: string } {
    this.queryStats.writes++;
    return { host: this.config.primaryHost };
  }

  /**
   * Select a replica based on load balancing strategy.
   */
  private selectReplica(): ReplicaState | null {
    const healthyReplicas = Array.from(this.replicaStates.values()).filter(
      (r) => r.healthy && r.lagMs <= this.config.replicaLagThresholdMs
    );

    if (healthyReplicas.length === 0) {
      return null;
    }

    switch (this.config.loadBalanceStrategy) {
      case 'round_robin':
        this.roundRobinIndex =
          (this.roundRobinIndex + 1) % healthyReplicas.length;
        return healthyReplicas[this.roundRobinIndex];

      case 'least_connections':
        return healthyReplicas.reduce((min, r) =>
          r.activeConnections < min.activeConnections ? r : min
        );

      case 'random':
        return healthyReplicas[
          Math.floor(Math.random() * healthyReplicas.length)
        ];

      default:
        return healthyReplicas[0];
    }
  }

  /**
   * Update replica state (called by health checker).
   */
  updateReplicaState(host: string, state: Partial<ReplicaState>): void {
    const current = this.replicaStates.get(host);
    if (current) {
      this.replicaStates.set(host, {
        ...current,
        ...state,
        lastHealthCheck: Date.now(),
      });
    }
  }

  /**
   * Simulate replica lag.
   */
  simulateReplicaLag(host: string, lagMs: number): void {
    this.updateReplicaState(host, { lagMs });
  }

  /**
   * Mark a replica as unhealthy.
   */
  markReplicaUnhealthy(host: string): void {
    this.updateReplicaState(host, { healthy: false });
  }

  /**
   * Mark a replica as healthy.
   */
  markReplicaHealthy(host: string): void {
    this.updateReplicaState(host, { healthy: true });
  }

  /**
   * Get query statistics.
   */
  getStats(): typeof this.queryStats & { replicaUtilization: number } {
    const totalReads =
      this.queryStats.primaryReads + this.queryStats.replicaReads;
    return {
      ...this.queryStats,
      replicaUtilization:
        totalReads > 0 ? this.queryStats.replicaReads / totalReads : 0,
    };
  }

  /**
   * Get replica states.
   */
  getReplicaStates(): ReplicaState[] {
    return Array.from(this.replicaStates.values());
  }
}

/**
 * JSONB document store with query optimization.
 */
export class DocumentStore {
  private documents: Map<string, DocumentRow>;
  private indexes: Map<string, Map<string, Set<string>>>; // path -> value -> docIds

  constructor() {
    this.documents = new Map();
    this.indexes = new Map();
  }

  /**
   * Insert a document with JSONB data.
   */
  insert(doc: DocumentRow): void {
    this.documents.set(doc.id, doc);
    this.updateIndexes(doc);
  }

  /**
   * Update a document (JSONB merge).
   */
  update(
    id: string,
    updates: Partial<Record<string, unknown>>
  ): DocumentRow | null {
    const doc = this.documents.get(id);
    if (!doc) return null;

    // Remove from old indexes
    this.removeFromIndexes(doc);

    // Merge updates into data
    const updated: DocumentRow = {
      ...doc,
      data: { ...doc.data, ...updates },
      updatedAt: Date.now(),
    };

    this.documents.set(id, updated);
    this.updateIndexes(updated);

    return updated;
  }

  /**
   * Query documents by JSONB path.
   */
  queryByPath(
    path: string,
    value: unknown,
    options: { useIndex?: boolean } = {}
  ): QueryResult {
    const start = Date.now();
    const rows: Record<string, unknown>[] = [];

    if (options.useIndex !== false) {
      // Try to use index
      const index = this.indexes.get(path);
      if (index) {
        const docIds = index.get(String(value));
        if (docIds) {
          for (const id of docIds) {
            const doc = this.documents.get(id);
            if (doc) rows.push(doc as unknown as Record<string, unknown>);
          }
          return {
            rows,
            rowCount: rows.length,
            durationMs: Date.now() - start,
            fromReplica: false,
          };
        }
      }
    }

    // Fall back to full scan
    for (const doc of this.documents.values()) {
      if (this.getNestedValue(doc.data, path) === value) {
        rows.push(doc as unknown as Record<string, unknown>);
      }
    }

    return {
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start,
      fromReplica: false,
    };
  }

  /**
   * Query with JSONB containment (@>).
   */
  queryContains(
    pattern: Record<string, unknown>
  ): QueryResult {
    const start = Date.now();
    const rows: Record<string, unknown>[] = [];

    for (const doc of this.documents.values()) {
      if (this.contains(doc.data, pattern)) {
        rows.push(doc as unknown as Record<string, unknown>);
      }
    }

    return {
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start,
      fromReplica: false,
    };
  }

  /**
   * Check if object contains pattern (like @> operator).
   */
  private contains(
    obj: Record<string, unknown>,
    pattern: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(pattern)) {
      if (!(key in obj)) return false;

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        if (
          typeof obj[key] !== 'object' ||
          obj[key] === null ||
          Array.isArray(obj[key])
        ) {
          return false;
        }
        if (
          !this.contains(
            obj[key] as Record<string, unknown>,
            value as Record<string, unknown>
          )
        ) {
          return false;
        }
      } else if (obj[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create a GIN-like index on a JSONB path.
   */
  createIndex(path: string): void {
    const index = new Map<string, Set<string>>();

    for (const doc of this.documents.values()) {
      const value = this.getNestedValue(doc.data, path);
      if (value !== undefined) {
        const key = String(value);
        if (!index.has(key)) {
          index.set(key, new Set());
        }
        index.get(key)!.add(doc.id);
      }
    }

    this.indexes.set(path, index);
  }

  /**
   * Update indexes for a document.
   */
  private updateIndexes(doc: DocumentRow): void {
    for (const [path, index] of this.indexes) {
      const value = this.getNestedValue(doc.data, path);
      if (value !== undefined) {
        const key = String(value);
        if (!index.has(key)) {
          index.set(key, new Set());
        }
        index.get(key)!.add(doc.id);
      }
    }
  }

  /**
   * Remove document from indexes.
   */
  private removeFromIndexes(doc: DocumentRow): void {
    for (const [path, index] of this.indexes) {
      const value = this.getNestedValue(doc.data, path);
      if (value !== undefined) {
        const key = String(value);
        const docIds = index.get(key);
        if (docIds) {
          docIds.delete(doc.id);
        }
      }
    }
  }

  /**
   * Get a nested value from an object using dot notation.
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Get document count.
   */
  count(): number {
    return this.documents.size;
  }

  /**
   * Get index statistics.
   */
  getIndexStats(): { path: string; distinctValues: number; totalRefs: number }[] {
    const stats: { path: string; distinctValues: number; totalRefs: number }[] = [];

    for (const [path, index] of this.indexes) {
      let totalRefs = 0;
      for (const docIds of index.values()) {
        totalRefs += docIds.size;
      }
      stats.push({
        path,
        distinctValues: index.size,
        totalRefs,
      });
    }

    return stats;
  }
}

/**
 * Simulate read amplification from a retrieval pipeline.
 */
export async function simulateRetrievalPipeline(
  router: QueryRouter,
  requests: AIRequest[],
  documentsPerRequest: number
): Promise<{
  totalQueries: number;
  primaryQueries: number;
  replicaQueries: number;
  avgLatencyMs: number;
}> {
  let totalLatency = 0;
  let totalQueries = 0;
  let primaryQueries = 0;
  let replicaQueries = 0;

  for (const request of requests) {
    // Each retrieval request generates multiple queries:
    // 1. Embedding lookup
    // 2. Vector search (would go to pgvector)
    // 3. Document fetch for each result

    // Embedding lookup - needs fresh data
    const embeddingRoute = router.routeRead({
      ...request,
      requiresFreshData: true,
    });
    if (embeddingRoute.fromReplica) {
      replicaQueries++;
    } else {
      primaryQueries++;
    }
    totalQueries++;
    totalLatency += 5; // Fast lookup

    // Document fetches - can use replicas
    for (let i = 0; i < documentsPerRequest; i++) {
      const docRoute = router.routeRead({
        ...request,
        requiresFreshData: false,
        maxLatencyMs: 100,
      });
      if (docRoute.fromReplica) {
        replicaQueries++;
      } else {
        primaryQueries++;
      }
      totalQueries++;
      totalLatency += 10; // Document fetch
    }
  }

  return {
    totalQueries,
    primaryQueries,
    replicaQueries,
    avgLatencyMs: totalQueries > 0 ? totalLatency / totalQueries : 0,
  };
}

/**
 * Demonstrate JSONB query performance with and without indexes.
 */
export function demonstrateJSONBPerformance(
  documentCount: number
): { withIndex: QueryResult; withoutIndex: QueryResult } {
  const store = new DocumentStore();

  // Insert documents
  for (let i = 0; i < documentCount; i++) {
    store.insert({
      id: `doc_${i}`,
      tenantId: `tenant_${i % 10}`,
      docType: i % 3 === 0 ? 'invoice' : i % 3 === 1 ? 'receipt' : 'contract',
      data: {
        type: i % 3 === 0 ? 'invoice' : i % 3 === 1 ? 'receipt' : 'contract',
        amount: Math.random() * 10000,
        currency: 'USD',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Query without index (full scan)
  const withoutIndex = store.queryByPath('type', 'invoice', { useIndex: false });

  // Create index and query with it
  store.createIndex('type');
  const withIndex = store.queryByPath('type', 'invoice', { useIndex: true });

  return { withIndex, withoutIndex };
}
