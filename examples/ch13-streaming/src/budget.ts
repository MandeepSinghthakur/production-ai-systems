// Chapter 13 — Streaming and Token Economics
// Budget enforcement with reserve-then-reconcile pattern.
//
// Key insight: you cannot know the cost until after you've spent it.
// Reserve pessimistically, settle to actual, bound the overshoot.

import type { ModelTier, TenantBudget, BudgetCheckResult } from './types.ts';
import { TIER_COST_MULTIPLIER, OUTPUT_MULTIPLIER } from './types.ts';
import { calculateCost } from './economics.ts';

/** Reservation for an in-flight request. */
interface Reservation {
  id: string;
  tenant: string;
  estimatedTokens: number;
  tier: ModelTier;
  timestamp: number;
  settled: boolean;
}

/** Budget manager with reserve-then-reconcile pattern. */
export class BudgetManager {
  private budgets: Map<string, TenantBudget>;
  private usage: Map<string, number>; // tenant -> tokens used today
  private reservations: Map<string, Reservation>;
  private reservationCounter: number;
  private dayStart: number;

  constructor() {
    this.budgets = new Map();
    this.usage = new Map();
    this.reservations = new Map();
    this.reservationCounter = 0;
    this.dayStart = this.getDayStart();
  }

  /** Register a tenant with a budget. */
  registerTenant(config: TenantBudget): void {
    this.budgets.set(config.id, config);
    this.usage.set(config.id, 0);
  }

  /** Check if a request should be allowed. */
  check(tenant: string, estimatedTokens: number): BudgetCheckResult {
    this.maybeResetDay();

    const budget = this.budgets.get(tenant);
    if (!budget) {
      return {
        allowed: true,
        remainingTokens: Infinity,
        usedToday: 0,
        overBudget: false,
      };
    }

    const used = this.getEffectiveUsage(tenant);
    const remaining = budget.dailyTokenLimit - used;
    const overBudget = remaining < estimatedTokens;

    // Hard cap: reject if over budget
    // Soft cap: allow but flag as over budget
    const allowed = budget.hardCap ? remaining >= estimatedTokens : true;

    return {
      allowed,
      remainingTokens: Math.max(0, remaining),
      usedToday: used,
      overBudget,
    };
  }

  /** Reserve tokens for an in-flight request.
   *  Returns a reservation ID for later settlement. */
  reserve(
    tenant: string,
    inputTokens: number,
    maxOutputTokens: number,
    tier: ModelTier,
  ): { reservationId: string; allowed: boolean } {
    // Calculate pessimistic estimate
    const estimatedCost = calculateCost(inputTokens, maxOutputTokens, tier);
    const estimatedTokens = estimatedCost.totalCost;

    const checkResult = this.check(tenant, estimatedTokens);
    if (!checkResult.allowed) {
      return { reservationId: '', allowed: false };
    }

    // Create reservation
    const id = `res_${++this.reservationCounter}`;
    const reservation: Reservation = {
      id,
      tenant,
      estimatedTokens,
      tier,
      timestamp: Date.now(),
      settled: false,
    };

    this.reservations.set(id, reservation);
    return { reservationId: id, allowed: true };
  }

  /** Settle a reservation with actual usage. */
  settle(
    reservationId: string,
    actualInputTokens: number,
    actualOutputTokens: number,
  ): { refund: number } {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.settled) {
      return { refund: 0 };
    }

    const actualCost = calculateCost(
      actualInputTokens,
      actualOutputTokens,
      reservation.tier,
    );

    // Update actual usage
    const currentUsage = this.usage.get(reservation.tenant) ?? 0;
    this.usage.set(reservation.tenant, currentUsage + actualCost.totalCost);

    // Mark settled
    reservation.settled = true;

    // Calculate refund (difference between estimated and actual)
    const refund = reservation.estimatedTokens - actualCost.totalCost;
    return { refund: Math.max(0, refund) };
  }

  /** Cancel a reservation without usage (e.g., request failed). */
  cancel(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (reservation && !reservation.settled) {
      this.reservations.delete(reservationId);
    }
  }

  /** Get current headroom for a tenant. */
  headroom(tenant: string): number {
    const budget = this.budgets.get(tenant);
    if (!budget) return Infinity;

    const effectiveUsage = this.getEffectiveUsage(tenant);
    return Math.max(0, budget.dailyTokenLimit - effectiveUsage);
  }

  /** Get effective usage including outstanding reservations. */
  private getEffectiveUsage(tenant: string): number {
    const settled = this.usage.get(tenant) ?? 0;
    let reserved = 0;

    for (const r of this.reservations.values()) {
      if (r.tenant === tenant && !r.settled) {
        reserved += r.estimatedTokens;
      }
    }

    return settled + reserved;
  }

  /** Get raw usage (settled only, no reservations). */
  rawUsage(tenant: string): number {
    return this.usage.get(tenant) ?? 0;
  }

  /** Get budget for a tenant. */
  getBudget(tenant: string): TenantBudget | undefined {
    return this.budgets.get(tenant);
  }

  /** Reset daily usage. */
  resetDay(): void {
    this.usage.clear();
    for (const tenant of this.budgets.keys()) {
      this.usage.set(tenant, 0);
    }
    this.dayStart = this.getDayStart();
  }

  /** Reset everything. */
  reset(): void {
    this.budgets.clear();
    this.usage.clear();
    this.reservations.clear();
    this.reservationCounter = 0;
    this.dayStart = this.getDayStart();
  }

  /** Check if day has rolled over and reset if needed. */
  private maybeResetDay(): void {
    const currentDayStart = this.getDayStart();
    if (currentDayStart > this.dayStart) {
      this.resetDay();
    }
  }

  /** Get the start of the current day (midnight UTC). */
  private getDayStart(): number {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).getTime();
  }

  /** Count active reservations. */
  activeReservations(): number {
    let count = 0;
    for (const r of this.reservations.values()) {
      if (!r.settled) count++;
    }
    return count;
  }

  /** Total reserved tokens across all active reservations. */
  totalReserved(): number {
    let total = 0;
    for (const r of this.reservations.values()) {
      if (!r.settled) {
        total += r.estimatedTokens;
      }
    }
    return total;
  }
}

/** Simulate concurrent requests to test overshoot bounds. */
export interface OvershootTest {
  requests: number;
  concurrency: number;
  estimatedPerRequest: number;
  actualPerRequest: number;
  totalReserved: number;
  totalSettled: number;
  maxConcurrentReserved: number;
  overshootBound: number;
}

export function testOvershootBounds(
  budget: BudgetManager,
  tenant: string,
  requests: number,
  estimatedPerRequest: number,
  actualPerRequest: number,
  concurrency: number,
): OvershootTest {
  const reservationIds: string[] = [];
  let maxConcurrentReserved = 0;

  // Calculate the cost units per request (includes tier and output multipliers)
  const costPerReservation = calculateCost(
    estimatedPerRequest,
    estimatedPerRequest,
    'mid',
  ).totalCost;

  // Phase 1: Create all reservations concurrently
  for (let i = 0; i < Math.min(requests, concurrency); i++) {
    const result = budget.reserve(
      tenant,
      estimatedPerRequest,
      estimatedPerRequest, // For simplicity, use same for max output
      'mid',
    );
    if (result.allowed) {
      reservationIds.push(result.reservationId);
    }
    maxConcurrentReserved = Math.max(
      maxConcurrentReserved,
      budget.totalReserved(),
    );
  }

  // Phase 2: Settle reservations and create more
  let remaining = requests - concurrency;
  while (reservationIds.length > 0 || remaining > 0) {
    // Settle one
    if (reservationIds.length > 0) {
      const id = reservationIds.shift()!;
      budget.settle(id, actualPerRequest, actualPerRequest);
    }

    // Reserve one more if remaining
    if (remaining > 0) {
      const result = budget.reserve(
        tenant,
        estimatedPerRequest,
        estimatedPerRequest,
        'mid',
      );
      if (result.allowed) {
        reservationIds.push(result.reservationId);
      }
      remaining--;
    }

    maxConcurrentReserved = Math.max(
      maxConcurrentReserved,
      budget.totalReserved(),
    );
  }

  // Overshoot bound is concurrency * cost per reservation (in cost units)
  return {
    requests,
    concurrency,
    estimatedPerRequest,
    actualPerRequest,
    totalReserved: maxConcurrentReserved,
    totalSettled: budget.rawUsage(tenant),
    maxConcurrentReserved,
    overshootBound: concurrency * costPerReservation,
  };
}
