// Deadlock detection and resolution for multi-agent systems.
// See Chapter 27, "Building Production AI Systems".

import type { DeadlockResult, WaitState } from './types.ts';

/**
 * Manages wait-for relationships and detects deadlocks.
 */
export class DeadlockDetector {
  private waitGraph: Map<string, WaitState>;
  private detectionTimeoutMs: number;

  constructor(detectionTimeoutMs: number = 5000) {
    this.waitGraph = new Map();
    this.detectionTimeoutMs = detectionTimeoutMs;
  }

  /**
   * Record that an agent is waiting for another agent.
   */
  recordWait(agentId: string, waitingFor: string, taskId: string): void {
    this.waitGraph.set(agentId, {
      agentId,
      waitingFor,
      since: Date.now(),
      taskId,
    });
  }

  /**
   * Clear a wait record when an agent is no longer waiting.
   */
  clearWait(agentId: string): void {
    this.waitGraph.delete(agentId);
  }

  /**
   * Get all current wait states.
   */
  getWaitStates(): WaitState[] {
    return Array.from(this.waitGraph.values());
  }

  /**
   * Detect deadlocks by finding cycles in the wait-for graph.
   * Uses a simple DFS-based cycle detection algorithm.
   */
  detectDeadlock(): DeadlockResult {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const detectCycle = (agentId: string): string[] | null => {
      visited.add(agentId);
      recursionStack.add(agentId);
      path.push(agentId);

      const waitState = this.waitGraph.get(agentId);
      if (waitState) {
        const waitingFor = waitState.waitingFor;

        if (!visited.has(waitingFor)) {
          const cycle = detectCycle(waitingFor);
          if (cycle) {
            return cycle;
          }
        } else if (recursionStack.has(waitingFor)) {
          // Found a cycle - extract it
          const cycleStart = path.indexOf(waitingFor);
          return path.slice(cycleStart);
        }
      }

      path.pop();
      recursionStack.delete(agentId);
      return null;
    };

    // Check for cycles starting from each waiting agent
    for (const agentId of this.waitGraph.keys()) {
      if (!visited.has(agentId)) {
        const cycle = detectCycle(agentId);
        if (cycle) {
          return {
            detected: true,
            cycle,
            waitStates: this.getWaitStates(),
          };
        }
      }
    }

    return {
      detected: false,
      cycle: [],
      waitStates: this.getWaitStates(),
    };
  }

  /**
   * Check for potential deadlock based on wait duration.
   * If any agent has been waiting longer than the timeout,
   * it might indicate a deadlock or a hung agent.
   */
  checkWaitTimeout(): { timedOut: boolean; waitState: WaitState | null } {
    const now = Date.now();

    for (const waitState of this.waitGraph.values()) {
      const waitDuration = now - waitState.since;
      if (waitDuration > this.detectionTimeoutMs) {
        return { timedOut: true, waitState };
      }
    }

    return { timedOut: false, waitState: null };
  }

  /**
   * Resolve a deadlock by breaking the cycle.
   * Returns the agent that should be interrupted.
   */
  resolveDeadlock(cycle: string[]): {
    agentToInterrupt: string;
    taskToCancel: string;
  } | null {
    if (cycle.length === 0) {
      return null;
    }

    // Strategy: interrupt the agent with the most recent wait
    // (least amount of work invested)
    let latestWait: WaitState | null = null;
    let latestTime = 0;

    for (const agentId of cycle) {
      const waitState = this.waitGraph.get(agentId);
      if (waitState && waitState.since > latestTime) {
        latestTime = waitState.since;
        latestWait = waitState;
      }
    }

    if (latestWait) {
      // Clear the wait to break the cycle
      this.clearWait(latestWait.agentId);
      return {
        agentToInterrupt: latestWait.agentId,
        taskToCancel: latestWait.taskId,
      };
    }

    return null;
  }

  /**
   * Clear all wait records.
   */
  clear(): void {
    this.waitGraph.clear();
  }
}

/**
 * Simulate a deadlock scenario for testing.
 */
export function createDeadlockScenario(detector: DeadlockDetector): void {
  // Agent A waits for Agent B
  detector.recordWait('agent-a', 'agent-b', 'task-1');
  // Agent B waits for Agent C
  detector.recordWait('agent-b', 'agent-c', 'task-2');
  // Agent C waits for Agent A - creates a cycle
  detector.recordWait('agent-c', 'agent-a', 'task-3');
}

/**
 * Create a linear wait chain (no deadlock).
 */
export function createLinearWaitScenario(detector: DeadlockDetector): void {
  // Agent A waits for Agent B
  detector.recordWait('agent-a', 'agent-b', 'task-1');
  // Agent B waits for Agent C
  detector.recordWait('agent-b', 'agent-c', 'task-2');
  // Agent C is not waiting for anyone - no cycle
}
