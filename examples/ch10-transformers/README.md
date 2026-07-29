# Chapter 10 - How Transformers Actually Serve Requests

A simulation of transformer inference mechanics for engineers. No GPU
required, no dependencies, no API keys.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps, asserts thirty-eight claims about transformer
inference behavior, exits non-zero if any fail.

## What this models

This example simulates the computational and memory behavior of
transformer inference without performing actual neural network math.
The claims it validates:

1. **Attention scales quadratically** with sequence length (O(n^2))
2. **KV cache scales linearly** with sequence length (O(n))
3. **Prefill is compute-bound**, decode is memory-bound
4. **Batching improves throughput** but increases latency
5. **Longer contexts require more memory** and reduce concurrency

## Layout

```
src/
├── types.ts       Type definitions for model configs and metrics
├── attention.ts   Attention mechanism and FLOPS calculations
├── kv-cache.ts    KV cache memory modeling and management
├── batching.ts    Static and continuous batching strategies
└── phases.ts      Prefill vs decode phase simulation
```

## Key concepts demonstrated

### KV cache memory per token

For a 7B parameter model:
- Hidden size: 4096
- Layers: 32
- Memory per token: 2 * 32 * 4096 * 2 bytes = 512 KB

A 4096 token context uses ~2 GB of KV cache.

### Prefill vs decode asymmetry

Prefill (processing the prompt):
- All input tokens processed in parallel
- Compute-bound: GPU compute is the bottleneck
- High arithmetic intensity

Decode (generating output):
- One token at a time (autoregressive)
- Memory-bound: reading model weights is the bottleneck
- Decode is ~100x slower per token than prefill

### Why batching helps

Single sequence decode: read all model weights to generate one token.
Batch of 8 sequences: read all model weights once, generate 8 tokens.

The throughput improvement is substantial because weight reads are
amortized across the batch.

## Things worth exploring

1. Change the model config to see how parameters affect memory
2. Increase sequence lengths to see quadratic attention scaling
3. Compare KV cache memory at different context lengths
4. Observe how batch size affects throughput/latency tradeoff
