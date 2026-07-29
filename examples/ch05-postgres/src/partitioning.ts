// Table partitioning for large Postgres tables.
//
// The key insight: AI systems generate massive append-only logs (prompts,
// responses, embeddings, audit trails). Without partitioning, queries
// scan billions of rows. With range partitioning by time, queries touch
// only relevant months. With list partitioning by tenant, isolation is
// free.
//
// This simulates partition routing and statistics.

import type { PartitionDefinition, PartitionStats } from './types.ts';

/**
 * A row to be routed to a partition.
 */
export interface PartitionableRow {
  partitionKey: string | number | Date;
  data: Record<string, unknown>;
}

/**
 * Result of partition routing.
 */
export interface RoutingResult {
  partitionName: string;
  matched: boolean;
  reason: string;
}

/**
 * Query for partition pruning.
 */
export interface PartitionQuery {
  partitionKey: string;
  operator: '=' | '>' | '<' | '>=' | '<=' | 'BETWEEN' | 'IN';
  value: unknown;
  valueTo?: unknown; // For BETWEEN
}

/**
 * Result of partition pruning.
 */
export interface PruningResult {
  prunedPartitions: string[];
  scannedPartitions: string[];
  pruningRatio: number;
  explanation: string;
}

/**
 * Manages partitioned tables.
 */
export class PartitionManager {
  private partitions: Map<string, PartitionDefinition[]>;
  private stats: Map<string, PartitionStats>;

  constructor() {
    this.partitions = new Map();
    this.stats = new Map();
  }

  /**
   * Register partitions for a parent table.
   */
  registerPartitions(
    parentTable: string,
    partitions: PartitionDefinition[]
  ): void {
    this.partitions.set(parentTable, partitions);

    // Initialize stats
    for (const p of partitions) {
      this.stats.set(p.name, {
        partitionName: p.name,
        rowCount: 0,
        sizeBytes: 0,
        lastVacuum: null,
        lastAnalyze: null,
      });
    }
  }

  /**
   * Route a row to the correct partition.
   */
  routeRow(parentTable: string, row: PartitionableRow): RoutingResult {
    const partitions = this.partitions.get(parentTable);
    if (!partitions || partitions.length === 0) {
      return {
        partitionName: parentTable,
        matched: false,
        reason: 'No partitions defined; inserting into parent',
      };
    }

    const firstPartition = partitions[0];

    switch (firstPartition.partitionType) {
      case 'range':
        return this.routeRange(partitions, row);
      case 'list':
        return this.routeList(partitions, row);
      case 'hash':
        return this.routeHash(partitions, row);
      default:
        return {
          partitionName: parentTable,
          matched: false,
          reason: 'Unknown partition type',
        };
    }
  }

  /**
   * Route using range partitioning.
   */
  private routeRange(
    partitions: PartitionDefinition[],
    row: PartitionableRow
  ): RoutingResult {
    const key = row.partitionKey;

    for (const p of partitions) {
      if (p.rangeStart === undefined || p.rangeEnd === undefined) continue;

      // Handle Date comparison
      const keyValue = key instanceof Date ? key.getTime() : key;
      const start =
        p.rangeStart instanceof Date
          ? p.rangeStart.getTime()
          : typeof p.rangeStart === 'string' && !isNaN(Date.parse(p.rangeStart))
          ? Date.parse(p.rangeStart)
          : p.rangeStart;
      const end =
        p.rangeEnd instanceof Date
          ? p.rangeEnd.getTime()
          : typeof p.rangeEnd === 'string' && !isNaN(Date.parse(p.rangeEnd))
          ? Date.parse(p.rangeEnd)
          : p.rangeEnd;

      if (keyValue >= start && keyValue < end) {
        // Update stats
        const stats = this.stats.get(p.name);
        if (stats) {
          stats.rowCount++;
          stats.sizeBytes += this.estimateRowSize(row);
        }

        return {
          partitionName: p.name,
          matched: true,
          reason: `Key ${key} falls in range [${p.rangeStart}, ${p.rangeEnd})`,
        };
      }
    }

    return {
      partitionName: '',
      matched: false,
      reason: `No partition found for key ${key}`,
    };
  }

  /**
   * Route using list partitioning.
   */
  private routeList(
    partitions: PartitionDefinition[],
    row: PartitionableRow
  ): RoutingResult {
    const key = row.partitionKey;

    for (const p of partitions) {
      if (!p.listValues) continue;

      if (p.listValues.includes(key as string | number)) {
        const stats = this.stats.get(p.name);
        if (stats) {
          stats.rowCount++;
          stats.sizeBytes += this.estimateRowSize(row);
        }

        return {
          partitionName: p.name,
          matched: true,
          reason: `Key ${key} found in list [${p.listValues.join(', ')}]`,
        };
      }
    }

    return {
      partitionName: '',
      matched: false,
      reason: `No partition contains key ${key}`,
    };
  }

  /**
   * Route using hash partitioning.
   */
  private routeHash(
    partitions: PartitionDefinition[],
    row: PartitionableRow
  ): RoutingResult {
    const key = row.partitionKey;
    const hashValue = this.hashKey(key);

    for (const p of partitions) {
      if (p.hashModulus === undefined || p.hashRemainder === undefined)
        continue;

      if (hashValue % p.hashModulus === p.hashRemainder) {
        const stats = this.stats.get(p.name);
        if (stats) {
          stats.rowCount++;
          stats.sizeBytes += this.estimateRowSize(row);
        }

        return {
          partitionName: p.name,
          matched: true,
          reason: `Hash(${key}) % ${p.hashModulus} = ${p.hashRemainder}`,
        };
      }
    }

    return {
      partitionName: '',
      matched: false,
      reason: `No partition for hash(${key})`,
    };
  }

  /**
   * Simple hash function for demonstration.
   */
  private hashKey(key: string | number | Date): number {
    const str = key instanceof Date ? key.toISOString() : String(key);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Estimate row size in bytes.
   */
  private estimateRowSize(row: PartitionableRow): number {
    return JSON.stringify(row.data).length + 50; // overhead
  }

  /**
   * Determine which partitions to scan for a query.
   */
  prunePartitions(parentTable: string, query: PartitionQuery): PruningResult {
    const partitions = this.partitions.get(parentTable);
    if (!partitions || partitions.length === 0) {
      return {
        prunedPartitions: [],
        scannedPartitions: [parentTable],
        pruningRatio: 0,
        explanation: 'No partitions; scanning parent table',
      };
    }

    const firstPartition = partitions[0];
    const allPartitionNames = partitions.map((p) => p.name);

    let scanned: string[];
    switch (firstPartition.partitionType) {
      case 'range':
        scanned = this.pruneRange(partitions, query);
        break;
      case 'list':
        scanned = this.pruneList(partitions, query);
        break;
      case 'hash':
        scanned = this.pruneHash(partitions, query);
        break;
      default:
        scanned = allPartitionNames;
    }

    const pruned = allPartitionNames.filter((n) => !scanned.includes(n));
    const ratio = pruned.length / allPartitionNames.length;

    return {
      prunedPartitions: pruned,
      scannedPartitions: scanned,
      pruningRatio: ratio,
      explanation: this.explainPruning(
        firstPartition.partitionType,
        query,
        pruned.length,
        scanned.length
      ),
    };
  }

  /**
   * Prune range partitions.
   */
  private pruneRange(
    partitions: PartitionDefinition[],
    query: PartitionQuery
  ): string[] {
    const scanned: string[] = [];
    const value = query.value;
    const valueTo = query.valueTo;

    const normalizeValue = (v: unknown): number => {
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'string' && !isNaN(Date.parse(v)))
        return Date.parse(v);
      return v as number;
    };

    const queryValue = normalizeValue(value);
    const queryValueTo = valueTo ? normalizeValue(valueTo) : undefined;

    for (const p of partitions) {
      if (p.rangeStart === undefined || p.rangeEnd === undefined) continue;

      const start = normalizeValue(p.rangeStart);
      const end = normalizeValue(p.rangeEnd);

      let matches = false;
      switch (query.operator) {
        case '=':
          matches = queryValue >= start && queryValue < end;
          break;
        case '>':
          matches = end > queryValue;
          break;
        case '>=':
          matches = end > queryValue;
          break;
        case '<':
          matches = start < queryValue;
          break;
        case '<=':
          matches = start <= queryValue;
          break;
        case 'BETWEEN':
          if (queryValueTo !== undefined) {
            matches = !(end <= queryValue || start >= queryValueTo);
          }
          break;
      }

      if (matches) {
        scanned.push(p.name);
      }
    }

    return scanned;
  }

  /**
   * Prune list partitions.
   */
  private pruneList(
    partitions: PartitionDefinition[],
    query: PartitionQuery
  ): string[] {
    const scanned: string[] = [];

    // For list partitioning, only equality and IN operators prune
    if (query.operator !== '=' && query.operator !== 'IN') {
      return partitions.map((p) => p.name); // Scan all
    }

    const values =
      query.operator === 'IN'
        ? (query.value as (string | number)[])
        : [query.value as string | number];

    for (const p of partitions) {
      if (!p.listValues) continue;

      for (const v of values) {
        if (p.listValues.includes(v)) {
          scanned.push(p.name);
          break;
        }
      }
    }

    return scanned;
  }

  /**
   * Prune hash partitions.
   */
  private pruneHash(
    partitions: PartitionDefinition[],
    query: PartitionQuery
  ): string[] {
    // Hash partitioning only prunes on equality
    if (query.operator !== '=') {
      return partitions.map((p) => p.name); // Scan all
    }

    const hashValue = this.hashKey(query.value as string | number | Date);
    const scanned: string[] = [];

    for (const p of partitions) {
      if (p.hashModulus === undefined || p.hashRemainder === undefined)
        continue;

      if (hashValue % p.hashModulus === p.hashRemainder) {
        scanned.push(p.name);
      }
    }

    return scanned;
  }

  /**
   * Explain the pruning result.
   */
  private explainPruning(
    type: string,
    query: PartitionQuery,
    pruned: number,
    scanned: number
  ): string {
    const total = pruned + scanned;
    const pct = Math.round((pruned / total) * 100);

    return (
      `${type.charAt(0).toUpperCase() + type.slice(1)} partition pruning: ` +
      `${query.partitionKey} ${query.operator} ${query.value}` +
      (query.valueTo ? ` AND ${query.valueTo}` : '') +
      ` => pruned ${pruned}/${total} partitions (${pct}% eliminated)`
    );
  }

  /**
   * Get statistics for a partition.
   */
  getStats(partitionName: string): PartitionStats | undefined {
    return this.stats.get(partitionName);
  }

  /**
   * Get all partition statistics for a table.
   */
  getAllStats(parentTable: string): PartitionStats[] {
    const partitions = this.partitions.get(parentTable);
    if (!partitions) return [];

    return partitions
      .map((p) => this.stats.get(p.name))
      .filter((s): s is PartitionStats => s !== undefined);
  }
}

/**
 * Create monthly partitions for a time-series table.
 */
export function createMonthlyPartitions(
  parentTable: string,
  partitionKey: string,
  startYear: number,
  startMonth: number,
  count: number
): PartitionDefinition[] {
  const partitions: PartitionDefinition[] = [];

  let year = startYear;
  let month = startMonth;

  for (let i = 0; i < count; i++) {
    const rangeStart = new Date(year, month - 1, 1);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const rangeEnd = new Date(nextYear, nextMonth - 1, 1);

    const monthStr = String(month).padStart(2, '0');
    partitions.push({
      name: `${parentTable}_y${year}m${monthStr}`,
      parentTable,
      partitionKey,
      partitionType: 'range',
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    });

    month = nextMonth;
    year = nextYear;
  }

  return partitions;
}

/**
 * Create tenant partitions for multi-tenant isolation.
 */
export function createTenantPartitions(
  parentTable: string,
  partitionKey: string,
  tenantIds: string[]
): PartitionDefinition[] {
  return tenantIds.map((tenant) => ({
    name: `${parentTable}_${tenant}`,
    parentTable,
    partitionKey,
    partitionType: 'list' as const,
    listValues: [tenant],
  }));
}

/**
 * Demonstrate partition pruning effectiveness.
 */
export function demonstratePruningEffectiveness(): {
  withPruning: PruningResult;
  withoutPruning: { partitionsScanned: number };
} {
  const manager = new PartitionManager();

  // Create 24 monthly partitions (2 years of data)
  const partitions = createMonthlyPartitions(
    'ai_requests',
    'created_at',
    2024,
    1,
    24
  );
  manager.registerPartitions('ai_requests', partitions);

  // Query for last month only
  const query: PartitionQuery = {
    partitionKey: 'created_at',
    operator: 'BETWEEN',
    value: new Date(2025, 11, 1), // December 2025
    valueTo: new Date(2025, 11, 31, 23, 59, 59),
  };

  const result = manager.prunePartitions('ai_requests', query);

  return {
    withPruning: result,
    withoutPruning: { partitionsScanned: partitions.length },
  };
}
