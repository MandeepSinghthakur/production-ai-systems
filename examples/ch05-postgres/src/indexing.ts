// Index selection strategies for Postgres.
//
// The key insight: the right index depends on the query pattern, not
// the data. B-tree for equality and range, GIN for JSONB containment
// and full-text, partial indexes for hot paths, covering indexes to
// avoid heap fetches. Choosing wrong is worse than no index at all.
//
// This simulates index selection and query planning.

import type { IndexDefinition, IndexType, QueryPlan } from './types.ts';

/**
 * Query conditions for planning.
 */
export interface QueryCondition {
  column: string;
  operator: '=' | '>' | '<' | '>=' | '<=' | 'LIKE' | '@>' | '@@' | 'IN';
  value: unknown;
}

/**
 * A simulated query for planning.
 */
export interface Query {
  table: string;
  conditions: QueryCondition[];
  selectColumns: string[];
  orderBy?: string;
  limit?: number;
}

/**
 * Table statistics for cost estimation.
 */
export interface TableStats {
  rowCount: number;
  avgRowSizeBytes: number;
  distinctValues: Record<string, number>;
}

/**
 * Index advisor that recommends indexes based on query patterns.
 */
export class IndexAdvisor {
  private indexes: Map<string, IndexDefinition[]>;
  private tableStats: Map<string, TableStats>;

  constructor() {
    this.indexes = new Map();
    this.tableStats = new Map();
  }

  /**
   * Register indexes for a table.
   */
  registerIndexes(table: string, indexes: IndexDefinition[]): void {
    this.indexes.set(table, indexes);
  }

  /**
   * Register statistics for a table.
   */
  registerStats(table: string, stats: TableStats): void {
    this.tableStats.set(table, stats);
  }

  /**
   * Plan a query and select the best index.
   */
  planQuery(query: Query): QueryPlan {
    const indexes = this.indexes.get(query.table) ?? [];
    const stats = this.tableStats.get(query.table) ?? {
      rowCount: 100000,
      avgRowSizeBytes: 200,
      distinctValues: {},
    };

    // Find matching indexes
    const candidates = this.findCandidateIndexes(query, indexes);

    if (candidates.length === 0) {
      // No matching index, sequential scan
      return {
        indexUsed: null,
        estimatedRows: stats.rowCount,
        estimatedCost: stats.rowCount * stats.avgRowSizeBytes,
        scanType: 'seq_scan',
        explanation: 'No matching index found; performing sequential scan',
      };
    }

    // Score each candidate and pick the best
    let bestCandidate = candidates[0];
    let bestScore = this.scoreIndex(bestCandidate, query, stats);

    for (let i = 1; i < candidates.length; i++) {
      const score = this.scoreIndex(candidates[i], query, stats);
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidates[i];
      }
    }

    // Determine scan type
    const scanType = this.determineScanType(bestCandidate, query);

    // Estimate selectivity
    const selectivity = this.estimateSelectivity(query, stats);
    const estimatedRows = Math.max(1, Math.floor(stats.rowCount * selectivity));

    return {
      indexUsed: bestCandidate,
      estimatedRows,
      estimatedCost: bestScore,
      scanType,
      explanation: this.explainPlan(bestCandidate, query, scanType),
    };
  }

  /**
   * Find indexes that could potentially satisfy the query.
   */
  private findCandidateIndexes(
    query: Query,
    indexes: IndexDefinition[]
  ): IndexDefinition[] {
    const conditionColumns = new Set(query.conditions.map((c) => c.column));

    return indexes.filter((idx) => {
      // Check if leading column matches a condition
      if (conditionColumns.has(idx.columns[0])) {
        // Check if partial index predicate is satisfied
        if (idx.isPartial && idx.predicate) {
          return this.predicateSatisfied(idx.predicate, query);
        }
        return true;
      }
      return false;
    });
  }

  /**
   * Check if a partial index predicate is satisfied by the query.
   */
  private predicateSatisfied(predicate: string, query: Query): boolean {
    // Simple simulation: check if predicate column is in conditions
    // Real Postgres does much more sophisticated analysis
    for (const cond of query.conditions) {
      if (predicate.includes(cond.column)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Score an index (lower is better).
   */
  private scoreIndex(
    index: IndexDefinition,
    query: Query,
    stats: TableStats
  ): number {
    let score = 0;

    // Base cost: random I/O for each estimated row
    const selectivity = this.estimateSelectivity(query, stats);
    const estimatedRows = stats.rowCount * selectivity;
    score += estimatedRows * 4; // 4 = random I/O cost factor

    // Penalty for not using all index columns
    const usedColumns = query.conditions.filter((c) =>
      index.columns.includes(c.column)
    ).length;
    const unusedColumns = index.columns.length - usedColumns;
    score += unusedColumns * 100;

    // Bonus for covering index (no heap fetch needed)
    const selectSet = new Set(query.selectColumns);
    const indexCovers = query.selectColumns.every(
      (col) =>
        index.columns.includes(col) ||
        (index.includeColumns?.includes(col) ?? false)
    );
    if (indexCovers) {
      score *= 0.5; // 50% reduction for index-only scan
    }

    // Bonus for partial index (smaller index = faster scan)
    if (index.isPartial) {
      score *= 0.7; // 30% reduction
    }

    // Penalty for wrong index type for the operator
    const penalty = this.indexTypePenalty(index, query);
    score += penalty;

    return score;
  }

  /**
   * Penalty for using wrong index type.
   */
  private indexTypePenalty(index: IndexDefinition, query: Query): number {
    let penalty = 0;

    for (const cond of query.conditions) {
      if (!index.columns.includes(cond.column)) continue;

      switch (cond.operator) {
        case '@>': // JSONB containment
          if (index.type !== 'gin') penalty += 10000;
          break;
        case '@@': // Full-text search
          if (index.type !== 'gin' && index.type !== 'gist') penalty += 10000;
          break;
        case 'LIKE':
          // B-tree only works for prefix LIKE
          if (
            index.type !== 'btree' ||
            typeof cond.value !== 'string' ||
            cond.value.startsWith('%')
          ) {
            penalty += 5000;
          }
          break;
        case '>':
        case '<':
        case '>=':
        case '<=':
          // Range queries work best with B-tree or BRIN
          if (index.type === 'hash') penalty += 10000;
          break;
      }
    }

    return penalty;
  }

  /**
   * Estimate query selectivity (fraction of rows returned).
   */
  private estimateSelectivity(query: Query, stats: TableStats): number {
    let selectivity = 1.0;

    for (const cond of query.conditions) {
      const distinctCount = stats.distinctValues[cond.column] ?? 100;

      switch (cond.operator) {
        case '=':
          // Equality: 1/distinct values
          selectivity *= 1 / distinctCount;
          break;
        case '>':
        case '<':
        case '>=':
        case '<=':
          // Range: assume 33% of data
          selectivity *= 0.33;
          break;
        case 'IN':
          // IN: count / distinct
          const inCount = Array.isArray(cond.value) ? cond.value.length : 1;
          selectivity *= inCount / distinctCount;
          break;
        case '@>':
        case '@@':
          // JSONB/FTS: assume 1%
          selectivity *= 0.01;
          break;
        case 'LIKE':
          // LIKE: depends on pattern
          if (
            typeof cond.value === 'string' &&
            !cond.value.startsWith('%')
          ) {
            selectivity *= 0.1; // Prefix match
          } else {
            selectivity *= 0.5; // Full scan
          }
          break;
      }
    }

    return Math.max(0.0001, Math.min(1.0, selectivity));
  }

  /**
   * Determine the scan type based on index and query.
   */
  private determineScanType(
    index: IndexDefinition,
    query: Query
  ): 'index_scan' | 'index_only_scan' | 'bitmap_scan' {
    // Check if all selected columns are in the index
    const indexColumns = new Set([
      ...index.columns,
      ...(index.includeColumns ?? []),
    ]);
    const allCovered = query.selectColumns.every((col) =>
      indexColumns.has(col)
    );

    if (allCovered) {
      return 'index_only_scan';
    }

    // If we expect many rows, bitmap scan may be better
    // (simulated: if no LIMIT or LIMIT > 100)
    if (!query.limit || query.limit > 100) {
      return 'bitmap_scan';
    }

    return 'index_scan';
  }

  /**
   * Generate explanation text.
   */
  private explainPlan(
    index: IndexDefinition,
    query: Query,
    scanType: string
  ): string {
    const parts: string[] = [];

    parts.push(`Using ${index.type.toUpperCase()} index "${index.name}"`);
    parts.push(`on columns (${index.columns.join(', ')})`);

    if (index.isPartial) {
      parts.push(`(partial: ${index.predicate})`);
    }

    parts.push(`via ${scanType.replace('_', ' ')}`);

    if (scanType === 'index_only_scan') {
      parts.push('(no heap fetch needed)');
    }

    return parts.join(' ');
  }

  /**
   * Recommend indexes for a set of queries.
   */
  recommendIndexes(
    table: string,
    queries: Query[],
    existingIndexes: IndexDefinition[]
  ): IndexDefinition[] {
    const recommendations: IndexDefinition[] = [];
    const existingCols = new Set(
      existingIndexes.flatMap((idx) => idx.columns.join(','))
    );

    // Analyze query patterns
    const columnUsage = new Map<string, number>();
    const operatorUsage = new Map<string, Set<string>>();

    for (const query of queries) {
      for (const cond of query.conditions) {
        columnUsage.set(cond.column, (columnUsage.get(cond.column) ?? 0) + 1);
        const ops = operatorUsage.get(cond.column) ?? new Set();
        ops.add(cond.operator);
        operatorUsage.set(cond.column, ops);
      }
    }

    // Sort columns by usage
    const sortedColumns = Array.from(columnUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([col]) => col);

    // Recommend indexes for frequently used columns
    for (const column of sortedColumns) {
      if (existingCols.has(column)) continue;

      const ops = operatorUsage.get(column) ?? new Set();
      let indexType: IndexType = 'btree';

      // Choose index type based on operators
      if (ops.has('@>')) {
        indexType = 'gin';
      } else if (ops.has('@@')) {
        indexType = 'gin';
      } else if (ops.has('=') && !ops.has('>') && !ops.has('<')) {
        // Equality only - hash could work but B-tree is safer
        indexType = 'btree';
      }

      recommendations.push({
        name: `idx_${table}_${column}`,
        table,
        columns: [column],
        type: indexType,
        isPartial: false,
      });
    }

    return recommendations;
  }
}

/**
 * Demonstrate why wrong index type hurts.
 */
export function demonstrateIndexTypeMismatch(): {
  correct: QueryPlan;
  wrong: QueryPlan;
} {
  const advisor = new IndexAdvisor();

  // Table with JSONB data
  advisor.registerStats('documents', {
    rowCount: 1000000,
    avgRowSizeBytes: 500,
    distinctValues: {
      tenant_id: 100,
      doc_type: 20,
    },
  });

  // Correct: GIN index for JSONB containment
  const ginIndex: IndexDefinition = {
    name: 'idx_documents_data_gin',
    table: 'documents',
    columns: ['data'],
    type: 'gin',
    isPartial: false,
  };

  // Wrong: B-tree index for JSONB (doesn't support @>)
  const btreeIndex: IndexDefinition = {
    name: 'idx_documents_data_btree',
    table: 'documents',
    columns: ['data'],
    type: 'btree',
    isPartial: false,
  };

  // Query using JSONB containment
  const jsonbQuery: Query = {
    table: 'documents',
    conditions: [{ column: 'data', operator: '@>', value: { type: 'invoice' } }],
    selectColumns: ['id', 'data'],
  };

  // Plan with correct index
  advisor.registerIndexes('documents', [ginIndex]);
  const correct = advisor.planQuery(jsonbQuery);

  // Plan with wrong index
  advisor.registerIndexes('documents', [btreeIndex]);
  const wrong = advisor.planQuery(jsonbQuery);

  return { correct, wrong };
}

/**
 * Demonstrate partial index benefits.
 */
export function demonstratePartialIndex(): {
  withPartial: QueryPlan;
  withFull: QueryPlan;
} {
  const advisor = new IndexAdvisor();

  advisor.registerStats('requests', {
    rowCount: 10000000, // 10M requests
    avgRowSizeBytes: 300,
    distinctValues: {
      status: 5, // pending, processing, completed, failed, cancelled
      tenant_id: 1000,
    },
  });

  // Partial index on pending requests only (small subset)
  const partialIndex: IndexDefinition = {
    name: 'idx_requests_pending',
    table: 'requests',
    columns: ['tenant_id'],
    type: 'btree',
    isPartial: true,
    predicate: "status = 'pending'",
  };

  // Full index on all requests
  const fullIndex: IndexDefinition = {
    name: 'idx_requests_tenant',
    table: 'requests',
    columns: ['tenant_id'],
    type: 'btree',
    isPartial: false,
  };

  // Query: find pending requests for a tenant
  const query: Query = {
    table: 'requests',
    conditions: [
      { column: 'tenant_id', operator: '=', value: 'tenant_123' },
      { column: 'status', operator: '=', value: 'pending' },
    ],
    selectColumns: ['id', 'created_at'],
  };

  // Plan with partial index
  advisor.registerIndexes('requests', [partialIndex]);
  const withPartial = advisor.planQuery(query);

  // Plan with full index
  advisor.registerIndexes('requests', [fullIndex]);
  const withFull = advisor.planQuery(query);

  return { withPartial, withFull };
}
