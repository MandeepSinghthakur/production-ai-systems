// Streaming connection management for LLM APIs.
//
// The key insight: streaming responses hold connections open for seconds
// or tens of seconds. This changes capacity planning fundamentally -
// you size for concurrent connections, not requests per second.

import type {
  APIRequest,
  StreamConnection,
  InstanceConfig,
} from './types.ts';

/**
 * A streaming response that delivers chunks over time.
 */
export class StreamingResponse {
  private connection: StreamConnection;
  private chunks: string[];
  private chunkIndex: number;
  private chunkIntervalMs: number;
  private paused: boolean;
  private aborted: boolean;
  private onChunk: ((chunk: string, connection: StreamConnection) => void) | null;
  private onComplete: ((connection: StreamConnection) => void) | null;
  private onAbort: ((connection: StreamConnection, reason: string) => void) | null;

  constructor(
    requestId: string,
    instanceId: string,
    totalChunks: number,
    chunkIntervalMs: number
  ) {
    this.connection = {
      id: `conn-${requestId}`,
      requestId,
      instanceId,
      startedAt: Date.now(),
      chunksDelivered: 0,
      totalChunks,
      bytesDelivered: 0,
      state: 'active',
    };
    this.chunks = this.generateChunks(totalChunks);
    this.chunkIndex = 0;
    this.chunkIntervalMs = chunkIntervalMs;
    this.paused = false;
    this.aborted = false;
    this.onChunk = null;
    this.onComplete = null;
    this.onAbort = null;
  }

  private generateChunks(count: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
      // Simulate variable chunk sizes like real LLM streaming
      const words = Math.floor(Math.random() * 5) + 1;
      let chunk = '';
      for (let w = 0; w < words; w++) {
        chunk += `word${i}_${w} `;
      }
      chunks.push(chunk.trim());
    }
    return chunks;
  }

  /**
   * Start streaming chunks. Returns a promise that resolves when complete.
   */
  async stream(): Promise<StreamConnection> {
    while (this.chunkIndex < this.chunks.length && !this.aborted) {
      if (this.paused) {
        await this.sleep(10);
        continue;
      }

      const chunk = this.chunks[this.chunkIndex];
      this.connection.chunksDelivered++;
      this.connection.bytesDelivered += Buffer.byteLength(chunk, 'utf8');
      this.chunkIndex++;

      if (this.onChunk) {
        this.onChunk(chunk, { ...this.connection });
      }

      if (this.chunkIndex < this.chunks.length) {
        await this.sleep(this.chunkIntervalMs);
      }
    }

    if (this.aborted) {
      this.connection.state = 'aborted';
      if (this.onAbort) {
        this.onAbort({ ...this.connection }, 'Client abort');
      }
    } else {
      this.connection.state = 'completed';
      if (this.onComplete) {
        this.onComplete({ ...this.connection });
      }
    }

    return { ...this.connection };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  abort(reason: string): void {
    this.aborted = true;
    if (this.onAbort) {
      this.onAbort({ ...this.connection }, reason);
    }
  }

  setOnChunk(
    callback: (chunk: string, connection: StreamConnection) => void
  ): void {
    this.onChunk = callback;
  }

  setOnComplete(callback: (connection: StreamConnection) => void): void {
    this.onComplete = callback;
  }

  setOnAbort(
    callback: (connection: StreamConnection, reason: string) => void
  ): void {
    this.onAbort = callback;
  }

  getConnection(): StreamConnection {
    return { ...this.connection };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Manages multiple streaming connections with connection limits.
 */
export class StreamConnectionManager {
  private maxConnections: number;
  private activeConnections: Map<string, StreamingResponse>;
  private completedConnections: StreamConnection[];
  private abortedConnections: StreamConnection[];
  private waitingQueue: Array<{
    request: APIRequest;
    resolve: (response: StreamingResponse | null) => void;
  }>;

  constructor(maxConnections: number) {
    this.maxConnections = maxConnections;
    this.activeConnections = new Map();
    this.completedConnections = [];
    this.abortedConnections = [];
    this.waitingQueue = [];
  }

  /**
   * Try to establish a new streaming connection.
   * Returns null if at capacity.
   */
  tryConnect(
    request: APIRequest,
    instanceId: string,
    totalChunks: number,
    chunkIntervalMs: number
  ): StreamingResponse | null {
    if (this.activeConnections.size >= this.maxConnections) {
      return null;
    }

    const stream = new StreamingResponse(
      request.id,
      instanceId,
      totalChunks,
      chunkIntervalMs
    );

    const connId = stream.getConnection().id;
    this.activeConnections.set(connId, stream);

    // Set up completion handlers
    stream.setOnComplete((conn) => {
      this.activeConnections.delete(conn.id);
      this.completedConnections.push(conn);
      this.drainWaitingQueue();
    });

    stream.setOnAbort((conn, _reason) => {
      this.activeConnections.delete(conn.id);
      this.abortedConnections.push(conn);
      this.drainWaitingQueue();
    });

    return stream;
  }

  /**
   * Queue a connection request when at capacity.
   * Returns a promise that resolves when a slot opens.
   */
  async queueConnection(
    request: APIRequest,
    instanceId: string,
    totalChunks: number,
    chunkIntervalMs: number,
    timeoutMs: number
  ): Promise<StreamingResponse | null> {
    // Try immediate connection first
    const immediate = this.tryConnect(
      request,
      instanceId,
      totalChunks,
      chunkIntervalMs
    );
    if (immediate) return immediate;

    // Queue and wait
    return new Promise((resolve) => {
      const entry = { request, resolve };
      this.waitingQueue.push(entry);

      // Timeout handler
      setTimeout(() => {
        const idx = this.waitingQueue.indexOf(entry);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  private drainWaitingQueue(): void {
    while (
      this.waitingQueue.length > 0 &&
      this.activeConnections.size < this.maxConnections
    ) {
      const entry = this.waitingQueue.shift();
      if (!entry) break;

      const stream = new StreamingResponse(
        entry.request.id,
        'queued-instance',
        10,
        10
      );

      const connId = stream.getConnection().id;
      this.activeConnections.set(connId, stream);

      stream.setOnComplete((conn) => {
        this.activeConnections.delete(conn.id);
        this.completedConnections.push(conn);
        this.drainWaitingQueue();
      });

      stream.setOnAbort((conn, _reason) => {
        this.activeConnections.delete(conn.id);
        this.abortedConnections.push(conn);
        this.drainWaitingQueue();
      });

      entry.resolve(stream);
    }
  }

  getActiveCount(): number {
    return this.activeConnections.size;
  }

  getCompletedCount(): number {
    return this.completedConnections.length;
  }

  getAbortedCount(): number {
    return this.abortedConnections.length;
  }

  getMaxConnections(): number {
    return this.maxConnections;
  }

  /**
   * Calculate the average connection duration for completed connections.
   */
  getAverageConnectionDurationMs(): number {
    if (this.completedConnections.length === 0) return 0;

    const now = Date.now();
    let total = 0;
    for (const conn of this.completedConnections) {
      // Estimate duration from chunks * interval
      total += conn.chunksDelivered * 10; // Approximate
    }
    return total / this.completedConnections.length;
  }

  /**
   * Get all active connection states.
   */
  getActiveConnections(): StreamConnection[] {
    const connections: StreamConnection[] = [];
    for (const stream of this.activeConnections.values()) {
      connections.push(stream.getConnection());
    }
    return connections;
  }
}

/**
 * Demonstrates that streaming connections hold resources for the
 * duration of the response, not just the request processing time.
 */
export async function demonstrateStreamingHold(
  connectionLimit: number,
  totalChunks: number,
  chunkIntervalMs: number
): Promise<{
  connectionsAttempted: number;
  connectionsAccepted: number;
  connectionsRejected: number;
  avgHoldTimeMs: number;
  peakConcurrentConnections: number;
}> {
  const manager = new StreamConnectionManager(connectionLimit);

  const requests: APIRequest[] = [];
  for (let i = 0; i < connectionLimit + 5; i++) {
    requests.push({
      id: `stream-req-${i}`,
      tenantId: 'tenant-1',
      payload: `Streaming request ${i}`,
      estimatedTokens: 500,
      streaming: true,
      arrivedAt: Date.now(),
    });
  }

  let accepted = 0;
  let rejected = 0;
  let peakConcurrent = 0;
  const startTimes: Map<string, number> = new Map();
  const holdTimes: number[] = [];

  // Try to establish all connections at once
  const streams: Array<StreamingResponse | null> = [];
  for (const req of requests) {
    const stream = manager.tryConnect(
      req,
      'instance-1',
      totalChunks,
      chunkIntervalMs
    );
    if (stream) {
      accepted++;
      startTimes.set(stream.getConnection().id, Date.now());
    } else {
      rejected++;
    }
    streams.push(stream);

    const current = manager.getActiveCount();
    if (current > peakConcurrent) {
      peakConcurrent = current;
    }
  }

  // Start streaming on all accepted connections
  const streamPromises: Promise<StreamConnection>[] = [];
  for (const stream of streams) {
    if (stream) {
      streamPromises.push(stream.stream());
    }
  }

  // Wait for all to complete
  const completed = await Promise.all(streamPromises);

  // Calculate hold times
  for (const conn of completed) {
    const startTime = startTimes.get(conn.id);
    if (startTime) {
      holdTimes.push(Date.now() - startTime);
    }
  }

  const avgHoldTime =
    holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 0;

  return {
    connectionsAttempted: requests.length,
    connectionsAccepted: accepted,
    connectionsRejected: rejected,
    avgHoldTimeMs: avgHoldTime,
    peakConcurrentConnections: peakConcurrent,
  };
}

/**
 * Calculate required connection capacity for a given throughput.
 *
 * Formula: connections = requests_per_second * avg_connection_duration_seconds
 */
export function calculateConnectionCapacity(
  requestsPerSecond: number,
  avgTokensPerResponse: number,
  tokensPerSecond: number
): {
  avgConnectionDurationMs: number;
  requiredConnections: number;
  headroom20Percent: number;
} {
  // Calculate how long a connection is held
  const avgConnectionDurationMs = (avgTokensPerResponse / tokensPerSecond) * 1000;

  // Little's Law: L = lambda * W
  // connections = arrival_rate * service_time
  const requiredConnections =
    requestsPerSecond * (avgConnectionDurationMs / 1000);

  // Add 20% headroom for variance
  const headroom20Percent = Math.ceil(requiredConnections * 1.2);

  return {
    avgConnectionDurationMs,
    requiredConnections: Math.ceil(requiredConnections),
    headroom20Percent,
  };
}
