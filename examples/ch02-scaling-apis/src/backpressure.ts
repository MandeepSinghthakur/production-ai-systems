// Backpressure handling for streaming APIs.
//
// The key insight: when a client cannot consume data as fast as the
// server produces it, the server must either buffer, drop, or pause.
// Without backpressure, memory grows unbounded until OOM.

import type {
  BackpressureConfig,
  BackpressureSignal,
  StreamConnection,
} from './types.ts';

const DEFAULT_CONFIG: BackpressureConfig = {
  highWaterMark: 1024 * 16,     // 16 KB - pause producing above this
  lowWaterMark: 1024 * 4,       // 4 KB - resume producing below this
  maxBufferSize: 1024 * 64,     // 64 KB - abort if exceeded
  pauseThresholdMs: 5000,       // Abort if paused longer than this
};

/**
 * A buffer that implements backpressure signaling.
 */
export class BackpressureBuffer {
  private config: BackpressureConfig;
  private buffer: string[];
  private bufferSize: number;
  private isPaused: boolean;
  private pausedAt: number | null;
  private signals: BackpressureSignal[];
  private connectionId: string;

  constructor(connectionId: string, config?: Partial<BackpressureConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = [];
    this.bufferSize = 0;
    this.isPaused = false;
    this.pausedAt = null;
    this.signals = [];
    this.connectionId = connectionId;
  }

  /**
   * Write data to the buffer. Returns backpressure signal if needed.
   */
  write(chunk: string): BackpressureSignal | null {
    const chunkSize = Buffer.byteLength(chunk, 'utf8');

    // Check if we would exceed max buffer
    if (this.bufferSize + chunkSize > this.config.maxBufferSize) {
      const signal: BackpressureSignal = {
        type: 'abort',
        connectionId: this.connectionId,
        reason: 'Buffer overflow - client too slow',
        timestamp: Date.now(),
      };
      this.signals.push(signal);
      return signal;
    }

    this.buffer.push(chunk);
    this.bufferSize += chunkSize;

    // Check if we need to pause
    if (!this.isPaused && this.bufferSize >= this.config.highWaterMark) {
      this.isPaused = true;
      this.pausedAt = Date.now();
      const signal: BackpressureSignal = {
        type: 'pause',
        connectionId: this.connectionId,
        reason: 'Buffer high water mark reached',
        timestamp: Date.now(),
      };
      this.signals.push(signal);
      return signal;
    }

    return null;
  }

  /**
   * Read data from the buffer. Returns resume signal if appropriate.
   */
  read(): { chunk: string | null; signal: BackpressureSignal | null } {
    if (this.buffer.length === 0) {
      return { chunk: null, signal: null };
    }

    const chunk = this.buffer.shift();
    if (chunk) {
      this.bufferSize -= Buffer.byteLength(chunk, 'utf8');
    }

    // Check if we can resume
    if (this.isPaused && this.bufferSize <= this.config.lowWaterMark) {
      this.isPaused = false;
      this.pausedAt = null;
      const signal: BackpressureSignal = {
        type: 'resume',
        connectionId: this.connectionId,
        reason: 'Buffer low water mark reached',
        timestamp: Date.now(),
      };
      this.signals.push(signal);
      return { chunk: chunk ?? null, signal };
    }

    return { chunk: chunk ?? null, signal: null };
  }

  /**
   * Check if the pause has exceeded the threshold.
   */
  checkPauseTimeout(): BackpressureSignal | null {
    if (!this.isPaused || !this.pausedAt) {
      return null;
    }

    const pauseDuration = Date.now() - this.pausedAt;
    if (pauseDuration > this.config.pauseThresholdMs) {
      const signal: BackpressureSignal = {
        type: 'abort',
        connectionId: this.connectionId,
        reason: `Pause exceeded threshold: ${pauseDuration}ms > ${this.config.pauseThresholdMs}ms`,
        timestamp: Date.now(),
      };
      this.signals.push(signal);
      return signal;
    }

    return null;
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  getBufferSize(): number {
    return this.bufferSize;
  }

  getBufferCount(): number {
    return this.buffer.length;
  }

  getSignalHistory(): BackpressureSignal[] {
    return [...this.signals];
  }

  getConfig(): BackpressureConfig {
    return { ...this.config };
  }
}

/**
 * A producer that respects backpressure signals.
 */
export class BackpressureProducer {
  private buffer: BackpressureBuffer;
  private producerPaused: boolean;
  private totalProduced: number;
  private totalPauses: number;
  private aborted: boolean;
  private abortReason: string | null;

  constructor(buffer: BackpressureBuffer) {
    this.buffer = buffer;
    this.producerPaused = false;
    this.totalProduced = 0;
    this.totalPauses = 0;
    this.aborted = false;
    this.abortReason = null;
  }

  /**
   * Try to produce a chunk. Returns false if paused or aborted.
   */
  produce(chunk: string): boolean {
    if (this.aborted) {
      return false;
    }

    if (this.producerPaused) {
      return false;
    }

    const signal = this.buffer.write(chunk);
    if (signal) {
      this.handleSignal(signal);
      if (signal.type === 'abort') {
        return false;
      }
    }

    this.totalProduced++;
    return true;
  }

  private handleSignal(signal: BackpressureSignal): void {
    switch (signal.type) {
      case 'pause':
        this.producerPaused = true;
        this.totalPauses++;
        break;
      case 'resume':
        this.producerPaused = false;
        break;
      case 'abort':
        this.aborted = true;
        this.abortReason = signal.reason ?? 'Unknown';
        break;
    }
  }

  /**
   * Check if producer can continue.
   */
  canProduce(): boolean {
    if (this.aborted) return false;

    // Check for pause timeout
    const timeoutSignal = this.buffer.checkPauseTimeout();
    if (timeoutSignal) {
      this.handleSignal(timeoutSignal);
      return false;
    }

    return !this.producerPaused;
  }

  /**
   * Notify that consumer has read data.
   * Check if buffer is below low water mark to resume.
   */
  notifyConsumption(): void {
    // Check if we should resume (buffer drained below low water mark)
    if (this.producerPaused) {
      const bufferSize = this.buffer.getBufferSize();
      const config = this.buffer.getConfig();
      if (bufferSize <= config.lowWaterMark) {
        this.producerPaused = false;
      }
    }
  }

  /**
   * Check buffer state and update pause status.
   * Called to sync producer state with buffer state.
   */
  syncWithBuffer(): void {
    if (this.producerPaused && !this.buffer.isPausedState()) {
      this.producerPaused = false;
    }
  }

  isAborted(): boolean {
    return this.aborted;
  }

  getAbortReason(): string | null {
    return this.abortReason;
  }

  getTotalProduced(): number {
    return this.totalProduced;
  }

  getTotalPauses(): number {
    return this.totalPauses;
  }
}

/**
 * Simulates a slow consumer that triggers backpressure.
 * The key insight: with backpressure, a slow consumer still receives all data
 * because the producer waits. Without backpressure, data would be dropped or
 * memory would overflow.
 */
export async function simulateSlowConsumer(
  chunkCount: number,
  produceIntervalMs: number,
  consumeIntervalMs: number,
  config?: Partial<BackpressureConfig>
): Promise<{
  chunksProduced: number;
  chunksConsumed: number;
  pauseCount: number;
  aborted: boolean;
  abortReason: string | null;
  peakBufferSize: number;
}> {
  const buffer = new BackpressureBuffer('slow-consumer-test', config);
  const producer = new BackpressureProducer(buffer);

  let chunksProduced = 0;
  let chunksConsumed = 0;
  let peakBufferSize = 0;
  let producerDone = false;

  // Producer task - produces at produceIntervalMs rate
  const producerTask = (async () => {
    for (let i = 0; i < chunkCount && !producer.isAborted(); i++) {
      // Wait until we can produce (backpressure coordination)
      let waitIterations = 0;
      while (!producer.canProduce() && !producer.isAborted()) {
        // Sync with buffer state (consumer may have drained it)
        producer.syncWithBuffer();
        await sleep(2);
        waitIterations++;
        if (waitIterations > 2000) break; // Safety exit after 4 seconds
      }

      if (producer.isAborted()) break;

      const chunk = `chunk-${i}-${'x'.repeat(100)}`; // ~110 bytes per chunk
      if (producer.produce(chunk)) {
        chunksProduced++;
        const currentSize = buffer.getBufferSize();
        if (currentSize > peakBufferSize) {
          peakBufferSize = currentSize;
        }
      }

      await sleep(produceIntervalMs);
    }
    producerDone = true;
  })();

  // Consumer task - consumes at consumeIntervalMs rate (slower)
  const consumerTask = (async () => {
    // Continue until producer is done AND buffer is completely drained
    let consecutiveEmptyReads = 0;

    while (true) {
      const { chunk } = buffer.read();
      if (chunk) {
        chunksConsumed++;
        producer.notifyConsumption();
        consecutiveEmptyReads = 0;
      } else {
        consecutiveEmptyReads++;
      }

      await sleep(consumeIntervalMs);

      // Only exit when producer is done, buffer is empty, and we've
      // confirmed it with multiple empty reads
      if (producerDone && buffer.getBufferCount() === 0) {
        if (consecutiveEmptyReads >= 3) {
          break;
        }
      }

      // Safety exit on abort - drain what remains
      if (producer.isAborted()) {
        while (buffer.getBufferCount() > 0) {
          const result = buffer.read();
          if (result.chunk) chunksConsumed++;
        }
        break;
      }
    }
  })();

  await Promise.all([producerTask, consumerTask]);

  return {
    chunksProduced,
    chunksConsumed,
    pauseCount: producer.getTotalPauses(),
    aborted: producer.isAborted(),
    abortReason: producer.getAbortReason(),
    peakBufferSize,
  };
}

/**
 * Demonstrates backpressure preventing memory overflow.
 */
export async function demonstrateBackpressurePreventsOverflow(
  chunksToAttempt: number,
  maxBufferSize: number
): Promise<{
  chunksAttempted: number;
  chunksProduced: number;
  bufferOverflowPrevented: boolean;
  peakBufferSize: number;
}> {
  const buffer = new BackpressureBuffer('overflow-test', {
    highWaterMark: maxBufferSize / 2,
    lowWaterMark: maxBufferSize / 4,
    maxBufferSize,
    pauseThresholdMs: 100, // Short timeout for test
  });
  const producer = new BackpressureProducer(buffer);

  let chunksProduced = 0;
  let peakBufferSize = 0;

  // Fast producer, no consumer
  for (let i = 0; i < chunksToAttempt && !producer.isAborted(); i++) {
    // Check if we can produce (will check timeout)
    if (!producer.canProduce()) {
      // Wait a bit and check again
      await sleep(10);
      if (!producer.canProduce()) {
        break;
      }
    }

    const chunk = `chunk-${i}-${'x'.repeat(100)}`;
    if (producer.produce(chunk)) {
      chunksProduced++;
      const currentSize = buffer.getBufferSize();
      if (currentSize > peakBufferSize) {
        peakBufferSize = currentSize;
      }
    }
  }

  return {
    chunksAttempted: chunksToAttempt,
    chunksProduced,
    bufferOverflowPrevented: peakBufferSize <= maxBufferSize,
    peakBufferSize,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
