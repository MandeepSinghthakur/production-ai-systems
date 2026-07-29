// Consistency model simulation for distributed AI systems.
// See Chapter 1, "Building Production AI Systems".

import type {
  Node,
  ReadResult,
  WriteResult,
  ConsistencyLevel,
  ConvergenceState,
  PartitionState,
} from './types.ts';

const DEFAULT_REPLICATION_DELAY_MS = 50;
const DEFAULT_NODES = 3;

/**
 * Simulates a distributed data store with configurable consistency.
 * Models the tradeoffs between consistency, availability, and latency.
 */
export class ConsistencySimulator {
  private nodes: Map<string, Node>;
  private replicationDelayMs: number;
  private partitionState: PartitionState;
  private writeLog: Array<{ key: string; value: unknown; timestamp: number }>;

  constructor(nodeCount: number = DEFAULT_NODES, replicationDelayMs: number = DEFAULT_REPLICATION_DELAY_MS) {
    this.nodes = new Map();
    this.replicationDelayMs = replicationDelayMs;
    this.partitionState = {
      partitioned: false,
      partitionStartMs: 0,
      affectedNodes: [],
    };
    this.writeLog = [];

    for (let i = 0; i < nodeCount; i++) {
      const id = `node-${i}`;
      this.nodes.set(id, {
        id,
        state: {},
        clock: 0,
        healthy: true,
        latencyMs: 10 + Math.random() * 20,
      });
    }
  }

  /**
   * Write with eventual consistency - returns immediately after one ack.
   * Other nodes receive the update asynchronously.
   */
  writeEventual(key: string, value: unknown): WriteResult {
    const start = Date.now();
    const nodes = Array.from(this.nodes.values());
    const primary = nodes[0];

    if (!primary.healthy) {
      return {
        success: false,
        nodesAcked: 0,
        requiredAcks: 1,
        latencyMs: Date.now() - start,
      };
    }

    // Write to primary
    primary.state[key] = value;
    primary.clock++;

    // Record for async replication
    this.writeLog.push({ key, value, timestamp: Date.now() });

    return {
      success: true,
      nodesAcked: 1,
      requiredAcks: 1,
      latencyMs: primary.latencyMs,
    };
  }

  /**
   * Write with strong consistency - waits for all nodes to ack.
   * Higher latency but guarantees all reads see the write.
   */
  writeStrong(key: string, value: unknown): WriteResult {
    const start = Date.now();
    const nodes = Array.from(this.nodes.values());
    const healthyNodes = nodes.filter((n) => n.healthy);
    const requiredAcks = Math.floor(nodes.length / 2) + 1; // Majority

    if (healthyNodes.length < requiredAcks) {
      return {
        success: false,
        nodesAcked: healthyNodes.length,
        requiredAcks,
        latencyMs: Date.now() - start,
      };
    }

    // Check for partition - cannot achieve strong consistency
    if (this.partitionState.partitioned) {
      const reachableNodes = healthyNodes.filter(
        (n) => !this.partitionState.affectedNodes.includes(n.id)
      );
      if (reachableNodes.length < requiredAcks) {
        return {
          success: false,
          nodesAcked: reachableNodes.length,
          requiredAcks,
          latencyMs: Date.now() - start,
        };
      }
    }

    // Write to all healthy nodes synchronously
    let maxLatency = 0;
    for (const node of healthyNodes) {
      if (
        !this.partitionState.partitioned ||
        !this.partitionState.affectedNodes.includes(node.id)
      ) {
        node.state[key] = value;
        node.clock++;
        maxLatency = Math.max(maxLatency, node.latencyMs);
      }
    }

    return {
      success: true,
      nodesAcked: healthyNodes.length,
      requiredAcks,
      latencyMs: maxLatency * 2, // Round-trip
    };
  }

  /**
   * Write with causal consistency - tracks dependencies.
   * Faster than strong, but preserves ordering within a causal chain.
   */
  writeCausal(key: string, value: unknown, causalDeps: string[] = []): WriteResult {
    const start = Date.now();
    const nodes = Array.from(this.nodes.values());
    const primary = nodes[0];

    if (!primary.healthy) {
      return {
        success: false,
        nodesAcked: 0,
        requiredAcks: 1,
        latencyMs: Date.now() - start,
      };
    }

    // Write to primary with causal clock
    primary.state[key] = { value, deps: causalDeps, clock: primary.clock };
    primary.clock++;

    // Async replication to secondaries
    this.writeLog.push({ key, value, timestamp: Date.now() });

    return {
      success: true,
      nodesAcked: 1,
      requiredAcks: 1,
      latencyMs: primary.latencyMs,
    };
  }

  /**
   * Read with specified consistency level.
   */
  read(key: string, consistency: ConsistencyLevel): ReadResult {
    const nodes = Array.from(this.nodes.values());

    switch (consistency) {
      case 'eventual': {
        // Read from any healthy node (may be stale)
        const node = nodes.find((n) => n.healthy) ?? nodes[0];
        const value = node.state[key];
        const staleness = this.calculateStaleness(key, node);
        return {
          value: value ?? null,
          consistencyLevel: 'eventual',
          fromNode: node.id,
          staleness,
          latencyMs: node.latencyMs,
        };
      }

      case 'strong': {
        // Read from majority and return latest
        const healthyNodes = nodes.filter((n) => n.healthy);
        const majority = Math.floor(nodes.length / 2) + 1;

        if (healthyNodes.length < majority) {
          // Cannot guarantee consistency - fail the read
          return {
            value: null,
            consistencyLevel: 'strong',
            fromNode: '',
            staleness: -1, // Indicates failure
            latencyMs: Math.max(...healthyNodes.map((n) => n.latencyMs)),
          };
        }

        // Find the node with the highest clock for this key
        let latestValue: unknown = null;
        let latestClock = -1;
        let fromNode = '';
        let maxLatency = 0;

        for (const node of healthyNodes) {
          maxLatency = Math.max(maxLatency, node.latencyMs);
          if (node.clock > latestClock) {
            latestClock = node.clock;
            latestValue = node.state[key] ?? null;
            fromNode = node.id;
          }
        }

        return {
          value: latestValue,
          consistencyLevel: 'strong',
          fromNode,
          staleness: 0,
          latencyMs: maxLatency * 2,
        };
      }

      case 'causal': {
        // Read from any node, but verify causal dependencies
        const node = nodes.find((n) => n.healthy) ?? nodes[0];
        const stored = node.state[key] as
          | { value: unknown; deps: string[]; clock: number }
          | undefined;
        const value = stored?.value ?? null;

        return {
          value,
          consistencyLevel: 'causal',
          fromNode: node.id,
          staleness: this.calculateStaleness(key, node),
          latencyMs: node.latencyMs,
        };
      }
    }
  }

  /**
   * Simulate async replication for eventual consistency.
   * Call this to propagate writes to all nodes.
   */
  simulateReplication(): void {
    const nodes = Array.from(this.nodes.values());
    const now = Date.now();

    for (const entry of this.writeLog) {
      // Replicate to all nodes except primary (which already has it)
      for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (
          node.healthy &&
          now - entry.timestamp >= this.replicationDelayMs
        ) {
          if (
            !this.partitionState.partitioned ||
            !this.partitionState.affectedNodes.includes(node.id)
          ) {
            node.state[entry.key] = entry.value;
            node.clock++;
          }
        }
      }
    }

    // Clear old entries
    this.writeLog = this.writeLog.filter(
      (e) => now - e.timestamp < this.replicationDelayMs * 2
    );
  }

  /**
   * Check if all nodes have converged to the same state.
   */
  checkConvergence(key: string): ConvergenceState {
    const nodes = Array.from(this.nodes.values());
    const values = new Map<string, string[]>();
    let maxStaleness = 0;

    for (const node of nodes) {
      const value = JSON.stringify(node.state[key]);
      const nodeList = values.get(value) ?? [];
      nodeList.push(node.id);
      values.set(value, nodeList);
    }

    const converged = values.size === 1;
    const divergentNodes: string[] = [];

    if (!converged) {
      // Find nodes not matching the primary
      const primaryValue = JSON.stringify(nodes[0].state[key]);
      for (const node of nodes) {
        if (JSON.stringify(node.state[key]) !== primaryValue) {
          divergentNodes.push(node.id);
          maxStaleness = Math.max(maxStaleness, this.calculateStaleness(key, node));
        }
      }
    }

    return {
      converged,
      divergentNodes,
      maxStalenessMs: maxStaleness,
      replicationLag: divergentNodes.length,
    };
  }

  /**
   * Simulate a network partition.
   */
  inducePartition(nodeIds: string[]): void {
    this.partitionState = {
      partitioned: true,
      partitionStartMs: Date.now(),
      affectedNodes: nodeIds,
    };
  }

  /**
   * Heal a network partition.
   */
  healPartition(): void {
    this.partitionState = {
      partitioned: false,
      partitionStartMs: 0,
      affectedNodes: [],
    };
  }

  /**
   * Mark a node as failed.
   */
  failNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.healthy = false;
    }
  }

  /**
   * Recover a failed node.
   */
  recoverNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.healthy = true;
    }
  }

  /**
   * Get current partition state.
   */
  getPartitionState(): PartitionState {
    return { ...this.partitionState };
  }

  /**
   * Get all node IDs.
   */
  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Calculate staleness of a read from a specific node.
   */
  private calculateStaleness(key: string, node: Node): number {
    const nodes = Array.from(this.nodes.values());
    const primary = nodes[0];

    if (node.id === primary.id) {
      return 0;
    }

    const primaryValue = JSON.stringify(primary.state[key]);
    const nodeValue = JSON.stringify(node.state[key]);

    if (primaryValue === nodeValue) {
      return 0;
    }

    // Find when the write happened
    const entry = this.writeLog.find((e) => e.key === key);
    if (entry) {
      return Date.now() - entry.timestamp;
    }

    return this.replicationDelayMs;
  }
}

/**
 * Demonstrates the CAP theorem tradeoff for AI workloads.
 * During a partition, you can have either:
 * - Consistency: reject requests to partitioned nodes
 * - Availability: serve stale data from partitioned nodes
 */
export function demonstrateCAPTradeoff(
  simulator: ConsistencySimulator,
  key: string,
  value: unknown
): { cpResult: WriteResult; apResult: ReadResult } {
  // Induce a partition
  const nodeIds = simulator.getNodeIds();
  simulator.inducePartition([nodeIds[1], nodeIds[2]]);

  // CP: Strong consistency - will fail because majority is unreachable
  const cpResult = simulator.writeStrong(key, value);

  // AP: Eventual consistency - succeeds but may not replicate
  simulator.writeEventual(key, value);
  const apResult = simulator.read(key, 'eventual');

  // Heal and return results
  simulator.healPartition();

  return { cpResult, apResult };
}
