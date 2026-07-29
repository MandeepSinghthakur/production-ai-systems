// Graceful degradation patterns for overloaded APIs.
//
// The key insight: partial service is better than no service.
// When overloaded, shed lower-priority work to protect core functionality.
// The alternative is treating all requests equally and failing all of them.

import type {
  APIRequest,
  APIResponse,
  DegradationConfig,
  DegradationLevel,
  SystemHealth,
} from './types.ts';

const DEFAULT_DEGRADATION_CONFIG: DegradationConfig = {
  cpuThresholds: {
    shedNew: 70,
    shedStreaming: 85,
    emergency: 95,
  },
  queueThresholds: {
    shedNew: 100,
    shedStreaming: 200,
    emergency: 500,
  },
  recoveryHysteresis: 10,
};

/**
 * Manages system health and degradation state.
 */
export class DegradationController {
  private config: DegradationConfig;
  private currentLevel: DegradationLevel;
  private history: SystemHealth[];
  private maxHistory: number;

  constructor(config?: Partial<DegradationConfig>) {
    this.config = { ...DEFAULT_DEGRADATION_CONFIG, ...config };
    this.currentLevel = 'none';
    this.history = [];
    this.maxHistory = 100;
  }

  /**
   * Update system health and determine degradation level.
   */
  updateHealth(
    cpuUtilization: number,
    memoryUtilization: number,
    queueDepth: number,
    activeConnections: number
  ): DegradationLevel {
    const previousLevel = this.currentLevel;
    const newLevel = this.calculateLevel(cpuUtilization, queueDepth);

    // Apply hysteresis to prevent oscillation
    if (this.shouldTransition(previousLevel, newLevel, cpuUtilization, queueDepth)) {
      this.currentLevel = newLevel;
    }

    const health: SystemHealth = {
      timestamp: Date.now(),
      cpuUtilization,
      memoryUtilization,
      queueDepth,
      activeConnections,
      degradationLevel: this.currentLevel,
    };

    this.history.push(health);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return this.currentLevel;
  }

  private calculateLevel(
    cpuUtilization: number,
    queueDepth: number
  ): DegradationLevel {
    const { cpuThresholds, queueThresholds } = this.config;

    // Emergency level - both CPU and queue critical
    if (
      cpuUtilization >= cpuThresholds.emergency ||
      queueDepth >= queueThresholds.emergency
    ) {
      return 'emergency';
    }

    // Shed streaming - high load
    if (
      cpuUtilization >= cpuThresholds.shedStreaming ||
      queueDepth >= queueThresholds.shedStreaming
    ) {
      return 'shed-streaming';
    }

    // Shed new - moderate load
    if (
      cpuUtilization >= cpuThresholds.shedNew ||
      queueDepth >= queueThresholds.shedNew
    ) {
      return 'shed-new';
    }

    return 'none';
  }

  private shouldTransition(
    current: DegradationLevel,
    proposed: DegradationLevel,
    cpuUtilization: number,
    queueDepth: number
  ): boolean {
    const levels: DegradationLevel[] = [
      'none',
      'shed-new',
      'shed-streaming',
      'emergency',
    ];
    const currentIdx = levels.indexOf(current);
    const proposedIdx = levels.indexOf(proposed);

    // Escalation is immediate
    if (proposedIdx > currentIdx) {
      return true;
    }

    // De-escalation requires hysteresis
    if (proposedIdx < currentIdx) {
      const hysteresis = this.config.recoveryHysteresis;
      const { cpuThresholds, queueThresholds } = this.config;

      switch (current) {
        case 'emergency':
          return (
            cpuUtilization < cpuThresholds.shedStreaming - hysteresis &&
            queueDepth < queueThresholds.shedStreaming - hysteresis
          );
        case 'shed-streaming':
          return (
            cpuUtilization < cpuThresholds.shedNew - hysteresis &&
            queueDepth < queueThresholds.shedNew - hysteresis
          );
        case 'shed-new':
          return (
            cpuUtilization < cpuThresholds.shedNew - hysteresis &&
            queueDepth < queueThresholds.shedNew - hysteresis
          );
        default:
          return true;
      }
    }

    return false;
  }

  /**
   * Check if a request should be accepted at the current degradation level.
   */
  shouldAccept(request: APIRequest): {
    accept: boolean;
    reason: string;
    degradedResponse: boolean;
  } {
    switch (this.currentLevel) {
      case 'none':
        return { accept: true, reason: 'System healthy', degradedResponse: false };

      case 'shed-new':
        // Accept existing sessions, reject new ones
        if (request.streaming) {
          return {
            accept: true,
            reason: 'Existing streaming allowed',
            degradedResponse: false,
          };
        }
        // For demo: randomly shed 50% of new requests
        if (Math.random() < 0.5) {
          return { accept: true, reason: 'New request admitted', degradedResponse: false };
        }
        return {
          accept: false,
          reason: 'Shedding new requests under load',
          degradedResponse: false,
        };

      case 'shed-streaming':
        // Reject streaming, serve shorter responses
        if (request.streaming) {
          return {
            accept: false,
            reason: 'Streaming disabled under load',
            degradedResponse: false,
          };
        }
        return {
          accept: true,
          reason: 'Non-streaming accepted with degraded response',
          degradedResponse: true,
        };

      case 'emergency':
        // Only serve cached or minimal responses
        return {
          accept: false,
          reason: 'Emergency mode - rejecting all new requests',
          degradedResponse: false,
        };

      default:
        return { accept: true, reason: 'Unknown level', degradedResponse: false };
    }
  }

  getCurrentLevel(): DegradationLevel {
    return this.currentLevel;
  }

  getHistory(): SystemHealth[] {
    return [...this.history];
  }

  getConfig(): DegradationConfig {
    return { ...this.config };
  }
}

/**
 * A request processor that applies graceful degradation.
 */
export class DegradedRequestProcessor {
  private controller: DegradationController;
  private requestsAccepted: number;
  private requestsRejected: number;
  private requestsDegraded: number;

  constructor(config?: Partial<DegradationConfig>) {
    this.controller = new DegradationController(config);
    this.requestsAccepted = 0;
    this.requestsRejected = 0;
    this.requestsDegraded = 0;
  }

  /**
   * Process a request with degradation awareness.
   */
  async process(
    request: APIRequest,
    currentCpu: number,
    currentQueue: number
  ): Promise<APIResponse> {
    // Update degradation level
    this.controller.updateHealth(currentCpu, 50, currentQueue, 0);

    const decision = this.controller.shouldAccept(request);

    if (!decision.accept) {
      this.requestsRejected++;
      return {
        requestId: request.id,
        status: 'rejected',
        latencyMs: 0,
        tokensProcessed: 0,
        instanceId: 'degradation-controller',
      };
    }

    // Simulate processing
    await this.sleep(decision.degradedResponse ? 10 : 50);

    if (decision.degradedResponse) {
      this.requestsDegraded++;
      return {
        requestId: request.id,
        status: 'degraded',
        latencyMs: 10,
        tokensProcessed: request.estimatedTokens / 4, // Shorter response
        instanceId: 'degraded-processor',
      };
    }

    this.requestsAccepted++;
    return {
      requestId: request.id,
      status: 'success',
      latencyMs: 50,
      tokensProcessed: request.estimatedTokens,
      instanceId: 'full-processor',
    };
  }

  getStats(): {
    accepted: number;
    rejected: number;
    degraded: number;
    currentLevel: DegradationLevel;
  } {
    return {
      accepted: this.requestsAccepted,
      rejected: this.requestsRejected,
      degraded: this.requestsDegraded,
      currentLevel: this.controller.getCurrentLevel(),
    };
  }

  getController(): DegradationController {
    return this.controller;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Demonstrates graceful degradation under increasing load.
 */
export async function demonstrateGracefulDegradation(
  requestCount: number
): Promise<{
  totalRequests: number;
  accepted: number;
  rejected: number;
  degraded: number;
  levelTransitions: Array<{ from: DegradationLevel; to: DegradationLevel; at: number }>;
}> {
  const processor = new DegradedRequestProcessor();
  const transitions: Array<{ from: DegradationLevel; to: DegradationLevel; at: number }> = [];
  let previousLevel: DegradationLevel = 'none';

  // Simulate increasing load
  for (let i = 0; i < requestCount; i++) {
    // CPU increases with request index
    const simulatedCpu = Math.min(98, 30 + (i / requestCount) * 70);
    const simulatedQueue = Math.min(600, i * 5);

    const request: APIRequest = {
      id: `req-${i}`,
      tenantId: 'tenant-1',
      payload: `Request ${i}`,
      estimatedTokens: 500,
      streaming: i % 3 === 0, // Every 3rd request is streaming
      arrivedAt: Date.now(),
    };

    await processor.process(request, simulatedCpu, simulatedQueue);

    const currentLevel = processor.getController().getCurrentLevel();
    if (currentLevel !== previousLevel) {
      transitions.push({
        from: previousLevel,
        to: currentLevel,
        at: i,
      });
      previousLevel = currentLevel;
    }
  }

  const stats = processor.getStats();

  return {
    totalRequests: requestCount,
    accepted: stats.accepted,
    rejected: stats.rejected,
    degraded: stats.degraded,
    levelTransitions: transitions,
  };
}

/**
 * Priority-based load shedding.
 * High-priority requests are protected; low-priority shed first.
 */
export class PriorityLoadShedder {
  private highPriorityProcessed: number;
  private lowPriorityProcessed: number;
  private highPriorityShed: number;
  private lowPriorityShed: number;
  private shedThreshold: number;

  constructor(shedThreshold: number = 0.7) {
    this.highPriorityProcessed = 0;
    this.lowPriorityProcessed = 0;
    this.highPriorityShed = 0;
    this.lowPriorityShed = 0;
    this.shedThreshold = shedThreshold;
  }

  /**
   * Process a request with priority-aware shedding.
   */
  process(isHighPriority: boolean, currentLoad: number): boolean {
    if (currentLoad < this.shedThreshold) {
      // Under threshold - accept all
      if (isHighPriority) {
        this.highPriorityProcessed++;
      } else {
        this.lowPriorityProcessed++;
      }
      return true;
    }

    // Over threshold - shed based on priority
    if (isHighPriority) {
      // High priority: shed only when very overloaded
      if (currentLoad < 0.95) {
        this.highPriorityProcessed++;
        return true;
      }
      this.highPriorityShed++;
      return false;
    }

    // Low priority: shed proportionally
    const shedProbability = (currentLoad - this.shedThreshold) / (1 - this.shedThreshold);
    if (Math.random() > shedProbability) {
      this.lowPriorityProcessed++;
      return true;
    }
    this.lowPriorityShed++;
    return false;
  }

  getStats(): {
    highPriorityProcessed: number;
    lowPriorityProcessed: number;
    highPriorityShed: number;
    lowPriorityShed: number;
    highPrioritySuccessRate: number;
    lowPrioritySuccessRate: number;
  } {
    const highTotal = this.highPriorityProcessed + this.highPriorityShed;
    const lowTotal = this.lowPriorityProcessed + this.lowPriorityShed;

    return {
      highPriorityProcessed: this.highPriorityProcessed,
      lowPriorityProcessed: this.lowPriorityProcessed,
      highPriorityShed: this.highPriorityShed,
      lowPriorityShed: this.lowPriorityShed,
      highPrioritySuccessRate: highTotal > 0 ? this.highPriorityProcessed / highTotal : 1,
      lowPrioritySuccessRate: lowTotal > 0 ? this.lowPriorityProcessed / lowTotal : 1,
    };
  }
}

/**
 * Demonstrates that priority shedding protects high-priority requests.
 */
export function demonstratePriorityShedding(
  requestCount: number,
  loadPattern: number[] // Array of load values 0-1
): {
  highPrioritySuccessRate: number;
  lowPrioritySuccessRate: number;
  totalProcessed: number;
  totalShed: number;
} {
  const shedder = new PriorityLoadShedder(0.7);

  for (let i = 0; i < requestCount; i++) {
    const load = loadPattern[i % loadPattern.length];
    const isHighPriority = i % 4 === 0; // 25% are high priority

    shedder.process(isHighPriority, load);
  }

  const stats = shedder.getStats();

  return {
    highPrioritySuccessRate: stats.highPrioritySuccessRate,
    lowPrioritySuccessRate: stats.lowPrioritySuccessRate,
    totalProcessed: stats.highPriorityProcessed + stats.lowPriorityProcessed,
    totalShed: stats.highPriorityShed + stats.lowPriorityShed,
  };
}
