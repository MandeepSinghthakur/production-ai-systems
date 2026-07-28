// Architecture definitions for conversational assistant.
// See Chapter 28, "Building Production AI Systems".
//
// This module defines the components and their relationships.
// The architecture assembles concepts from earlier chapters:
// - Gateway (Ch 18)
// - Multi-provider routing (Ch 19)
// - Memory management (Ch 20)
// - Evaluation (Ch 21)
// - Security (Ch 22)
// - Cost control (Ch 23)

import type {
  Component,
  Architecture,
  CapacityEstimates,
  ScalingPoint,
} from './types.ts';

/**
 * Build the baseline architecture for a conversational assistant.
 * This is the starting point for scaling discussions.
 */
export function buildArchitecture(
  estimates: CapacityEstimates
): Architecture {
  const components = new Map<string, Component>();

  // API Gateway: entry point, handles auth, rate limiting
  components.set('api-gateway', {
    name: 'api-gateway',
    type: 'service',
    replicaCount: 2,
    requestsPerSecondCapacity: 5000,
    memoryMb: 512,
    cpuCores: 1,
    dependencies: ['llm-gateway'],
  });

  // LLM Gateway: the core from Chapter 18
  // Handles routing, retries, streaming, usage tracking
  const gatewayReplicas = Math.max(
    2,
    Math.ceil(estimates.messagesPerSecondPeak / 100)
  );
  components.set('llm-gateway', {
    name: 'llm-gateway',
    type: 'service',
    replicaCount: gatewayReplicas,
    requestsPerSecondCapacity: 100 * gatewayReplicas,
    memoryMb: 1024,
    cpuCores: 2,
    dependencies: ['memory-store', 'session-store', 'provider-primary'],
  });

  // Memory Store: conversation history (Chapter 20)
  // Redis for fast access, Postgres for persistence
  const memoryMb = Math.ceil(estimates.totalMemoryBytes / (1024 * 1024));
  components.set('memory-store', {
    name: 'memory-store',
    type: 'datastore',
    replicaCount: 3, // Redis cluster
    requestsPerSecondCapacity: 50000,
    memoryMb: Math.max(1024, memoryMb),
    cpuCores: 2,
    dependencies: [],
  });

  // Session Store: active conversation state
  components.set('session-store', {
    name: 'session-store',
    type: 'datastore',
    replicaCount: 3,
    requestsPerSecondCapacity: 100000,
    memoryMb: 512,
    cpuCores: 1,
    dependencies: [],
  });

  // Primary Provider: the main model provider
  components.set('provider-primary', {
    name: 'provider-primary',
    type: 'external',
    replicaCount: 1, // External, not our replicas
    requestsPerSecondCapacity: 1000,
    memoryMb: 0,
    cpuCores: 0,
    dependencies: [],
  });

  // Fallback Provider: for failover (Chapter 19)
  components.set('provider-fallback', {
    name: 'provider-fallback',
    type: 'external',
    replicaCount: 1,
    requestsPerSecondCapacity: 500,
    memoryMb: 0,
    cpuCores: 0,
    dependencies: [],
  });

  // Evaluation Service: offline quality checks (Chapter 21)
  components.set('eval-service', {
    name: 'eval-service',
    type: 'service',
    replicaCount: 1,
    requestsPerSecondCapacity: 10,
    memoryMb: 2048,
    cpuCores: 2,
    dependencies: ['eval-store'],
  });

  // Evaluation Store: eval results and datasets
  components.set('eval-store', {
    name: 'eval-store',
    type: 'datastore',
    replicaCount: 1,
    requestsPerSecondCapacity: 1000,
    memoryMb: 512,
    cpuCores: 1,
    dependencies: [],
  });

  // Security Layer: prompt injection detection (Chapter 22)
  components.set('security-filter', {
    name: 'security-filter',
    type: 'service',
    replicaCount: 2,
    requestsPerSecondCapacity: 2000,
    memoryMb: 256,
    cpuCores: 1,
    dependencies: [],
  });

  // Cost Control: budget tracking (Chapter 23)
  components.set('budget-store', {
    name: 'budget-store',
    type: 'datastore',
    replicaCount: 3,
    requestsPerSecondCapacity: 10000,
    memoryMb: 256,
    cpuCores: 1,
    dependencies: [],
  });

  // Ledger: usage records for billing
  components.set('ledger', {
    name: 'ledger',
    type: 'datastore',
    replicaCount: 2,
    requestsPerSecondCapacity: 5000,
    memoryMb: 1024,
    cpuCores: 2,
    dependencies: [],
  });

  // Calculate totals
  let totalCpuCores = 0;
  let totalMemoryMb = 0;
  let minThroughput = Infinity;

  for (const component of components.values()) {
    if (component.type !== 'external') {
      totalCpuCores += component.cpuCores * component.replicaCount;
      totalMemoryMb += component.memoryMb * component.replicaCount;
    }
    if (component.requestsPerSecondCapacity < minThroughput) {
      minThroughput = component.requestsPerSecondCapacity;
    }
  }

  return {
    components,
    totalCpuCores,
    totalMemoryMb,
    throughputCapacity: minThroughput,
  };
}

/**
 * Identify the bottleneck component at a given load.
 * Returns the component that will saturate first.
 */
export function identifyBottleneck(
  architecture: Architecture,
  requestsPerSecond: number
): { component: string; utilization: number; capacity: number } | null {
  let maxUtilization = 0;
  let bottleneck: string | null = null;
  let bottleneckCapacity = 0;

  for (const [name, component] of architecture.components) {
    // External providers have different scaling characteristics
    if (component.type === 'external') {
      continue;
    }

    const totalCapacity =
      component.requestsPerSecondCapacity * component.replicaCount;
    const utilization = requestsPerSecond / totalCapacity;

    if (utilization > maxUtilization) {
      maxUtilization = utilization;
      bottleneck = name;
      bottleneckCapacity = totalCapacity;
    }
  }

  if (bottleneck === null) {
    return null;
  }

  return {
    component: bottleneck,
    utilization: maxUtilization,
    capacity: bottleneckCapacity,
  };
}

/**
 * Calculate utilization for all components at a given load.
 */
export function calculateUtilization(
  architecture: Architecture,
  requestsPerSecond: number
): Record<string, number> {
  const utilization: Record<string, number> = {};

  for (const [name, component] of architecture.components) {
    if (component.type === 'external') {
      // External providers: assume linear scaling to their limit
      utilization[name] = requestsPerSecond / component.requestsPerSecondCapacity;
    } else {
      const totalCapacity =
        component.requestsPerSecondCapacity * component.replicaCount;
      utilization[name] = requestsPerSecond / totalCapacity;
    }
  }

  return utilization;
}

/**
 * Define scaling decision points.
 * This answers: "What do we change as we grow from 1K to 1M users?"
 */
export function defineScalingPoints(): ScalingPoint[] {
  return [
    {
      usersThreshold: 1000,
      component: 'architecture',
      action: 'Baseline deployment',
      reason: 'Initial setup with 2 gateway replicas, single-region',
      costMultiplier: 1.0,
    },
    {
      usersThreshold: 10000,
      component: 'llm-gateway',
      action: 'Scale to 4 replicas',
      reason: 'Peak traffic exceeds single-instance capacity',
      costMultiplier: 1.3,
    },
    {
      usersThreshold: 50000,
      component: 'memory-store',
      action: 'Add read replicas',
      reason: 'Memory reads become bottleneck for context retrieval',
      costMultiplier: 1.5,
    },
    {
      usersThreshold: 100000,
      component: 'provider-primary',
      action: 'Add second provider',
      reason: 'Single provider rate limits; need failover for availability',
      costMultiplier: 1.2,
    },
    {
      usersThreshold: 250000,
      component: 'architecture',
      action: 'Multi-region deployment',
      reason: 'Latency requirements and availability targets',
      costMultiplier: 2.0,
    },
    {
      usersThreshold: 500000,
      component: 'llm-gateway',
      action: 'Scale to 16 replicas per region',
      reason: 'Sustained high throughput with geographic distribution',
      costMultiplier: 2.5,
    },
    {
      usersThreshold: 1000000,
      component: 'architecture',
      action: 'Add third region, dedicated provider agreements',
      reason: 'Global availability, negotiated rate limits and pricing',
      costMultiplier: 3.0,
    },
  ];
}

/**
 * Calculate the scaling point for a given user count.
 */
export function getScalingPhase(
  userCount: number,
  scalingPoints: ScalingPoint[]
): ScalingPoint {
  let current = scalingPoints[0];

  for (const point of scalingPoints) {
    if (userCount >= point.usersThreshold) {
      current = point;
    } else {
      break;
    }
  }

  return current;
}

/**
 * Validate architecture dependencies.
 * Every dependency must exist, no circular dependencies.
 */
export function validateArchitecture(
  architecture: Architecture
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const componentNames = new Set(architecture.components.keys());

  for (const [name, component] of architecture.components) {
    for (const dep of component.dependencies) {
      if (!componentNames.has(dep)) {
        errors.push(
          `Component '${name}' depends on '${dep}' which does not exist`
        );
      }
    }
  }

  // Check for circular dependencies using DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(name: string): boolean {
    if (inStack.has(name)) {
      return true;
    }
    if (visited.has(name)) {
      return false;
    }

    visited.add(name);
    inStack.add(name);

    const component = architecture.components.get(name);
    if (component) {
      for (const dep of component.dependencies) {
        if (hasCycle(dep)) {
          errors.push(`Circular dependency detected involving '${name}'`);
          return true;
        }
      }
    }

    inStack.delete(name);
    return false;
  }

  for (const name of componentNames) {
    hasCycle(name);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
