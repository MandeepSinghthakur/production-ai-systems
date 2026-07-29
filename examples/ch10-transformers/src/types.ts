// Core types for transformer inference modeling.
// See Chapter 10, "Core Concepts".

export interface ModelConfig {
  name: string;
  hiddenSize: number;       // d_model, e.g., 4096 for a 7B model
  numLayers: number;        // number of transformer blocks
  numHeads: number;         // attention heads
  headDim: number;          // dimension per head (hiddenSize / numHeads)
  vocabSize: number;        // vocabulary size for embeddings
  maxSeqLen: number;        // maximum context window
  bytesPerParam: number;    // 2 for fp16, 4 for fp32
}

export interface AttentionResult {
  queryShape: [number, number, number];   // [batch, seq, heads * headDim]
  keyShape: [number, number, number];
  valueShape: [number, number, number];
  attentionScoresShape: [number, number, number, number]; // [batch, heads, seq, seq]
  flops: number;
  memoryBytes: number;
}

export interface KVCacheEntry {
  sequenceId: string;
  keys: number[][];         // [layer][position * headDim]
  values: number[][];       // [layer][position * headDim]
  length: number;           // current sequence length
  maxLength: number;        // allocated capacity
  memoryBytes: number;
}

export interface KVCacheStats {
  totalEntries: number;
  totalMemoryBytes: number;
  avgSequenceLength: number;
  hitRate: number;
  evictions: number;
}

export interface BatchConfig {
  maxBatchSize: number;
  maxTotalTokens: number;   // total tokens across all sequences
  paddingStrategy: 'left' | 'right' | 'none';
}

export interface BatchedRequest {
  sequenceId: string;
  inputTokens: number[];
  currentLength: number;
  maxNewTokens: number;
  priority: number;
}

export interface BatchResult {
  batchSize: number;
  totalInputTokens: number;
  paddingTokens: number;
  paddingOverhead: number;  // paddingTokens / totalInputTokens
  throughputTokensPerSec: number;
  latencyMs: number;
}

export interface PhaseMetrics {
  phase: 'prefill' | 'decode';
  tokens: number;
  durationMs: number;
  tokensPerSec: number;
  memoryPeakBytes: number;
  computeUtilization: number; // 0-1, how much of theoretical FLOPS used
  memoryBandwidthUtilization: number; // 0-1
}

export interface GenerationMetrics {
  prefill: PhaseMetrics;
  decode: PhaseMetrics;
  timeToFirstToken: number;   // prefill duration
  totalDuration: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GPUSpec {
  name: string;
  memoryBytes: number;
  flops: number;              // theoretical peak FLOPS
  memoryBandwidth: number;    // bytes per second
}
