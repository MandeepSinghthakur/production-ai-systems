# Chapter 3 - Load Balancing Long-Lived Connections

Demonstrates load balancing algorithms, health checking, sticky sessions,
and connection rebalancing for LLM workloads. Models all behavior in pure
TypeScript without external dependencies.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all nine steps with 34 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Traditional load balancers optimize for short-lived HTTP requests. LLM
workloads have different characteristics: requests take 2-40 seconds,
connections are often persistent (WebSocket or SSE for streaming), and
mid-stream failures are expensive because you lose all generated tokens.

Connection-based balancing algorithms like least-connections outperform
round-robin when request durations vary widely. Sticky sessions prevent
mid-conversation backend switches. Graceful rebalancing migrates
connections without dropping in-flight requests.

## Layout

```
src/
  types.ts          Core types: Backend, Connection, StickySession
  balancer.ts       Load balancing algorithms (round-robin, weighted, least-conn)
  health.ts         Health checking with slow-backend detection
  sticky.ts         Sticky session management
  rebalance.ts      Connection rebalancing with drain support
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Round-robin distributes exactly evenly |
| 2 | Weighted round-robin respects weight ratios |
| 3 | Least-connections adapts to variable latency |
| 4 | Health checks detect both failures and slow backends |
| 5 | Sticky sessions maintain tenant-to-backend affinity |
| 6 | Rebalancing moves connections without dropping them |
| 7 | No healthy backends returns explicit failure |
| 8 | Sticky sessions respect TTL expiration |
| 9 | Drain timeout cancels stuck migrations |

## Why least-connections for LLM workloads

Round-robin assumes all requests take the same time. For a traditional
API with p99 latency of 50ms, this is close enough to true. For LLM
inference where one request takes 500ms and another takes 30 seconds,
round-robin creates severe imbalance.

| Algorithm | Assumes | Works when |
| --- | --- | --- |
| Round-robin | Equal request duration | p99/p50 ratio < 2 |
| Weighted round-robin | Known capacity ratio | Backend specs differ |
| Least-connections | Nothing about duration | Request times vary |

Least-connections naturally routes new requests to backends that are
completing work fastest. The backend with 8 active connections is
probably slower than the one with 2.

## Why sticky sessions matter

LLM conversations are stateful. The model's context window includes
previous messages, and losing that context mid-conversation degrades
the experience or breaks the application entirely.

Without sticky sessions, each request in a conversation might hit a
different backend. If backends do not share state (and sharing 100K+
token context windows across backends is expensive), the user's
conversation history is lost.

Sticky sessions map a client identifier (tenant ID, session ID, or
cookie) to a specific backend. All requests from that client route to
the same backend until the session expires or the backend fails.

## The rebalancing problem

Sticky sessions create imbalance over time. If tenant-A sends 10x more
traffic than tenant-B, and both are stuck to the same backend, that
backend is overloaded while others are idle.

Rebalancing fixes this by migrating connections from overloaded to
underloaded backends. The challenge: you cannot just kill a connection.
In-flight requests would fail, losing generated tokens.

Graceful rebalancing:

1. Mark the connection for drain (stop sending new requests)
2. Wait for in-flight requests to complete
3. Migrate the connection to the new backend
4. Resume sending requests

This preserves in-flight work while achieving better balance.

## Things worth breaking on purpose

- Change the algorithm from `least-connections` to `round-robin` and
  observe imbalance under variable latency.

- Set `unhealthyThreshold` to 1 and observe flapping as transient
  failures immediately mark backends unhealthy.

- Disable sticky sessions and observe connections routing to different
  backends on each request.

- Set `drainTimeoutMs` very low and observe migrations failing because
  connections cannot drain in time.
