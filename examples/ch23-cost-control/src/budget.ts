// Token budget manager with reserve-then-reconcile pattern.
// Extends the ch18 budget.ts pattern with multi-tenant support,
// hard vs soft caps, and overshoot protection.
//
// The key insight: reserve pessimistically at admission, reconcile
// to actual on completion. Overshoot becomes bounded by in-flight
// concurrency times per-request maximum.

import type {
  Account,
  CapType,
  ModelTier,
  ReservationResult,
  SettlementResult,
  TenantConfig,
  TIER_COST_MULTIPLIER,
} from './types.ts';

interface Reservation {
  tenant: string;
  tokens: number;
  tier: ModelTier;
  timestamp: number;
}

export class BudgetManager {
  private accounts: Map<string, Account>;
  private reservations: Map<string, Reservation>;
  private reservationCounter: number;
  private tierCosts: Record<ModelTier, number>;

  constructor(tierCosts: Record<ModelTier, number>) {
    this.accounts = new Map();
    this.reservations = new Map();
    this.reservationCounter = 0;
    this.tierCosts = tierCosts;
  }

  /**
   * Register a tenant with their budget configuration.
   */
  registerTenant(config: TenantConfig): void {
    this.accounts.set(config.id, {
      config,
      spentTokens: 0,
      reservedTokens: 0,
      overBudget: false,
      costUnits: 0,
    });
  }

  /**
   * Reserve tokens for a request. Returns a reservation result.
   * For hard caps, returns granted=false if budget exhausted.
   * For soft caps, returns granted=true with overBudget flag set.
   */
  reserve(
    tenant: string,
    estimatedTokens: number,
    tier: ModelTier
  ): ReservationResult {
    const account = this.accounts.get(tenant);

    if (!account) {
      // Unknown tenant: fail open but log for alerting.
      // In production, this would trigger an alert.
      return {
        granted: true,
        reservationId: null,
        reservedTokens: 0,
        reason: 'unknown_tenant',
      };
    }

    const committed = account.spentTokens + account.reservedTokens;
    const wouldExceed = committed + estimatedTokens > account.config.tokenLimit;

    if (wouldExceed && account.config.capType === 'hard') {
      // Hard cap: reject the request
      return {
        granted: false,
        reservationId: null,
        reservedTokens: 0,
        reason: 'budget_exhausted',
      };
    }

    // Grant the reservation
    const reservationId = `res_${++this.reservationCounter}`;
    this.reservations.set(reservationId, {
      tenant,
      tokens: estimatedTokens,
      tier,
      timestamp: Date.now(),
    });

    account.reservedTokens += estimatedTokens;

    if (wouldExceed) {
      // Soft cap: allow but flag
      account.overBudget = true;
    }

    return {
      granted: true,
      reservationId,
      reservedTokens: estimatedTokens,
    };
  }

  /**
   * Settle a reservation with actual usage.
   * Releases the reserved amount and records actual spend.
   */
  settle(reservationId: string, actualTokens: number): SettlementResult {
    const reservation = this.reservations.get(reservationId);

    if (!reservation) {
      // Already settled or invalid reservation
      return {
        releasedTokens: 0,
        actualTokens: 0,
        costUnits: 0,
      };
    }

    const account = this.accounts.get(reservation.tenant);
    if (!account) {
      this.reservations.delete(reservationId);
      return {
        releasedTokens: reservation.tokens,
        actualTokens: 0,
        costUnits: 0,
      };
    }

    // Release reservation and record actual
    account.reservedTokens = Math.max(
      0,
      account.reservedTokens - reservation.tokens
    );
    account.spentTokens += actualTokens;

    // Calculate cost units based on tier
    const costUnits = actualTokens * this.tierCosts[reservation.tier];
    account.costUnits += costUnits;

    this.reservations.delete(reservationId);

    return {
      releasedTokens: reservation.tokens,
      actualTokens,
      costUnits,
    };
  }

  /**
   * Get remaining headroom for a tenant.
   * Headroom = limit - spent - reserved
   */
  headroom(tenant: string): number {
    const account = this.accounts.get(tenant);
    if (!account) return Infinity;
    return (
      account.config.tokenLimit -
      account.spentTokens -
      account.reservedTokens
    );
  }

  /**
   * Check if a tenant is over budget (soft cap only).
   */
  isOverBudget(tenant: string): boolean {
    const account = this.accounts.get(tenant);
    return account?.overBudget ?? false;
  }

  /**
   * Get account state for a tenant.
   */
  getAccount(tenant: string): Account | undefined {
    return this.accounts.get(tenant);
  }

  /**
   * Get all accounts.
   */
  getAllAccounts(): Map<string, Account> {
    return new Map(this.accounts);
  }

  /**
   * Get total reserved tokens across all tenants.
   * Used for overshoot analysis.
   */
  getTotalReserved(): number {
    let total = 0;
    for (const account of this.accounts.values()) {
      total += account.reservedTokens;
    }
    return total;
  }

  /**
   * Get total spent tokens across all tenants.
   */
  getTotalSpent(): number {
    let total = 0;
    for (const account of this.accounts.values()) {
      total += account.spentTokens;
    }
    return total;
  }

  /**
   * Reset all accounts (for testing).
   */
  reset(): void {
    for (const account of this.accounts.values()) {
      account.spentTokens = 0;
      account.reservedTokens = 0;
      account.overBudget = false;
      account.costUnits = 0;
    }
    this.reservations.clear();
  }
}
