// Core types for multi-tenant AI platform design.
// See Chapter 31, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Tenant isolation levels.
 * - shared: Shared compute, logical data separation
 * - dedicated: Dedicated compute, shared infrastructure
 * - isolated: Fully isolated infrastructure
 */
export type IsolationLevel = 'shared' | 'dedicated' | 'isolated';

/**
 * Tenant status in the platform.
 */
export type TenantStatus = 'active' | 'suspended' | 'pending' | 'offboarding';

/**
 * Tenant configuration.
 */
export interface TenantConfig {
  id: string;
  name: string;
  isolationLevel: IsolationLevel;
  status: TenantStatus;
  createdAt: number;

  // Resource quotas
  quotas: TenantQuotas;

  // Customization
  customization: TenantCustomization;
}

/**
 * Tenant resource quotas.
 */
export interface TenantQuotas {
  // Token budgets per period
  tokensPerDay: number;
  tokensPerMonth: number;

  // Rate limits
  requestsPerSecond: number;
  requestsPerMinute: number;

  // Concurrency limits
  maxConcurrentRequests: number;

  // Storage limits (bytes)
  maxStorageBytes: number;
}

/**
 * Tenant-specific customization options.
 */
export interface TenantCustomization {
  // Allowed model tiers
  allowedTiers: ModelTier[];

  // Default model tier
  defaultTier: ModelTier;

  // Custom system prompt prefix
  systemPromptPrefix: string | null;

  // Allowed tools (null means all)
  allowedTools: string[] | null;

  // Data residency region
  dataResidency: string;

  // Retention period in days
  retentionDays: number;
}

/**
 * Default quotas for new tenants.
 */
export const DEFAULT_QUOTAS: TenantQuotas = {
  tokensPerDay: 100_000,
  tokensPerMonth: 2_000_000,
  requestsPerSecond: 10,
  requestsPerMinute: 100,
  maxConcurrentRequests: 20,
  maxStorageBytes: 1024 * 1024 * 100, // 100 MB
};

/**
 * Default customization for new tenants.
 */
export const DEFAULT_CUSTOMIZATION: TenantCustomization = {
  allowedTiers: ['mid', 'small'],
  defaultTier: 'mid',
  systemPromptPrefix: null,
  allowedTools: null,
  dataResidency: 'us',
  retentionDays: 90,
};

/**
 * Request from a tenant.
 */
export interface TenantRequest {
  id: string;
  tenantId: string;
  timestamp: number;
  tier: ModelTier;
  estimatedTokens: number;
  actualTokens: number | null;
  status: 'pending' | 'processing' | 'completed' | 'rejected' | 'failed';
  rejectionReason: string | null;
}

/**
 * Usage record for metering.
 */
export interface UsageRecord {
  id: string;
  tenantId: string;
  timestamp: number;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  requestId: string;
}

/**
 * Aggregated usage summary.
 */
export interface UsageSummary {
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  totalTokens: number;
  tokensByTier: Record<ModelTier, number>;
  totalRequests: number;
  totalDurationMs: number;
  peakConcurrency: number;
}

/**
 * Rate limit window state.
 */
export interface RateLimitWindow {
  tenantId: string;
  windowStart: number;
  windowEnd: number;
  requestCount: number;
  tokenCount: number;
}

/**
 * Noisy neighbor detection state.
 */
export interface NoisyNeighborState {
  tenantId: string;
  windowStart: number;
  resourceScore: number; // 0-100, higher = more resource consumption
  isThrottled: boolean;
  throttleUntil: number | null;
}

/**
 * Data isolation verification result.
 */
export interface IsolationVerification {
  tenantA: string;
  tenantB: string;
  testType: 'data_access' | 'request_routing' | 'storage_access';
  isolated: boolean;
  details: string;
}

/**
 * Billing line item.
 */
export interface BillingLineItem {
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  tier: ModelTier;
  tokens: number;
  costUnits: number;
  description: string;
}

/**
 * Cost multiplier per tier. Relative values, not actual prices.
 */
export const TIER_COST_MULTIPLIER: Record<ModelTier, number> = {
  frontier: 1.0,
  mid: 0.1,
  small: 0.01,
};
