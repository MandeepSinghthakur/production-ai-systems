# Chapter 9 - Observability and OpenTelemetry

Demonstrates distributed tracing, metrics collection, structured logging,
and alerting for LLM workloads. Models OpenTelemetry behavior in pure
TypeScript.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all twelve steps with 55 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

LLM requests span multiple services and take seconds, not milliseconds.
The three pillars of observability (logs, metrics, traces) need different
treatment for AI workloads:

- **Traces** must propagate across HTTP, Kafka, and internal queues
- **Metrics** must capture token counts, model tiers, and estimated cost
- **Logs** must correlate to traces and be structured for search

## Layout

```
src/
  types.ts      Core types: Span, Metric, LogRecord, AlertRule
  tracing.ts    Distributed tracing with W3C context propagation
  metrics.ts    Counters, gauges, histograms with AI-specific dimensions
  logging.ts    Structured logging with trace correlation
  alerting.ts   Alert rules for AI-specific thresholds
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Span creation and parent-child correlation |
| 2 | W3C traceparent parsing and formatting |
| 3 | AI metrics with tenant, model, and token dimensions |
| 4 | Histogram percentile calculation |
| 5 | Structured logging with trace correlation |
| 6 | Log severity filtering |
| 7 | Alert rule evaluation and resolution |
| 8 | Default AI alert rules (errors, latency, tokens, cost) |
| 9 | Counter and gauge behavior |
| 10 | Span events and custom attributes |
| 11 | Critical path analysis for traces |
| 12 | withSpan helper for async operations |

## Why AI metrics are different

Standard request metrics miss what matters for LLM workloads:

| Standard metric | Why it fails for AI | AI-specific metric |
| --- | --- | --- |
| requests/sec | Ignores cost variance | tokens/sec by tier |
| latency p99 | Hides variance by model | latency p99 by tier |
| error rate | All errors same weight | errors by tenant and type |
| cache hit rate | Ignores cost savings | tokens saved, cost saved |

## The three pillars for AI

**Traces** answer "where did time go?" For a 10-second LLM request, was
time spent in network, queuing, or model inference? Without traces, you
optimize the wrong thing.

**Metrics** answer "how many?" and "how much?" Token counts drive cost.
Latency percentiles drive SLAs. Cache hit rates drive efficiency.

**Logs** answer "what happened?" Structured logs with trace IDs let you
correlate events across services. Unstructured logs become write-only
storage.

## Alert thresholds for AI

AI systems need different alert thresholds than traditional services:

| Alert | Traditional threshold | AI threshold | Why |
| --- | --- | --- | --- |
| Error rate | >1% | >5% | Model errors are normal |
| Latency p99 | >500ms | >30s | Models are slow |
| Cost | N/A | >$X/hour | Token costs dominate |
| Token budget | N/A | >1M/hour | Capacity planning |

## Things worth breaking on purpose

- Remove trace context propagation and observe spans that do not
  correlate

- Set the alert threshold lower than the baseline and observe
  perpetual firing

- Remove the trace ID from logs and try to correlate events manually

- Change the histogram buckets and observe percentile accuracy change
