// Tenant management for multi-tenant AI platform.
// Handles tenant lifecycle, configuration, and status management.

import type {
  IsolationLevel,
  TenantConfig,
  TenantCustomization,
  TenantQuotas,
  TenantStatus,
  DEFAULT_QUOTAS,
  DEFAULT_CUSTOMIZATION,
} from './types.ts';

/**
 * Generates a unique tenant ID.
 */
function generateTenantId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `tenant_${timestamp}_${random}`;
}

/**
 * TenantRegistry manages tenant configurations and lifecycle.
 *
 * In production this would be backed by:
 * - A database for persistent tenant configs
 * - A cache layer for hot-path tenant lookups
 * - An event system for config change propagation
 */
export class TenantRegistry {
  private tenants: Map<string, TenantConfig>;
  private defaultQuotas: TenantQuotas;
  private defaultCustomization: TenantCustomization;

  constructor(
    defaultQuotas: TenantQuotas,
    defaultCustomization: TenantCustomization
  ) {
    this.tenants = new Map();
    this.defaultQuotas = defaultQuotas;
    this.defaultCustomization = defaultCustomization;
  }

  /**
   * Create a new tenant.
   */
  createTenant(
    name: string,
    isolationLevel: IsolationLevel,
    quotas?: Partial<TenantQuotas>,
    customization?: Partial<TenantCustomization>
  ): TenantConfig {
    const id = generateTenantId();

    const config: TenantConfig = {
      id,
      name,
      isolationLevel,
      status: 'active',
      createdAt: Date.now(),
      quotas: { ...this.defaultQuotas, ...quotas },
      customization: { ...this.defaultCustomization, ...customization },
    };

    this.tenants.set(id, config);
    return config;
  }

  /**
   * Get a tenant by ID.
   */
  getTenant(id: string): TenantConfig | undefined {
    return this.tenants.get(id);
  }

  /**
   * Update tenant quotas.
   */
  updateQuotas(
    tenantId: string,
    quotas: Partial<TenantQuotas>
  ): TenantConfig | undefined {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return undefined;

    tenant.quotas = { ...tenant.quotas, ...quotas };
    return tenant;
  }

  /**
   * Update tenant customization.
   */
  updateCustomization(
    tenantId: string,
    customization: Partial<TenantCustomization>
  ): TenantConfig | undefined {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return undefined;

    tenant.customization = { ...tenant.customization, ...customization };
    return tenant;
  }

  /**
   * Update tenant status.
   */
  updateStatus(
    tenantId: string,
    status: TenantStatus
  ): TenantConfig | undefined {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return undefined;

    tenant.status = status;
    return tenant;
  }

  /**
   * Suspend a tenant. All requests will be rejected.
   */
  suspendTenant(tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    tenant.status = 'suspended';
    return true;
  }

  /**
   * Reactivate a suspended tenant.
   */
  reactivateTenant(tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant || tenant.status !== 'suspended') return false;

    tenant.status = 'active';
    return true;
  }

  /**
   * Check if a tenant is active and can process requests.
   */
  isActive(tenantId: string): boolean {
    const tenant = this.tenants.get(tenantId);
    return tenant?.status === 'active';
  }

  /**
   * Check if a model tier is allowed for a tenant.
   */
  isTierAllowed(tenantId: string, tier: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    return tenant.customization.allowedTiers.includes(tier as any);
  }

  /**
   * Check if a tool is allowed for a tenant.
   */
  isToolAllowed(tenantId: string, toolName: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    // null means all tools allowed
    if (tenant.customization.allowedTools === null) return true;

    return tenant.customization.allowedTools.includes(toolName);
  }

  /**
   * Get all tenants.
   */
  getAllTenants(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  /**
   * Get tenants by isolation level.
   */
  getTenantsByIsolation(level: IsolationLevel): TenantConfig[] {
    return Array.from(this.tenants.values()).filter(
      (t) => t.isolationLevel === level
    );
  }

  /**
   * Get tenants by status.
   */
  getTenantsByStatus(status: TenantStatus): TenantConfig[] {
    return Array.from(this.tenants.values()).filter(
      (t) => t.status === status
    );
  }

  /**
   * Delete a tenant (hard delete for testing).
   */
  deleteTenant(tenantId: string): boolean {
    return this.tenants.delete(tenantId);
  }

  /**
   * Get tenant count.
   */
  getTenantCount(): number {
    return this.tenants.size;
  }

  /**
   * Clear all tenants (for testing).
   */
  clear(): void {
    this.tenants.clear();
  }
}
