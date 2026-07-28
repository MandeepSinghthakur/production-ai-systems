// Load simulation for conversational assistant.
// See Chapter 28, "Building Production AI Systems".
//
// Simulates request flow through the architecture to identify
// bottlenecks, measure capacity utilization, and validate
// scaling decisions.

import type {
  Architecture,
  CapacityEstimates,
  SimulationResult,
  GatewayConfig,
  ModelTier,
} from './types.ts';
import { TIER_TOKEN_PROFILE, TIER_COST_MULTIPLIER } from './types.ts';
import { identifyBottleneck, calculateUtilization } from './architecture.ts';

/**
 * Simulate load on the architecture.
 * Returns metrics about throughput, latency, and bottlenecks.
 */
export function simulateLoad(
  architecture: Architecture,
  estimates: CapacityEstimates,
  durationSeconds: number,
  gatewayConfig: GatewayConfig
): SimulationResult {
  const requestsPerSecond = estimates.messagesPerSecondPeak;
  const totalRequests = Math.floor(requestsPerSecond * durationSeconds);

  // Calculate base latency from model inference time
  // Typical: 2-5 seconds for mid-tier, 5-15 seconds for frontier
  const baseLatencyMs = 3000;

  // Find the bottleneck
  const bottleneck = identifyBottleneck(architecture, requestsPerSecond);
  const capacityUtilization = calculateUtilization(
    architecture,
    requestsPerSecond
  );

  // Calculate success/failure based on capacity
  let successfulRequests = totalRequests;
  let failedRequests = 0;
  let rejectedRequests = 0;

  // If any component is over capacity, requests fail
  for (const [name, utilization] of Object.entries(capacityUtilization)) {
    if (utilization > 1.0) {
      // Requests over capacity fail
      const overCapacityFraction = 1 - 1 / utilization;
      const failedFromComponent = Math.floor(
        totalRequests * overCapacityFraction
      );
      failedRequests = Math.max(failedRequests, failedFromComponent);
    }
  }

  successfulRequests = totalRequests - failedRequests;

  // Check rate limiting
  const totalRateLimit =
    gatewayConfig.rateLimitPerTenant *
    Math.ceil(estimates.conversationsPerDay / durationSeconds);
  if (requestsPerSecond > totalRateLimit) {
    rejectedRequests = Math.floor(
      (requestsPerSecond - totalRateLimit) * durationSeconds
    );
    successfulRequests -= rejectedRequests;
  }

  // Calculate latency
  // P99 is higher when utilization is high
  const utilizationFactor =
    bottleneck !== null ? Math.max(1, bottleneck.utilization) : 1;
  const averageLatencyMs = baseLatencyMs * utilizationFactor;
  const p99LatencyMs = averageLatencyMs * 3; // Typical p99/avg ratio

  // Tokens processed
  const tokensProcessed = Math.floor(
    successfulRequests * (estimates.tokensPerDay / estimates.messagesPerDay)
  );

  // Failover events: if primary provider is over 90% utilization
  const primaryUtilization = capacityUtilization['provider-primary'] ?? 0;
  const failoverEvents =
    primaryUtilization > 0.9
      ? Math.floor((primaryUtilization - 0.9) * 10 * durationSeconds)
      : 0;

  // Memory pressure: if memory store is over 80% utilization
  const memoryUtilization = capacityUtilization['memory-store'] ?? 0;
  const memoryPressureEvents =
    memoryUtilization > 0.8
      ? Math.floor((memoryUtilization - 0.8) * 5 * durationSeconds)
      : 0;

  return {
    durationSeconds,
    totalRequests,
    successfulRequests,
    failedRequests,
    rejectedRequests,
    averageLatencyMs,
    p99LatencyMs,
    tokensProcessed,
    bottleneckComponent: bottleneck?.component ?? null,
    capacityUtilization,
    failoverEvents,
    memoryPressureEvents,
  };
}

/**
 * Simulate failover scenario.
 * Primary provider goes down, system should route to fallback.
 */
export function simulateFailover(
  architecture: Architecture,
  estimates: CapacityEstimates,
  primaryDowntimeSeconds: number,
  failoverLatencyMs: number
): {
  requestsDuringFailover: number;
  requestsLost: number;
  requestsRerouted: number;
  availabilityDuringIncident: number;
} {
  const requestsPerSecond = estimates.messagesPerSecondPeak;
  const requestsDuringFailover = Math.floor(
    requestsPerSecond * primaryDowntimeSeconds
  );

  // Requests lost during failover detection
  const failoverDetectionRequests = Math.ceil(
    (failoverLatencyMs / 1000) * requestsPerSecond
  );

  // Check if fallback can handle the load
  const fallbackComponent = architecture.components.get('provider-fallback');
  const fallbackCapacity = fallbackComponent?.requestsPerSecondCapacity ?? 0;

  let requestsRerouted: number;
  if (fallbackCapacity >= requestsPerSecond) {
    // Fallback can handle full load
    requestsRerouted = requestsDuringFailover - failoverDetectionRequests;
  } else {
    // Fallback handles what it can
    const fallbackHandled = Math.floor(fallbackCapacity * primaryDowntimeSeconds);
    requestsRerouted = Math.min(
      fallbackHandled,
      requestsDuringFailover - failoverDetectionRequests
    );
  }

  const requestsLost =
    requestsDuringFailover - requestsRerouted - failoverDetectionRequests;

  // Availability = successful / total
  const availabilityDuringIncident =
    (requestsRerouted + failoverDetectionRequests) / requestsDuringFailover;

  return {
    requestsDuringFailover,
    requestsLost: Math.max(0, requestsLost),
    requestsRerouted,
    availabilityDuringIncident: Math.min(1, availabilityDuringIncident),
  };
}

/**
 * Simulate memory pressure scenario.
 * Conversations grow beyond budget, system should summarize or evict.
 */
export function simulateMemoryPressure(
  totalConversations: number,
  memoryBudgetPerConversation: number,
  totalMemoryAvailable: number
): {
  conversationsInMemory: number;
  conversationsEvicted: number;
  memoryUtilization: number;
  evictionRequired: boolean;
} {
  const totalMemoryNeeded = totalConversations * memoryBudgetPerConversation;
  const memoryUtilization = totalMemoryNeeded / totalMemoryAvailable;

  let conversationsInMemory: number;
  let conversationsEvicted: number;

  if (memoryUtilization <= 1.0) {
    conversationsInMemory = totalConversations;
    conversationsEvicted = 0;
  } else {
    // LRU eviction: keep as many as fit
    conversationsInMemory = Math.floor(
      totalMemoryAvailable / memoryBudgetPerConversation
    );
    conversationsEvicted = totalConversations - conversationsInMemory;
  }

  return {
    conversationsInMemory,
    conversationsEvicted,
    memoryUtilization,
    evictionRequired: memoryUtilization > 1.0,
  };
}

/**
 * Simulate concurrent request handling.
 * Tests gateway capacity under various load patterns.
 */
export function simulateConcurrentRequests(
  maxConcurrent: number,
  arrivalRate: number,
  avgDurationMs: number,
  durationSeconds: number
): {
  totalArrived: number;
  totalCompleted: number;
  totalQueued: number;
  totalRejected: number;
  avgQueueTime: number;
  peakConcurrent: number;
} {
  // Little's Law: concurrent = arrival_rate * service_time
  const steadyStateConcurrent = arrivalRate * (avgDurationMs / 1000);

  const totalArrived = Math.floor(arrivalRate * durationSeconds);
  const peakConcurrent = Math.ceil(steadyStateConcurrent * 1.5); // Peak is 1.5x average

  let totalCompleted: number;
  let totalQueued: number;
  let totalRejected: number;

  if (peakConcurrent <= maxConcurrent) {
    // System can handle the load
    totalCompleted = totalArrived;
    totalQueued = 0;
    totalRejected = 0;
  } else {
    // System is overloaded
    const overloadFactor = peakConcurrent / maxConcurrent;
    totalRejected = Math.floor(totalArrived * (1 - 1 / overloadFactor));
    totalCompleted = totalArrived - totalRejected;
    totalQueued = Math.floor(totalRejected * 0.3); // Some queued before rejection
  }

  // Queue time proportional to utilization
  const utilization = steadyStateConcurrent / maxConcurrent;
  const avgQueueTime =
    utilization < 1 ? avgDurationMs * utilization : avgDurationMs * 2;

  return {
    totalArrived,
    totalCompleted,
    totalQueued,
    totalRejected,
    avgQueueTime,
    peakConcurrent,
  };
}

/**
 * Calculate cost envelope for the simulation.
 * Ensures cost projections align with token estimates.
 */
export function calculateCostEnvelope(
  tokensProcessed: number,
  tierDistribution: Record<ModelTier, number>
): {
  totalCostUnits: number;
  costByTier: Record<ModelTier, number>;
  costPerToken: number;
} {
  const costByTier: Record<ModelTier, number> = {
    frontier: 0,
    mid: 0,
    small: 0,
  };

  let totalCostUnits = 0;

  for (const tier of Object.keys(tierDistribution) as ModelTier[]) {
    const tierTokens = tokensProcessed * tierDistribution[tier];
    const tierCost = tierTokens * TIER_COST_MULTIPLIER[tier];
    costByTier[tier] = tierCost;
    totalCostUnits += tierCost;
  }

  return {
    totalCostUnits,
    costByTier,
    costPerToken: totalCostUnits / tokensProcessed,
  };
}
