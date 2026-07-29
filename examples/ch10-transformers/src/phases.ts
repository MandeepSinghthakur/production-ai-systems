// Prefill vs decode phase modeling.
// See Chapter 10, "Core Concepts" and "Production Design".

import type {
  ModelConfig,
  GPUSpec,
  PhaseMetrics,
  GenerationMetrics,
} from './types.ts';
import { computeForwardPassFlops } from './attention.ts';
import { kvCacheMemoryForSequence, kvCacheMemoryPerToken } from './kv-cache.ts';

/**
 * Simulate prefill phase (processing the prompt).
 *
 * Prefill is compute-bound:
 * - Process all input tokens in parallel
 * - High arithmetic intensity (many FLOPS per byte of memory read)
 * - GPU compute utilization is high
 * - This is where context length directly impacts latency
 */
export function simulatePrefill(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  inputTokens: number,
): PhaseMetrics {
  // FLOPS for processing all input tokens
  const flops = computeForwardPassFlops(modelConfig, 1, inputTokens);

  // Memory: model weights + KV cache being written
  const modelMemory = modelConfig.numLayers *
    modelConfig.hiddenSize *
    modelConfig.hiddenSize *
    12 * modelConfig.bytesPerParam;
  const kvMemory = kvCacheMemoryForSequence(modelConfig, inputTokens);
  const totalMemory = modelMemory + kvMemory;

  // Compute time (assuming good utilization)
  const computeUtilization = 0.7; // typical for well-optimized inference
  const effectiveFlops = gpu.flops * computeUtilization;
  const computeTimeMs = (flops / effectiveFlops) * 1000;

  // Memory time (writing KV cache)
  const memoryTimeMs = (kvMemory / gpu.memoryBandwidth) * 1000;

  // Prefill is compute-bound: compute time dominates
  const durationMs = Math.max(computeTimeMs, memoryTimeMs);

  return {
    phase: 'prefill',
    tokens: inputTokens,
    durationMs,
    tokensPerSec: (inputTokens / durationMs) * 1000,
    memoryPeakBytes: totalMemory,
    computeUtilization,
    memoryBandwidthUtilization: memoryTimeMs / durationMs,
  };
}

/**
 * Simulate decode phase (generating output tokens).
 *
 * Decode is memory-bound:
 * - Generate one token at a time (sequential)
 * - Low arithmetic intensity (read all weights for one token)
 * - GPU compute utilization is low
 * - KV cache grows with each token
 *
 * This is why decode is slower per token than prefill.
 */
export function simulateDecode(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  contextLength: number,  // current KV cache size
  outputTokens: number,
): PhaseMetrics {
  // Memory reads per decode step:
  // 1. Model weights (read for each token)
  // 2. KV cache (read all previous keys/values)
  const modelMemory = modelConfig.numLayers *
    modelConfig.hiddenSize *
    modelConfig.hiddenSize *
    12 * modelConfig.bytesPerParam;

  // Average KV cache size during generation
  const avgContextLen = contextLength + outputTokens / 2;
  const avgKvMemory = kvCacheMemoryForSequence(modelConfig, avgContextLen);

  // Total memory read per step
  const memoryPerStep = modelMemory + avgKvMemory;

  // Compute per step (one token)
  const flopsPerStep = computeForwardPassFlops(modelConfig, 1, 1);

  // Memory-bound: time dominated by reading weights and KV cache
  const memoryTimePerStep = memoryPerStep / gpu.memoryBandwidth;
  const computeTimePerStep = flopsPerStep / (gpu.flops * 0.3); // lower utilization

  // Take the slower of the two (memory-bound)
  const timePerStepMs = Math.max(memoryTimePerStep, computeTimePerStep) * 1000;
  const totalDurationMs = timePerStepMs * outputTokens;

  // Peak memory at the end of generation
  const peakKvMemory = kvCacheMemoryForSequence(
    modelConfig,
    contextLength + outputTokens,
  );

  return {
    phase: 'decode',
    tokens: outputTokens,
    durationMs: totalDurationMs,
    tokensPerSec: (outputTokens / totalDurationMs) * 1000,
    memoryPeakBytes: modelMemory + peakKvMemory,
    computeUtilization: computeTimePerStep / Math.max(memoryTimePerStep, computeTimePerStep),
    memoryBandwidthUtilization: memoryTimePerStep / Math.max(memoryTimePerStep, computeTimePerStep),
  };
}

/**
 * Simulate complete generation from prompt to output.
 */
export function simulateGeneration(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  inputTokens: number,
  outputTokens: number,
): GenerationMetrics {
  const prefill = simulatePrefill(modelConfig, gpu, inputTokens);
  const decode = simulateDecode(modelConfig, gpu, inputTokens, outputTokens);

  return {
    prefill,
    decode,
    timeToFirstToken: prefill.durationMs,
    totalDuration: prefill.durationMs + decode.durationMs,
    inputTokens,
    outputTokens,
  };
}

/**
 * Compare generation at different context lengths.
 * Demonstrates why longer contexts are slower.
 */
export function analyzeContextLengthImpact(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  contextLengths: number[],
  outputTokens: number,
): Array<{
  contextLength: number;
  prefillMs: number;
  decodeMs: number;
  totalMs: number;
  ttftRatio: number;
}> {
  const results: Array<{
    contextLength: number;
    prefillMs: number;
    decodeMs: number;
    totalMs: number;
    ttftRatio: number;
  }> = [];

  let baseTtft: number | null = null;

  for (const len of contextLengths) {
    const gen = simulateGeneration(modelConfig, gpu, len, outputTokens);

    if (baseTtft === null) {
      baseTtft = gen.timeToFirstToken;
    }

    results.push({
      contextLength: len,
      prefillMs: gen.prefill.durationMs,
      decodeMs: gen.decode.durationMs,
      totalMs: gen.totalDuration,
      ttftRatio: gen.timeToFirstToken / baseTtft,
    });
  }

  return results;
}

/**
 * Calculate arithmetic intensity to understand compute vs memory bound.
 *
 * Arithmetic intensity = FLOPS / bytes transferred
 *
 * High intensity (> GPU's FLOPS/bandwidth ratio) = compute-bound
 * Low intensity (< GPU's FLOPS/bandwidth ratio) = memory-bound
 */
export function calculateArithmeticIntensity(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
  seqLen: number,
  phase: 'prefill' | 'decode',
): {
  flops: number;
  bytes: number;
  intensity: number;
  gpuRatio: number;
  bound: 'compute' | 'memory';
} {
  const flops = computeForwardPassFlops(modelConfig, 1, phase === 'prefill' ? seqLen : 1);

  // Memory access
  const modelMemory = modelConfig.numLayers *
    modelConfig.hiddenSize *
    modelConfig.hiddenSize *
    12 * modelConfig.bytesPerParam;
  const kvMemory = kvCacheMemoryForSequence(modelConfig, seqLen);
  const bytes = modelMemory + kvMemory;

  const intensity = flops / bytes;
  const gpuRatio = gpu.flops / gpu.memoryBandwidth;

  return {
    flops,
    bytes,
    intensity,
    gpuRatio,
    bound: intensity > gpuRatio ? 'compute' : 'memory',
  };
}

/**
 * Demonstrate the prefill/decode asymmetry with concrete numbers.
 */
export function demonstratePhaseAsymmetry(
  modelConfig: ModelConfig,
  gpu: GPUSpec,
): {
  prefill: { tokens: number; msPerToken: number; bound: string };
  decode: { tokens: number; msPerToken: number; bound: string };
  speedupRatio: number;
} {
  const testTokens = 1000;

  const prefill = simulatePrefill(modelConfig, gpu, testTokens);
  const decode = simulateDecode(modelConfig, gpu, testTokens, testTokens);

  const prefillMsPerToken = prefill.durationMs / testTokens;
  const decodeMsPerToken = decode.durationMs / testTokens;

  return {
    prefill: {
      tokens: testTokens,
      msPerToken: prefillMsPerToken,
      bound: prefill.computeUtilization > 0.5 ? 'compute' : 'memory',
    },
    decode: {
      tokens: testTokens,
      msPerToken: decodeMsPerToken,
      bound: decode.memoryBandwidthUtilization > 0.5 ? 'memory' : 'compute',
    },
    speedupRatio: decodeMsPerToken / prefillMsPerToken,
  };
}
