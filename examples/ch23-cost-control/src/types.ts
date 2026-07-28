// Core types for cost control and capacity planning.
// See Chapter 23, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices in code
 * because they rot within a quarter. See CLAUDE.md rules.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Cost multiplier per token by tier. These are relative values,
 * not actual prices. Frontier is the baseline at 1.0.
 */
export const TIER_COST_MULTIPLIER: Record<ModelTier, number> = {
  frontier: 1.0,
  mid: 0.1,
  small: 0.01,
};

/**
 * Budget cap types:
 * - hard: Reject requests when budget exhausted
 * - soft: Allow requests but flag for alerting
 */
export type CapType = 'hard' | 'soft';

/**
 * Tenant budget configuration.
 */
export interface TenantConfig {
  id: string;
  tokenLimit: number;
  capType: CapType;
}

/**
 * Internal account state for a tenant.
 */
export interface Account {
  config: TenantConfig;
  spentTokens: number;
  reservedTokens: number;
  overBudget: boolean;
  costUnits: number; // Weighted cost (tokens * tier multiplier)
}

/**
 * A request to be processed.
 */
export interface Request {
  id: string;
  tenant: string;
  workload: string;
  tier: ModelTier;
  estimatedTokens: number;
  actualTokens: number;
}

/**
 * Result of a budget reservation attempt.
 */
export interface ReservationResult {
  granted: boolean;
  reservationId: string | null;
  reservedTokens: number;
  reason?: string;
}

/**
 * Result of settling a reservation.
 */
export interface SettlementResult {
  releasedTokens: number;
  actualTokens: number;
  costUnits: number;
}

/**
 * Spending record for attribution.
 */
export interface SpendingRecord {
  timestamp: number;
  tenant: string;
  workload: string;
  tier: ModelTier;
  tokens: number;
  costUnits: number;
}

/**
 * Forecast result for budget exhaustion.
 */
export interface BudgetForecast {
  tenant: string;
  currentSpent: number;
  tokenLimit: number;
  burnRatePerSecond: number;
  remainingTokens: number;
  exhaustionTimestamp: number | null; // null if never (no burn rate)
  secondsUntilExhaustion: number | null;
  isUrgent: boolean; // True if exhaustion within threshold
}

/**
 * Aggregated attribution by dimension.
 */
export interface Attribution {
  byTenant: Record<string, { tokens: number; costUnits: number }>;
  byWorkload: Record<string, { tokens: number; costUnits: number }>;
  byTier: Record<ModelTier, { tokens: number; costUnits: number }>;
}
