// Request simulator for lab testing.
//
// Simulates concurrent requests with configurable token estimates
// and actuals. Demonstrates reserve-then-reconcile and overshoot
// bounding under concurrent load.

import type { ModelTier, Request } from './types.ts';
import { BudgetManager } from './budget.ts';
import { BudgetForecaster } from './forecaster.ts';
import { CostAllocator } from './allocator.ts';

interface SimulationOptions {
  tenant: string;
  workload?: string;
  tier?: ModelTier;
  count: number;
  estimatedTokens: number;
  actualTokens: number;
  concurrency?: number;
}

interface SimulationResult {
  totalRequests: number;
  acceptedRequests: number;
  rejectedRequests: number;
  totalReserved: number;
  totalActual: number;
  maxConcurrentReserved: number;
}

/**
 * Simulate sequential requests (one at a time).
 * Each request completes before the next starts.
 */
export function simulateSequential(
  budget: BudgetManager,
  options: SimulationOptions
): SimulationResult {
  const {
    tenant,
    workload = 'default',
    tier = 'mid',
    count,
    estimatedTokens,
    actualTokens,
  } = options;

  let acceptedRequests = 0;
  let rejectedRequests = 0;
  let totalReserved = 0;
  let totalActual = 0;
  let maxConcurrentReserved = 0;

  for (let i = 0; i < count; i++) {
    const reservation = budget.reserve(tenant, estimatedTokens, tier);

    if (!reservation.granted) {
      rejectedRequests++;
      continue;
    }

    acceptedRequests++;
    totalReserved += reservation.reservedTokens;

    // Track max concurrent reserved (in sequential mode, this is just
    // the per-request estimate since we settle immediately)
    const currentReserved = budget.getTotalReserved();
    if (currentReserved > maxConcurrentReserved) {
      maxConcurrentReserved = currentReserved;
    }

    // Settle immediately (sequential processing)
    if (reservation.reservationId) {
      const settlement = budget.settle(reservation.reservationId, actualTokens);
      totalActual += settlement.actualTokens;
    }
  }

  return {
    totalRequests: count,
    acceptedRequests,
    rejectedRequests,
    totalReserved,
    totalActual,
    maxConcurrentReserved,
  };
}

/**
 * Simulate concurrent requests.
 * All requests reserve first, then all settle.
 * This demonstrates worst-case overshoot scenario.
 */
export function simulateConcurrent(
  budget: BudgetManager,
  options: SimulationOptions
): SimulationResult {
  const {
    tenant,
    workload = 'default',
    tier = 'mid',
    count,
    estimatedTokens,
    actualTokens,
    concurrency = count,
  } = options;

  let acceptedRequests = 0;
  let rejectedRequests = 0;
  let totalReserved = 0;
  let totalActual = 0;
  let maxConcurrentReserved = 0;

  // Process in batches of concurrency
  const reservations: Array<{ id: string; granted: boolean }> = [];

  for (let i = 0; i < count; i++) {
    const reservation = budget.reserve(tenant, estimatedTokens, tier);

    reservations.push({
      id: reservation.reservationId ?? '',
      granted: reservation.granted,
    });

    if (reservation.granted) {
      acceptedRequests++;
      totalReserved += reservation.reservedTokens;

      const currentReserved = budget.getTotalReserved();
      if (currentReserved > maxConcurrentReserved) {
        maxConcurrentReserved = currentReserved;
      }
    } else {
      rejectedRequests++;
    }

    // Settle when we've filled a batch or reached the end
    if (reservations.length >= concurrency || i === count - 1) {
      for (const res of reservations) {
        if (res.granted && res.id) {
          const settlement = budget.settle(res.id, actualTokens);
          totalActual += settlement.actualTokens;
        }
      }
      reservations.length = 0;
    }
  }

  return {
    totalRequests: count,
    acceptedRequests,
    rejectedRequests,
    totalReserved,
    totalActual,
    maxConcurrentReserved,
  };
}

/**
 * Simulate mixed-tier requests for cost attribution testing.
 */
export function simulateMixedTiers(
  allocator: CostAllocator,
  tenant: string,
  workload: string,
  distribution: Array<{ tier: ModelTier; tokens: number }>
): void {
  for (const entry of distribution) {
    allocator.record(tenant, workload, entry.tier, entry.tokens);
  }
}

/**
 * Simulate spending over time for forecasting tests.
 */
export function simulateSpendingOverTime(
  forecaster: BudgetForecaster,
  tenant: string,
  workload: string,
  tier: ModelTier,
  tokensPerEvent: number,
  eventCount: number,
  intervalMs: number,
  startTime: number
): void {
  for (let i = 0; i < eventCount; i++) {
    forecaster.record({
      timestamp: startTime + i * intervalMs,
      tenant,
      workload,
      tier,
      tokens: tokensPerEvent,
      costUnits: tokensPerEvent, // Simplified for testing
    });
  }
}
