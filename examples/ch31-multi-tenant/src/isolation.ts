// Data isolation for multi-tenant AI platform.
// Ensures tenant data is separated and access controls are enforced.

import type { IsolationVerification, TenantConfig } from './types.ts';

/**
 * Represents a piece of tenant data.
 */
interface TenantData {
  id: string;
  tenantId: string;
  dataType: 'conversation' | 'document' | 'embedding' | 'config';
  content: string;
  createdAt: number;
}

/**
 * DataStore provides tenant-isolated data storage.
 *
 * The key isolation principle: every data operation takes a tenantId
 * parameter, and the store never returns data from a different tenant.
 * The tenantId is not trusted from the request - it comes from the
 * authenticated context.
 */
export class IsolatedDataStore {
  private data: Map<string, TenantData>;
  private tenantIndex: Map<string, Set<string>>;
  private accessLog: Array<{
    timestamp: number;
    tenantId: string;
    operation: string;
    dataId: string | null;
    allowed: boolean;
  }>;

  constructor() {
    this.data = new Map();
    this.tenantIndex = new Map();
    this.accessLog = [];
  }

  /**
   * Store data for a tenant.
   */
  store(
    tenantId: string,
    dataType: TenantData['dataType'],
    content: string
  ): TenantData {
    const id = this.generateDataId();

    const data: TenantData = {
      id,
      tenantId,
      dataType,
      content,
      createdAt: Date.now(),
    };

    this.data.set(id, data);

    // Update tenant index
    if (!this.tenantIndex.has(tenantId)) {
      this.tenantIndex.set(tenantId, new Set());
    }
    this.tenantIndex.get(tenantId)!.add(id);

    this.logAccess(tenantId, 'store', id, true);
    return data;
  }

  /**
   * Retrieve data by ID, with tenant verification.
   * Returns null if data doesn't exist or belongs to different tenant.
   */
  retrieve(tenantId: string, dataId: string): TenantData | null {
    const data = this.data.get(dataId);

    if (!data) {
      this.logAccess(tenantId, 'retrieve', dataId, false);
      return null;
    }

    // Critical isolation check: verify tenant ownership
    if (data.tenantId !== tenantId) {
      this.logAccess(tenantId, 'retrieve', dataId, false);
      // Do not reveal that the data exists but belongs to another tenant
      return null;
    }

    this.logAccess(tenantId, 'retrieve', dataId, true);
    return data;
  }

  /**
   * List all data for a tenant.
   * Never returns data from other tenants.
   */
  listByTenant(tenantId: string): TenantData[] {
    const ids = this.tenantIndex.get(tenantId);
    if (!ids) {
      this.logAccess(tenantId, 'list', null, true);
      return [];
    }

    const result: TenantData[] = [];
    for (const id of ids) {
      const data = this.data.get(id);
      // Double-check tenant ownership (defense in depth)
      if (data && data.tenantId === tenantId) {
        result.push(data);
      }
    }

    this.logAccess(tenantId, 'list', null, true);
    return result;
  }

  /**
   * Delete data, with tenant verification.
   * Returns false if data doesn't exist or belongs to different tenant.
   */
  delete(tenantId: string, dataId: string): boolean {
    const data = this.data.get(dataId);

    if (!data) {
      this.logAccess(tenantId, 'delete', dataId, false);
      return false;
    }

    // Critical isolation check
    if (data.tenantId !== tenantId) {
      this.logAccess(tenantId, 'delete', dataId, false);
      return false;
    }

    this.data.delete(dataId);
    this.tenantIndex.get(tenantId)?.delete(dataId);
    this.logAccess(tenantId, 'delete', dataId, true);
    return true;
  }

  /**
   * Verify isolation between two tenants.
   * Used for testing and compliance audits.
   */
  verifyIsolation(tenantA: string, tenantB: string): IsolationVerification[] {
    const results: IsolationVerification[] = [];

    // Test 1: Tenant A cannot access Tenant B's data
    const tenantBData = Array.from(this.tenantIndex.get(tenantB) || []);
    for (const dataId of tenantBData) {
      const result = this.retrieve(tenantA, dataId);
      results.push({
        tenantA,
        tenantB,
        testType: 'data_access',
        isolated: result === null,
        details: result === null
          ? `Tenant ${tenantA} correctly denied access to ${dataId}`
          : `BREACH: Tenant ${tenantA} accessed ${tenantB}'s data ${dataId}`,
      });
    }

    // Test 2: Tenant B cannot access Tenant A's data
    const tenantAData = Array.from(this.tenantIndex.get(tenantA) || []);
    for (const dataId of tenantAData) {
      const result = this.retrieve(tenantB, dataId);
      results.push({
        tenantA: tenantB,
        tenantB: tenantA,
        testType: 'data_access',
        isolated: result === null,
        details: result === null
          ? `Tenant ${tenantB} correctly denied access to ${dataId}`
          : `BREACH: Tenant ${tenantB} accessed ${tenantA}'s data ${dataId}`,
      });
    }

    return results;
  }

  /**
   * Get access log for auditing.
   */
  getAccessLog(tenantId?: string): typeof this.accessLog {
    if (tenantId) {
      return this.accessLog.filter((l) => l.tenantId === tenantId);
    }
    return [...this.accessLog];
  }

  /**
   * Get total storage used by a tenant (bytes).
   */
  getStorageUsed(tenantId: string): number {
    const data = this.listByTenant(tenantId);
    return data.reduce((sum, d) => sum + d.content.length, 0);
  }

  /**
   * Clear all data for a tenant (offboarding).
   */
  clearTenantData(tenantId: string): number {
    const ids = this.tenantIndex.get(tenantId);
    if (!ids) return 0;

    let deleted = 0;
    for (const id of ids) {
      this.data.delete(id);
      deleted++;
    }
    this.tenantIndex.delete(tenantId);

    this.logAccess(tenantId, 'clear_all', null, true);
    return deleted;
  }

  /**
   * Get data count by tenant.
   */
  getCountByTenant(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [tenantId, ids] of this.tenantIndex) {
      counts.set(tenantId, ids.size);
    }
    return counts;
  }

  private generateDataId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `data_${timestamp}_${random}`;
  }

  private logAccess(
    tenantId: string,
    operation: string,
    dataId: string | null,
    allowed: boolean
  ): void {
    this.accessLog.push({
      timestamp: Date.now(),
      tenantId,
      operation,
      dataId,
      allowed,
    });
  }

  /**
   * Clear all data (for testing).
   */
  clear(): void {
    this.data.clear();
    this.tenantIndex.clear();
    this.accessLog = [];
  }
}

/**
 * RequestRouter ensures requests are routed only to tenant's own resources.
 * This simulates the routing layer that directs requests to the correct
 * tenant-specific compute and data resources.
 */
export class RequestRouter {
  private routingTable: Map<string, { endpoint: string; weight: number }>;
  private routingLog: Array<{
    timestamp: number;
    requestId: string;
    tenantId: string;
    routedTo: string;
    correct: boolean;
  }>;

  constructor() {
    this.routingTable = new Map();
    this.routingLog = [];
  }

  /**
   * Register an endpoint for a tenant.
   */
  registerEndpoint(tenantId: string, endpoint: string, weight = 1): void {
    this.routingTable.set(tenantId, { endpoint, weight });
  }

  /**
   * Route a request to the correct tenant endpoint.
   */
  route(
    requestId: string,
    tenantId: string
  ): { endpoint: string; weight: number } | null {
    const entry = this.routingTable.get(tenantId);

    if (!entry) {
      this.routingLog.push({
        timestamp: Date.now(),
        requestId,
        tenantId,
        routedTo: 'NONE',
        correct: false,
      });
      return null;
    }

    this.routingLog.push({
      timestamp: Date.now(),
      requestId,
      tenantId,
      routedTo: entry.endpoint,
      correct: true,
    });

    return entry;
  }

  /**
   * Verify that a request is routed correctly (not to another tenant).
   */
  verifyRouting(
    tenantA: string,
    tenantB: string
  ): IsolationVerification {
    const endpointA = this.routingTable.get(tenantA);
    const endpointB = this.routingTable.get(tenantB);

    const isolated = !endpointA ||
      !endpointB ||
      endpointA.endpoint !== endpointB.endpoint;

    return {
      tenantA,
      tenantB,
      testType: 'request_routing',
      isolated,
      details: isolated
        ? `Tenants have separate routing: ${endpointA?.endpoint} vs ${endpointB?.endpoint}`
        : `WARNING: Tenants share endpoint: ${endpointA?.endpoint}`,
    };
  }

  /**
   * Get routing log for auditing.
   */
  getRoutingLog(tenantId?: string): typeof this.routingLog {
    if (tenantId) {
      return this.routingLog.filter((l) => l.tenantId === tenantId);
    }
    return [...this.routingLog];
  }

  /**
   * Clear routing table and log (for testing).
   */
  clear(): void {
    this.routingTable.clear();
    this.routingLog = [];
  }
}
