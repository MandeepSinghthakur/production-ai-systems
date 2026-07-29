# Chapter 2 - Scaling Stateless and Streaming APIs

Demonstrates horizontal scaling, streaming connection management,
backpressure handling, and graceful degradation for LLM APIs.
Models production behavior in pure TypeScript.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all twelve steps with 35 assertions, exits non-zero if any fail.
Takes about 3 seconds.

## The key insight

LLM APIs differ from traditional APIs in two ways that change how you
scale them:

1. **Responses stream for seconds or tens of seconds.** This holds
   connections open, so you size for concurrent connections rather than
   requests per second. A system handling 100 req/s with 10-second
   responses needs capacity for 1,000 concurrent connections.

2. **Stateless scaling works, but connection limits come first.** Adding
   instances increases throughput linearly until you hit network or
   connection limits. Each instance can handle N concurrent requests,
   so M instances handle M*N concurrent requests.

## Layout

```
src/
  types.ts          Core types: APIRequest, StreamConnection, BackpressureConfig
  scaling.ts        Horizontal scaling with load balancing
  streaming.ts      Streaming connection management
  backpressure.ts   Backpressure handling for slow consumers
  degradation.ts    Graceful degradation under overload
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Horizontal scaling increases throughput linearly |
| 2 | Stateless instances process independently |
| 3 | Load balancer distributes requests across instances |
| 4 | Connection limits reject excess requests |
| 5 | Streaming connections held for response duration |
| 6 | Connection capacity calculation (Little's Law) |
| 7 | Backpressure pauses production when consumer is slow |
| 8 | Backpressure prevents memory overflow |
| 9 | Graceful degradation maintains partial service |
| 10 | Priority shedding protects high-priority requests |
| 11 | Degradation hysteresis prevents oscillation |
| 12 | Metrics tracked correctly |

## Horizontal scaling formula

For stateless APIs:

```
total_capacity = instances * concurrency_per_instance
```

For streaming APIs with long-held connections:

```
required_connections = requests_per_second * avg_connection_duration_seconds
```

Example: 100 req/s with 10-second average streaming time requires 1,000
concurrent connections. Add 20% headroom: plan for 1,200.

## Backpressure

When a client cannot consume data as fast as the server produces it:

1. **Buffer** - Store data temporarily (bounded, or you run out of memory)
2. **Pause** - Signal producer to stop (requires coordination protocol)
3. **Drop** - Discard data (acceptable for metrics, not for responses)

The lab demonstrates pause/resume backpressure with high/low water marks.
Producer pauses when buffer exceeds high water mark, resumes when it falls
below low water mark.

## Graceful degradation levels

| Level | Trigger | Action |
| --- | --- | --- |
| `none` | CPU < 70%, queue < 100 | Accept all requests |
| `shed-new` | CPU 70-85% or queue 100-200 | Reject 50% of new requests |
| `shed-streaming` | CPU 85-95% or queue 200-500 | Disable streaming, serve shorter responses |
| `emergency` | CPU > 95% or queue > 500 | Reject all new requests |

Hysteresis prevents oscillation: system only de-escalates when metrics
fall 10% below the threshold.

## Things worth breaking on purpose

- Set `maxConcurrency` to 1 and observe requests queuing or rejecting.

- Set `highWaterMark` lower than a single chunk and observe immediate pause.

- Remove the hysteresis and observe rapid level oscillation.

- Set `pauseThresholdMs` very low and observe abort on slow consumers.
