# Chapter 19 - Multi-Provider Routing

A working multi-provider router with two mock providers - one correct, one
with a 3% nested-field regression. Demonstrates how availability metrics
stay green while output quality degrades silently.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Starts all three services, runs all four steps, asserts thirteen claims,
exits non-zero if any fail. Takes about thirty seconds.

## Run it by hand

```bash
node src/mock-provider-a/server.ts   # terminal 1, port 8091
node src/mock-provider-b/server.ts   # terminal 2, port 8092
node src/router.ts                   # terminal 3, port 8090

# Send an extraction request
curl -X POST localhost:8090/v1/extract \
  -H 'content-type: application/json' \
  -d '{"tenant":"acme","residency":"us","tier":"standard"}'

# Check metrics
curl localhost:8090/metrics

# Check ledger
curl localhost:8090/ledger
```

## Fail the primary provider

```bash
curl -X POST localhost:8090/admin/health \
  -d '{"target":"provider-a","healthy":false}'
```

Traffic fails over to provider-b. Dashboards stay green, but 3% of
responses now have `effective_date` at the wrong level.

## Enable per-target tracking

```bash
curl -X POST localhost:8090/admin/config \
  -d '{"enablePerTargetTracking":true}'
```

Now `GET /metrics` shows field population rates broken down by target,
making the regression visible.

## Layout

```
src/
├── types.ts                  canonical schema
├── router.ts                 the four-stage routing logic
├── ledger.ts                 records target per request
├── metrics.ts                per-target field population tracking
└── mock-provider-a/
│   └── server.ts             primary - correct responses
└── mock-provider-b/
    └── server.ts             secondary - 3% nested-field regression
```

## The four routing stages

1. **Eligibility filter** (hard) - residency, tier constraints
2. **Health gating** (hard) - breaker state per target
3. **Stickiness** (override) - pin conversations to first target
4. **Ranking** (soft) - by cost then latency

## The 13-day archaeology problem

Without target labels in the ledger, debugging a quality regression requires:

1. Notice quality dropped on day N
2. Check which provider was serving traffic on day N
3. Correlate timestamps across multiple systems
4. Discover it was provider-b, which was promoted 13 days ago

With target labels: one query, immediate answer.

## Things worth breaking on purpose

- Remove the `target` field from ledger records and try to debug the
  regression. That is the 13-day archaeology problem, made visible.
- Set provider-b's regression rate to 0 and watch the divergence alert
  disappear.
- Disable stickiness and observe conversation context spreading across
  providers.
