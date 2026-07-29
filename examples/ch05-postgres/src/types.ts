// Core types for Postgres patterns in AI systems.
// See Chapter 5, "Building Production AI Systems".

/**
 * Configuration for a connection pool.
 */
export interface PoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
}

/**
 * A single connection in the pool.
 */
export interface PooledConnection {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
  queryCount: number;
}

/**
 * Pool statistics for monitoring.
 */
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  acquireTimeouts: number;
  connectionsCreated: number;
  connectionsDestroyed: number;
}

/**
 * Query execution result.
 */
export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  fromReplica: boolean;
}

/**
 * Index type for query planning.
 */
export type IndexType = 'btree' | 'gin' | 'gist' | 'hash' | 'brin';

/**
 * Index definition for the planner.
 */
export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  type: IndexType;
  isPartial: boolean;
  predicate?: string;
  includeColumns?: string[];
}

/**
 * Query plan information.
 */
export interface QueryPlan {
  indexUsed: IndexDefinition | null;
  estimatedRows: number;
  estimatedCost: number;
  scanType: 'index_scan' | 'index_only_scan' | 'seq_scan' | 'bitmap_scan';
  explanation: string;
}

/**
 * Table partition definition.
 */
export interface PartitionDefinition {
  name: string;
  parentTable: string;
  partitionKey: string;
  partitionType: 'range' | 'list' | 'hash';
  rangeStart?: string | number;
  rangeEnd?: string | number;
  listValues?: (string | number)[];
  hashModulus?: number;
  hashRemainder?: number;
}

/**
 * Partition statistics.
 */
export interface PartitionStats {
  partitionName: string;
  rowCount: number;
  sizeBytes: number;
  lastVacuum: number | null;
  lastAnalyze: number | null;
}

/**
 * Read/write routing configuration.
 */
export interface RoutingConfig {
  primaryHost: string;
  replicaHosts: string[];
  replicaLagThresholdMs: number;
  loadBalanceStrategy: 'round_robin' | 'least_connections' | 'random';
}

/**
 * Replica state for routing decisions.
 */
export interface ReplicaState {
  host: string;
  lagMs: number;
  activeConnections: number;
  healthy: boolean;
  lastHealthCheck: number;
}

/**
 * JSONB document for flexible schemas.
 */
export interface DocumentRow {
  id: string;
  tenantId: string;
  docType: string;
  data: Record<string, unknown>;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Embedding storage for pgvector concepts.
 */
export interface EmbeddingRow {
  id: string;
  documentId: string;
  vector: number[];
  model: string;
  createdAt: number;
}

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * An AI request that may use Postgres.
 */
export interface AIRequest {
  tenantId: string;
  requestId: string;
  prompt: string;
  tier: ModelTier;
  requiresFreshData: boolean;
  maxLatencyMs: number;
}
