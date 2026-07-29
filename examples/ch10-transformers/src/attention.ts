// Simplified attention mechanism simulation.
// Models the computational structure without actual neural network math.
// See Chapter 10, "Internal Architecture".

import type { ModelConfig, AttentionResult } from './types.ts';

// Standard model configurations for reference
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'small-1b': {
    name: 'small-1b',
    hiddenSize: 2048,
    numLayers: 24,
    numHeads: 16,
    headDim: 128,
    vocabSize: 32000,
    maxSeqLen: 4096,
    bytesPerParam: 2,
  },
  'mid-7b': {
    name: 'mid-7b',
    hiddenSize: 4096,
    numLayers: 32,
    numHeads: 32,
    headDim: 128,
    vocabSize: 32000,
    maxSeqLen: 8192,
    bytesPerParam: 2,
  },
  'large-70b': {
    name: 'large-70b',
    hiddenSize: 8192,
    numLayers: 80,
    numHeads: 64,
    headDim: 128,
    vocabSize: 128000,  // Larger vocab for 70B class models
    maxSeqLen: 8192,
    bytesPerParam: 2,
  },
};

/**
 * Compute attention mechanism metrics for a given input.
 *
 * The attention formula: Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V
 *
 * Key insight: attention is O(n^2) in sequence length because every token
 * attends to every other token. This is the fundamental scaling bottleneck.
 */
export function computeAttention(
  config: ModelConfig,
  batchSize: number,
  seqLen: number,
): AttentionResult {
  const { hiddenSize, numHeads, headDim } = config;

  // Q, K, V projections: [batch, seq, hidden] -> [batch, seq, hidden]
  const projectionSize = batchSize * seqLen * hiddenSize;

  // Attention scores: [batch, heads, seq, seq]
  // This is where the O(n^2) comes from
  const attentionScoresSize = batchSize * numHeads * seqLen * seqLen;

  // FLOPS calculation for attention
  // QK^T: 2 * batch * heads * seq * seq * headDim (matmul)
  // softmax: ~5 * batch * heads * seq * seq (exp, sum, div)
  // attention * V: 2 * batch * heads * seq * seq * headDim
  const qkFlops = 2 * batchSize * numHeads * seqLen * seqLen * headDim;
  const softmaxFlops = 5 * attentionScoresSize;
  const avFlops = 2 * batchSize * numHeads * seqLen * seqLen * headDim;
  const totalFlops = qkFlops + softmaxFlops + avFlops;

  // Memory: need to store Q, K, V, attention scores
  // Using fp16 (2 bytes per element)
  const memoryBytes = (
    3 * projectionSize * 2 +  // Q, K, V
    attentionScoresSize * 2   // attention scores
  );

  return {
    queryShape: [batchSize, seqLen, numHeads * headDim],
    keyShape: [batchSize, seqLen, numHeads * headDim],
    valueShape: [batchSize, seqLen, numHeads * headDim],
    attentionScoresShape: [batchSize, numHeads, seqLen, seqLen],
    flops: totalFlops,
    memoryBytes,
  };
}

/**
 * Compute FLOPS for a full forward pass through the model.
 * Includes all attention layers plus feed-forward networks.
 */
export function computeForwardPassFlops(
  config: ModelConfig,
  batchSize: number,
  seqLen: number,
): number {
  const { hiddenSize, numLayers, numHeads, headDim } = config;

  // Per layer:
  // 1. QKV projection: 3 * 2 * batch * seq * hidden * hidden
  // 2. Attention: computed above
  // 3. Output projection: 2 * batch * seq * hidden * hidden
  // 4. FFN: typically 2 * 2 * batch * seq * hidden * (4 * hidden)

  const qkvProjection = 3 * 2 * batchSize * seqLen * hiddenSize * hiddenSize;
  const attention = computeAttention(config, batchSize, seqLen).flops;
  const outputProjection = 2 * batchSize * seqLen * hiddenSize * hiddenSize;
  const ffn = 2 * 2 * batchSize * seqLen * hiddenSize * (4 * hiddenSize);

  const perLayer = qkvProjection + attention + outputProjection + ffn;

  return perLayer * numLayers;
}

/**
 * Demonstrate why attention scores grow quadratically with sequence length.
 *
 * Note: Total attention memory includes Q,K,V (linear) plus attention scores
 * (quadratic). This function isolates the attention scores to show pure O(n^2).
 */
export function analyzeAttentionScaling(
  config: ModelConfig,
  sequenceLengths: number[],
): Array<{ seqLen: number; memoryMB: number; ratio: number }> {
  const results: Array<{ seqLen: number; memoryMB: number; ratio: number }> = [];
  let baseMemory: number | null = null;

  for (const seqLen of sequenceLengths) {
    // Only count the attention scores matrix [batch, heads, seq, seq]
    // This is the pure O(n^2) component
    const attentionScoresBytes = config.numHeads * seqLen * seqLen * 2;
    const memoryMB = attentionScoresBytes / (1024 * 1024);

    if (baseMemory === null) {
      baseMemory = memoryMB;
    }

    results.push({
      seqLen,
      memoryMB,
      ratio: memoryMB / baseMemory,
    });
  }

  return results;
}

/**
 * Calculate model parameter count from config.
 */
export function countParameters(config: ModelConfig): number {
  const { hiddenSize, numLayers, vocabSize } = config;

  // Embedding: vocab * hidden
  const embedding = vocabSize * hiddenSize;

  // Per layer:
  // QKV projection: 3 * hidden * hidden
  // Output projection: hidden * hidden
  // FFN: hidden * 4 * hidden + 4 * hidden * hidden = 8 * hidden^2
  // Layer norms: 2 * hidden (negligible)
  const perLayer = 3 * hiddenSize * hiddenSize +
                   hiddenSize * hiddenSize +
                   8 * hiddenSize * hiddenSize;

  // Final layer norm + output projection
  const output = hiddenSize + vocabSize * hiddenSize;

  return embedding + (perLayer * numLayers) + output;
}

/**
 * Calculate model memory requirements.
 */
export function modelMemoryBytes(config: ModelConfig): number {
  return countParameters(config) * config.bytesPerParam;
}
