# Chapter 13 — Streaming and Token Economics

A working demonstration of streaming latency benefits and token cost
modeling. No API key, no spend, no network calls.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all fourteen steps, asserts twenty-eight claims, exits non-zero if
any fail. Takes about five seconds.

## What this demonstrates

**Streaming vs non-streaming latency.** Time-to-first-token (TTFT) is
a fraction of total response time. Users see content appearing within
hundreds of milliseconds while the full response takes seconds.

**TTFT scaling.** Prefill time (processing input tokens) dominates TTFT
for long prompts. A 4,000-token input has ~50x the TTFT of a 10-token
input.

**Token economics.** Cost scales with tokens, not requests. A single
request can cost 30x more than another to the same endpoint based on
model tier and output length.

**Budget enforcement.** Reserve-then-reconcile pattern bounds overshoot
when you cannot know cost until after spending. Hard caps reject at
limit; soft caps alert but allow.

**Early termination.** Streaming enables cost savings by stopping
generation when the user has enough information.

## Layout

```
src/
├── types.ts       tier definitions, cost multipliers, interfaces
├── streaming.ts   SSE simulation, TTFT measurement
├── ttft.ts        TTFT modeling, percentile tracking, optimization
├── economics.ts   cost calculation, variance analysis, projection
└── budget.ts      reserve-then-reconcile, soft/hard caps
```

## Key numbers

These are the ratios the lab asserts:

- **TTFT < 50% of total duration** for multi-token responses
- **30x cost difference** between frontier and small tiers
- **4x output multiplier** (output tokens cost more than input)
- **Overshoot bounded** by concurrency times per-request maximum

## Things worth exploring

- Change `TIER_COST_MULTIPLIER` in `types.ts` and watch cost variance
  change
- Increase `perOutputTokenMs` in `DEFAULT_LATENCY_MODEL` and watch TTFT
  stay constant while total duration grows
- Set a low `dailyTokenLimit` and observe hard cap rejections kick in
