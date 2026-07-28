# Chapter 18 — The LLM Gateway

A working LLM gateway and a mock provider that can be made to misbehave
on demand. No API key, no spend, no rate limits.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Starts both services, runs all five steps, asserts thirteen claims,
exits non-zero if any fail. Takes about ninety seconds.

## Run it by hand

```bash
node src/mock-provider/server.ts   # terminal 1, port 8081
node src/gateway.ts                # terminal 2, port 8080

node src/load.ts --rps 20 --duration 10s
curl localhost:8080/metrics
curl localhost:8080/ledger
```

Induce a brownout — latency, no errors, which is the failure mode most
systems handle worst:

```bash
curl -X POST localhost:8081/fault -d '{"latencyMs":12000}'
```

Turn on the latency-aware breaker:

```bash
curl -X POST localhost:8080/admin/config \
  -d '{"breaker":{"enabled":true,"slowCallMs":3000}}'
```

## Timings are compressed

The upstream timeout defaults to 4 seconds and the breaker's slow-call
threshold to 3, so the lab finishes in minutes. Production values are
five to ten times these. The ratios are what matter, not the absolute
numbers.

## Layout

```
src/
├── types.ts                  canonical schema — the gateway's own format
├── gateway.ts                the nine stages, in order
├── budget.ts                 reserve pessimistically, reconcile to actual
├── ledger.ts                 usage records, including for aborted streams
├── metrics.ts                minimal histograms and counters
├── load.ts                   open-loop load generator
├── adapter/
│   ├── mock.ts               provider wire format ↔ canonical
│   └── stream.ts             incremental transform, usage in `finally`
├── router/
│   └── breaker.ts            trips on slow calls, not just failures
└── mock-provider/
    └── server.ts             SSE provider with fault injection
```

## Things worth breaking on purpose

- Comment out the `finally` in `adapter/stream.ts`, rerun step 4, and
  watch every aborted request vanish from the ledger. That is the
  under-reporting bug, made visible.
- Set `stallAfterChunk` on the mock provider and note that the consumer
  cannot tell a truncated stream from a complete one until you add the
  terminal event back.
- Set `retryBudgetRatio` to 1.0 and watch amplification double.
