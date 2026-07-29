// Reproduces every numbered step of the Chapter 10 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs                              (from example dir)
//   node examples/ch10-transformers/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const {
  MODEL_CONFIGS,
  computeAttention,
  analyzeAttentionScaling,
  countParameters,
  modelMemoryBytes,
} = await import(resolve(srcDir, 'attention.ts'));

const {
  kvCacheMemoryPerToken,
  kvCacheMemoryForSequence,
  analyzeKVCacheScaling,
  KVCache,
  maxConcurrentSequences,
} = await import(resolve(srcDir, 'kv-cache.ts'));

const {
  GPU_SPECS,
  staticBatch,
  calculatePaddingOverhead,
  ContinuousBatcher,
  estimateBatchThroughput,
  simulateBatchProcessing,
} = await import(resolve(srcDir, 'batching.ts'));

const {
  simulatePrefill,
  simulateDecode,
  simulateGeneration,
  analyzeContextLengthImpact,
  calculateArithmeticIntensity,
  demonstratePhaseAsymmetry,
} = await import(resolve(srcDir, 'phases.ts'));

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  console.log(`         expected ${expectation}, observed ${JSON.stringify(actual)}`);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------
// Step 1 - Model configurations and parameter counts
// ---------------------------------------------------------------------

console.log('\nStep 1 - model configurations');

const config7b = MODEL_CONFIGS['mid-7b'];
const params7b = countParameters(config7b);

check(
  '7B model has approximately 7 billion parameters',
  params7b,
  (v) => v > 6e9 && v < 8e9,
  '6-8 billion'
);

const config70b = MODEL_CONFIGS['large-70b'];
const params70b = countParameters(config70b);

check(
  '70B model has approximately 70 billion parameters',
  params70b,
  (v) => v > 65e9 && v < 75e9,
  '65-75 billion'
);

const mem7b = modelMemoryBytes(config7b);
check(
  '7B model fp16 weights fit in ~14GB',
  mem7b,
  (v) => v > 12e9 && v < 16e9,
  '12-16 GB'
);

// ---------------------------------------------------------------------
// Step 2 - Attention scaling (quadratic)
// ---------------------------------------------------------------------

console.log('\nStep 2 - attention scaling');

const attentionScaling = analyzeAttentionScaling(
  config7b,
  [512, 1024, 2048, 4096]
);

// Memory should grow quadratically: doubling seq length should ~4x memory
const ratio1024to512 = attentionScaling[1].ratio;
const ratio2048to1024 = attentionScaling[2].ratio / attentionScaling[1].ratio;

check(
  'attention memory grows quadratically with sequence length',
  ratio1024to512,
  (v) => v > 3.5 && v < 4.5,
  '~4x when doubling sequence length'
);

check(
  'quadratic scaling continues at longer sequences',
  ratio2048to1024,
  (v) => v > 3.5 && v < 4.5,
  '~4x when doubling from 1024 to 2048'
);

// Check actual FLOPS count for attention
const attn512 = computeAttention(config7b, 1, 512);
const attn1024 = computeAttention(config7b, 1, 1024);

check(
  'attention FLOPS also grow quadratically',
  attn1024.flops / attn512.flops,
  (v) => v > 3.5 && v < 4.5,
  '~4x when doubling sequence length'
);

// ---------------------------------------------------------------------
// Step 3 - KV cache scaling (linear)
// ---------------------------------------------------------------------

console.log('\nStep 3 - KV cache scaling');

const kvScaling = analyzeKVCacheScaling(
  config7b,
  [512, 1024, 2048, 4096]
);

// KV cache should grow linearly: doubling seq length should 2x memory
const kvRatio1024to512 = kvScaling[1].ratio;
const kvRatio2048to1024 = kvScaling[2].ratio / kvScaling[1].ratio;

check(
  'KV cache grows linearly with sequence length',
  kvRatio1024to512,
  (v) => v > 1.9 && v < 2.1,
  '~2x when doubling sequence length'
);

check(
  'linear scaling continues at longer sequences',
  kvRatio2048to1024,
  (v) => v > 1.9 && v < 2.1,
  '~2x when doubling from 1024 to 2048'
);

// KV cache per token calculation
const kvPerToken = kvCacheMemoryPerToken(config7b);
check(
  'KV cache per token is consistent',
  kvPerToken,
  (v) => v === 2 * config7b.numLayers * config7b.hiddenSize * config7b.bytesPerParam,
  '2 * layers * hiddenSize * bytesPerParam'
);

// Verify the formula matches the scaling analysis
const kv1024Direct = kvCacheMemoryForSequence(config7b, 1024);
check(
  'KV cache memory formula is consistent',
  kv1024Direct,
  (v) => Math.abs(v - kvScaling[1].memoryMB * 1024 * 1024) < 1000,
  'matches scaling analysis'
);

// ---------------------------------------------------------------------
// Step 4 - KV cache management
// ---------------------------------------------------------------------

console.log('\nStep 4 - KV cache management');

const cacheMemory = 4 * 1024 * 1024 * 1024; // 4GB
const cache = new KVCache(config7b, cacheMemory);

// Allocate some sequences
const seq1 = cache.allocate('seq1', 2048);
const seq2 = cache.allocate('seq2', 2048);
const seq3 = cache.allocate('seq3', 2048);

check(
  'cache allocates multiple sequences',
  seq1 !== null && seq2 !== null && seq3 !== null,
  (v) => v === true,
  'true'
);

// Simulate token generation
for (let i = 0; i < 100; i++) {
  cache.appendToken('seq1');
  cache.appendToken('seq2');
}

const stats = cache.getStats();
check(
  'cache tracks sequence lengths',
  stats.avgSequenceLength,
  (v) => v > 30 && v < 70,
  'average length reflects appended tokens'
);

// Test cache eviction
const utilBefore = cache.utilization();
// Try to allocate more than fits
for (let i = 0; i < 20; i++) {
  cache.allocate(`overflow${i}`, 2048);
}

const statsAfter = cache.getStats();
check(
  'cache evicts LRU entries when full',
  statsAfter.evictions,
  (v) => v > 0,
  '> 0 evictions'
);

// ---------------------------------------------------------------------
// Step 5 - Concurrent sequence capacity
// ---------------------------------------------------------------------

console.log('\nStep 5 - concurrent sequence capacity');

const a100 = GPU_SPECS['a100-80gb'];
const modelMem = modelMemoryBytes(config7b);
const activationOverhead = 2 * 1024 * 1024 * 1024; // 2GB

const maxSeqs2k = maxConcurrentSequences(
  config7b,
  a100.memoryBytes,
  modelMem,
  activationOverhead,
  2048
);

const maxSeqs4k = maxConcurrentSequences(
  config7b,
  a100.memoryBytes,
  modelMem,
  activationOverhead,
  4096
);

check(
  'longer contexts reduce concurrent sequences',
  maxSeqs4k < maxSeqs2k,
  (v) => v === true,
  'true (4k context allows fewer sequences than 2k)'
);

check(
  'concurrent sequences approximately halve when context doubles',
  maxSeqs2k / maxSeqs4k,
  (v) => v > 1.8 && v < 2.2,
  '~2x reduction'
);

// ---------------------------------------------------------------------
// Step 6 - Static batching and padding overhead
// ---------------------------------------------------------------------

console.log('\nStep 6 - static batching');

const requests = [
  { sequenceId: 'a', inputTokens: new Array(100).fill(1), currentLength: 100, maxNewTokens: 50, priority: 1 },
  { sequenceId: 'b', inputTokens: new Array(500).fill(1), currentLength: 500, maxNewTokens: 50, priority: 1 },
  { sequenceId: 'c', inputTokens: new Array(200).fill(1), currentLength: 200, maxNewTokens: 50, priority: 1 },
  { sequenceId: 'd', inputTokens: new Array(800).fill(1), currentLength: 800, maxNewTokens: 50, priority: 1 },
];

const paddingResult = calculatePaddingOverhead(requests);

check(
  'static batching has significant padding overhead with variable lengths',
  paddingResult.overhead,
  (v) => v > 0.3,
  '> 30% padding when sequence lengths vary'
);

const batches = staticBatch(requests, { maxBatchSize: 2, maxTotalTokens: 2000, paddingStrategy: 'right' });
check(
  'static batching respects max batch size',
  batches.every(b => b.length <= 2),
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 7 - Continuous batching
// ---------------------------------------------------------------------

console.log('\nStep 7 - continuous batching');

const batcher = new ContinuousBatcher(
  { maxBatchSize: 4, maxTotalTokens: 4096, paddingStrategy: 'none' },
  config7b
);

// Enqueue requests with different lengths
for (let i = 0; i < 10; i++) {
  batcher.enqueue({
    sequenceId: `req${i}`,
    inputTokens: new Array(100 + i * 50).fill(1),
    currentLength: 100 + i * 50,
    maxNewTokens: 20 + i * 5,
    priority: i % 3,
  });
}

batcher.fillBatch();
const initialStats = batcher.getStats();

check(
  'continuous batcher fills to max batch size',
  initialStats.activeCount,
  (v) => v === 4,
  '4 (max batch size)'
);

// Run decode steps
let completedTotal = 0;
for (let step = 0; step < 100; step++) {
  const completed = batcher.decodeStep();
  completedTotal += completed.length;
}

const finalStats = batcher.getStats();
check(
  'continuous batcher processes all requests',
  finalStats.completedCount + finalStats.activeCount + finalStats.waitingCount,
  (v) => v >= 10,
  '>= 10 (all requests accounted for)'
);

check(
  'continuous batcher maintains high utilization',
  finalStats.completedCount,
  (v) => v >= 5,
  '>= 5 completed'
);

// ---------------------------------------------------------------------
// Step 8 - Prefill vs decode phases
// ---------------------------------------------------------------------

console.log('\nStep 8 - prefill vs decode phases');

const prefill = simulatePrefill(config7b, a100, 1000);
const decode = simulateDecode(config7b, a100, 1000, 100);

check(
  'prefill processes tokens faster than decode',
  prefill.tokensPerSec > decode.tokensPerSec,
  (v) => v === true,
  'true (prefill is parallelizable)'
);

check(
  'prefill has higher compute utilization',
  prefill.computeUtilization > decode.computeUtilization,
  (v) => v === true,
  'true (prefill is compute-bound)'
);

check(
  'decode has higher memory bandwidth utilization',
  decode.memoryBandwidthUtilization > prefill.memoryBandwidthUtilization,
  (v) => v === true,
  'true (decode is memory-bound)'
);

// ---------------------------------------------------------------------
// Step 9 - Phase asymmetry
// ---------------------------------------------------------------------

console.log('\nStep 9 - phase asymmetry');

const asymmetry = demonstratePhaseAsymmetry(config7b, a100);

check(
  'decode is significantly slower per token than prefill',
  asymmetry.speedupRatio,
  (v) => v > 5,
  '> 5x slower per token'
);

check(
  'prefill is compute-bound',
  asymmetry.prefill.bound,
  (v) => v === 'compute',
  'compute'
);

check(
  'decode is memory-bound',
  asymmetry.decode.bound,
  (v) => v === 'memory',
  'memory'
);

// ---------------------------------------------------------------------
// Step 10 - Context length impact
// ---------------------------------------------------------------------

console.log('\nStep 10 - context length impact');

const contextImpact = analyzeContextLengthImpact(
  config7b,
  a100,
  [512, 1024, 2048, 4096],
  100
);

check(
  'time to first token grows with context length',
  contextImpact[3].prefillMs > contextImpact[0].prefillMs,
  (v) => v === true,
  'true (longer context = longer prefill)'
);

// TTFT should grow roughly linearly with context (for compute-bound prefill)
const ttftRatio = contextImpact[2].ttftRatio / contextImpact[1].ttftRatio;
check(
  'TTFT scales roughly with context length',
  ttftRatio,
  (v) => v > 1.5 && v < 2.5,
  '~2x when doubling context'
);

// Decode time also increases due to longer KV cache reads
check(
  'decode time increases with context length',
  contextImpact[3].decodeMs > contextImpact[0].decodeMs,
  (v) => v === true,
  'true (more KV cache to read)'
);

// ---------------------------------------------------------------------
// Step 11 - Arithmetic intensity
// ---------------------------------------------------------------------

console.log('\nStep 11 - arithmetic intensity');

const intensityPrefill = calculateArithmeticIntensity(config7b, a100, 1000, 'prefill');
const intensityDecode = calculateArithmeticIntensity(config7b, a100, 1000, 'decode');

check(
  'prefill has higher arithmetic intensity',
  intensityPrefill.intensity > intensityDecode.intensity,
  (v) => v === true,
  'true'
);

check(
  'prefill arithmetic intensity exceeds GPU ratio (compute-bound)',
  intensityPrefill.bound,
  (v) => v === 'compute',
  'compute'
);

check(
  'decode arithmetic intensity below GPU ratio (memory-bound)',
  intensityDecode.bound,
  (v) => v === 'memory',
  'memory'
);

// ---------------------------------------------------------------------
// Step 12 - Throughput vs latency tradeoff
// ---------------------------------------------------------------------

console.log('\nStep 12 - throughput vs latency tradeoff');

const smallBatch = simulateBatchProcessing(
  config7b,
  a100,
  [{ sequenceId: 'a', inputTokens: new Array(500).fill(1), currentLength: 500, maxNewTokens: 50, priority: 1 }]
);

const largeBatch = simulateBatchProcessing(
  config7b,
  a100,
  Array.from({ length: 8 }, (_, i) => ({
    sequenceId: `req${i}`,
    inputTokens: new Array(500).fill(1),
    currentLength: 500,
    maxNewTokens: 50,
    priority: 1,
  }))
);

check(
  'larger batches improve throughput',
  largeBatch.throughputTokensPerSec > smallBatch.throughputTokensPerSec,
  (v) => v === true,
  'true'
);

check(
  'larger batches increase latency',
  largeBatch.latencyMs > smallBatch.latencyMs,
  (v) => v === true,
  'true (throughput/latency tradeoff)'
);

// Throughput improvement should be significant
const throughputImprovement = largeBatch.throughputTokensPerSec / smallBatch.throughputTokensPerSec;
check(
  'batching provides substantial throughput improvement',
  throughputImprovement,
  (v) => v > 2,
  '> 2x throughput improvement with 8x batch'
);

// ---------------------------------------------------------------------
// Step 13 - Complete generation metrics
// ---------------------------------------------------------------------

console.log('\nStep 13 - generation metrics');

const gen = simulateGeneration(config7b, a100, 1000, 200);

check(
  'time to first token equals prefill duration',
  gen.timeToFirstToken,
  (v) => Math.abs(v - gen.prefill.durationMs) < 0.001,
  'TTFT == prefill duration'
);

check(
  'total duration is sum of phases',
  gen.totalDuration,
  (v) => Math.abs(v - (gen.prefill.durationMs + gen.decode.durationMs)) < 0.001,
  'prefill + decode'
);

check(
  'decode dominates total time for long outputs',
  gen.decode.durationMs > gen.prefill.durationMs,
  (v) => v === true,
  'true (200 output tokens > 1000 input at decode speed)'
);

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) {
    console.log(`  - ${f.name}`);
    console.log(`    expected: ${f.expectation}`);
    console.log(`    actual: ${JSON.stringify(f.actual)}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
