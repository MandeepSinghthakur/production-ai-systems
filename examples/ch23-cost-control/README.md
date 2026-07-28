# Chapter 23 - Cost Control and Capacity Planning

Demonstrates multi-tenant token budgeting with reserve-then-reconcile,
hard vs soft caps, budget forecasting, and cost attribution by tier.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all six steps with 13 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Reserve pessimistically at admission, reconcile to actual on completion.
Overshoot becomes bounded by in-flight concurrency times per-request
maximum. This pattern from ch18's budget.ts is extended here with:

1. **Multi-tenant support** - Each tenant has independent limits
2. **Hard vs soft caps** - Hard caps reject, soft caps alert
3. **Cost attribution** - Track spending by tenant, workload, model tier
4. **Budget forecasting** - Project when budget will exhaust

## Layout

```
src/
  types.ts        Core types: Account, Request, Attribution
  budget.ts       Token budget manager with reserve-then-reconcile
  forecaster.ts   Budget projection based on burn rate
  allocator.ts    Cost attribution by dimension
  simulator.ts    Request simulator for testing
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Hard cap rejects requests when budget exhausted |
| 2 | Soft cap accepts requests but flags over-budget |
| 3 | Reserve-then-reconcile accuracy |
| 4 | Concurrent overshoot bounded by concurrency * max |
| 5 | Burn rate and exhaustion forecasting |
| 6 | Multi-tier cost attribution |

## Model tier costs

We avoid vendor names and prices (they rot within a quarter). Instead:

| Tier | Cost multiplier | Example use |
| --- | --- | --- |
| frontier | 1.0x | Complex reasoning |
| mid | 0.1x | Summarization |
| small | 0.01x | Classification |

## Reserve-then-reconcile pattern

```
Request arrives
  -> Reserve pessimistic estimate (e.g., max_tokens)
  -> If hard cap exceeded: reject
  -> If soft cap exceeded: accept but flag

Request completes
  -> Settle with actual usage (often less than estimate)
  -> Release unused reservation
```

The overshoot is bounded: even with N concurrent requests each reserving
max_tokens, the worst case is N * max_tokens above the limit. In practice,
actual usage is typically 30-50% of the pessimistic estimate.

## Forecasting

Track token consumption in a sliding window, compute burn rate, project
exhaustion time. Alert when exhaustion is imminent:

```
burn_rate = tokens_in_window / window_seconds
seconds_remaining = remaining_tokens / burn_rate
```

This enables proactive alerts: "At current rate, tenant X will exhaust
budget in 5 minutes" rather than "Tenant X is now rejecting requests."

## Things worth breaking on purpose

- Change a tenant from hard to soft cap and observe requests succeed
  past the limit.

- Set `estimatedTokens` equal to `actualTokens` and observe the
  reserve-then-reconcile provides no benefit (but also no harm).

- Reduce the forecast window to 5 seconds and observe burn rate
  becomes noisy and forecasts unstable.
