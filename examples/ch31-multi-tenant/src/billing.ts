// Billing and cost attribution for multi-tenant AI platform.
// Generates invoices and tracks spending by tenant.

import type {
  BillingLineItem,
  ModelTier,
  TenantConfig,
  UsageSummary,
  TIER_COST_MULTIPLIER,
} from './types.ts';

/**
 * Invoice for a billing period.
 */
export interface Invoice {
  id: string;
  tenantId: string;
  tenantName: string;
  periodStart: number;
  periodEnd: number;
  createdAt: number;
  lineItems: BillingLineItem[];
  subtotal: number;
  adjustments: Array<{ description: string; amount: number }>;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
}

/**
 * Generates a unique invoice ID.
 */
function generateInvoiceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `inv_${timestamp}_${random}`;
}

/**
 * BillingEngine generates invoices and tracks tenant spending.
 *
 * In production this would integrate with:
 * - Payment processors (Stripe, etc.)
 * - Accounting systems
 * - Tax calculation services
 */
export class BillingEngine {
  private invoices: Map<string, Invoice>;
  private invoicesByTenant: Map<string, Invoice[]>;
  private tierCosts: Record<ModelTier, number>;
  private tierDescriptions: Record<ModelTier, string>;

  constructor(tierCosts: Record<ModelTier, number>) {
    this.invoices = new Map();
    this.invoicesByTenant = new Map();
    this.tierCosts = tierCosts;
    this.tierDescriptions = {
      frontier: 'Frontier model usage',
      mid: 'Mid-tier model usage',
      small: 'Small model usage',
    };
  }

  /**
   * Generate an invoice from a usage summary.
   */
  generateInvoice(
    tenant: TenantConfig,
    summary: UsageSummary
  ): Invoice {
    const lineItems: BillingLineItem[] = [];

    // Create line item for each tier with usage
    for (const tier of ['frontier', 'mid', 'small'] as ModelTier[]) {
      const tokens = summary.tokensByTier[tier];
      if (tokens > 0) {
        lineItems.push({
          tenantId: tenant.id,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
          tier,
          tokens,
          costUnits: tokens * this.tierCosts[tier],
          description: `${this.tierDescriptions[tier]} - ${tokens.toLocaleString()} tokens`,
        });
      }
    }

    const subtotal = lineItems.reduce((sum, item) => sum + item.costUnits, 0);

    const invoice: Invoice = {
      id: generateInvoiceId(),
      tenantId: tenant.id,
      tenantName: tenant.name,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      createdAt: Date.now(),
      lineItems,
      subtotal,
      adjustments: [],
      total: subtotal,
      status: 'draft',
    };

    this.invoices.set(invoice.id, invoice);

    // Index by tenant
    if (!this.invoicesByTenant.has(tenant.id)) {
      this.invoicesByTenant.set(tenant.id, []);
    }
    this.invoicesByTenant.get(tenant.id)!.push(invoice);

    return invoice;
  }

  /**
   * Apply an adjustment to an invoice (credit, discount, etc.).
   */
  applyAdjustment(
    invoiceId: string,
    description: string,
    amount: number
  ): Invoice | undefined {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) return undefined;
    if (invoice.status !== 'draft') {
      // Only draft invoices can be adjusted
      return undefined;
    }

    invoice.adjustments.push({ description, amount });
    invoice.total = invoice.subtotal +
      invoice.adjustments.reduce((sum, a) => sum + a.amount, 0);

    return invoice;
  }

  /**
   * Finalize and send an invoice.
   */
  sendInvoice(invoiceId: string): Invoice | undefined {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'draft') return undefined;

    invoice.status = 'sent';
    return invoice;
  }

  /**
   * Mark an invoice as paid.
   */
  markPaid(invoiceId: string): Invoice | undefined {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'sent') return undefined;

    invoice.status = 'paid';
    return invoice;
  }

  /**
   * Get an invoice by ID.
   */
  getInvoice(invoiceId: string): Invoice | undefined {
    return this.invoices.get(invoiceId);
  }

  /**
   * Get all invoices for a tenant.
   */
  getInvoicesByTenant(tenantId: string): Invoice[] {
    return this.invoicesByTenant.get(tenantId) ?? [];
  }

  /**
   * Get total spending for a tenant across all invoices.
   */
  getTotalSpending(tenantId: string): number {
    const invoices = this.invoicesByTenant.get(tenantId) ?? [];
    return invoices.reduce((sum, inv) => sum + inv.total, 0);
  }

  /**
   * Get unpaid invoices for a tenant.
   */
  getUnpaidInvoices(tenantId: string): Invoice[] {
    const invoices = this.invoicesByTenant.get(tenantId) ?? [];
    return invoices.filter((inv) =>
      inv.status === 'sent' || inv.status === 'overdue'
    );
  }

  /**
   * Get spending breakdown by tier for a tenant.
   */
  getSpendingByTier(tenantId: string): Record<ModelTier, number> {
    const invoices = this.invoicesByTenant.get(tenantId) ?? [];
    const breakdown: Record<ModelTier, number> = {
      frontier: 0,
      mid: 0,
      small: 0,
    };

    for (const invoice of invoices) {
      for (const item of invoice.lineItems) {
        breakdown[item.tier] += item.costUnits;
      }
    }

    return breakdown;
  }

  /**
   * Calculate estimated monthly cost based on current usage rate.
   */
  estimateMonthlySpend(
    dailyTokensByTier: Record<ModelTier, number>,
    daysInMonth = 30
  ): number {
    let estimate = 0;
    for (const tier of ['frontier', 'mid', 'small'] as ModelTier[]) {
      estimate += dailyTokensByTier[tier] * this.tierCosts[tier] * daysInMonth;
    }
    return estimate;
  }

  /**
   * Get all invoices.
   */
  getAllInvoices(): Invoice[] {
    return Array.from(this.invoices.values());
  }

  /**
   * Get revenue by period.
   */
  getRevenueByPeriod(
    periodStart: number,
    periodEnd: number
  ): { total: number; byTenant: Map<string, number> } {
    const result = {
      total: 0,
      byTenant: new Map<string, number>(),
    };

    for (const invoice of this.invoices.values()) {
      if (
        invoice.periodStart >= periodStart &&
        invoice.periodEnd <= periodEnd &&
        invoice.status === 'paid'
      ) {
        result.total += invoice.total;
        const current = result.byTenant.get(invoice.tenantId) ?? 0;
        result.byTenant.set(invoice.tenantId, current + invoice.total);
      }
    }

    return result;
  }

  /**
   * Clear all data (for testing).
   */
  clear(): void {
    this.invoices.clear();
    this.invoicesByTenant.clear();
  }
}

/**
 * CostAllocator tracks spending by dimension for analytics.
 * Unlike BillingEngine which focuses on invoicing, CostAllocator
 * provides real-time spending visibility.
 */
export class CostAllocator {
  private spendingRecords: Array<{
    timestamp: number;
    tenantId: string;
    tier: ModelTier;
    tokens: number;
    costUnits: number;
  }>;
  private tierCosts: Record<ModelTier, number>;

  constructor(tierCosts: Record<ModelTier, number>) {
    this.spendingRecords = [];
    this.tierCosts = tierCosts;
  }

  /**
   * Record spending for a request.
   */
  recordSpending(
    tenantId: string,
    tier: ModelTier,
    tokens: number
  ): void {
    this.spendingRecords.push({
      timestamp: Date.now(),
      tenantId,
      tier,
      tokens,
      costUnits: tokens * this.tierCosts[tier],
    });
  }

  /**
   * Get total spending in a time window.
   */
  getTotalSpending(
    startTime?: number,
    endTime?: number
  ): number {
    let total = 0;
    for (const record of this.spendingRecords) {
      if (startTime && record.timestamp < startTime) continue;
      if (endTime && record.timestamp > endTime) continue;
      total += record.costUnits;
    }
    return total;
  }

  /**
   * Get spending by tenant in a time window.
   */
  getSpendingByTenant(
    startTime?: number,
    endTime?: number
  ): Map<string, number> {
    const byTenant = new Map<string, number>();

    for (const record of this.spendingRecords) {
      if (startTime && record.timestamp < startTime) continue;
      if (endTime && record.timestamp > endTime) continue;

      const current = byTenant.get(record.tenantId) ?? 0;
      byTenant.set(record.tenantId, current + record.costUnits);
    }

    return byTenant;
  }

  /**
   * Get top spenders in a time window.
   */
  getTopSpenders(
    limit: number,
    startTime?: number,
    endTime?: number
  ): Array<{ tenantId: string; costUnits: number }> {
    const byTenant = this.getSpendingByTenant(startTime, endTime);
    const sorted = Array.from(byTenant.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([tenantId, costUnits]) => ({ tenantId, costUnits }));
  }

  /**
   * Get burn rate (cost units per second) for a tenant.
   */
  getBurnRate(tenantId: string, windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    let total = 0;

    for (const record of this.spendingRecords) {
      if (record.tenantId === tenantId && record.timestamp >= cutoff) {
        total += record.costUnits;
      }
    }

    return total / (windowMs / 1000);
  }

  /**
   * Get record count.
   */
  getRecordCount(): number {
    return this.spendingRecords.length;
  }

  /**
   * Clear all data (for testing).
   */
  clear(): void {
    this.spendingRecords = [];
  }
}
