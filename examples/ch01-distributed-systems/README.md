# Chapter 1 - Distributed Systems for AI Workloads

Demonstrates distributed systems concepts specifically relevant to AI
workloads: consistency models, failure detection, token-based capacity
planning, and LLM latency characteristics.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all twelve steps with 40 assertions, exits non-zero if any fail.
Takes about two seconds.

## The key insight

AI workloads break traditional distributed systems assumptions in three
specific ways:

1. **Latency is 100-1000x higher.** A traditional API returns in 5-50ms.
   An LLM request takes 500-15000ms. Timeout, retry, and circuit breaker
   settings tuned for the former fail catastrophically for the latter.

2. **Capacity is token-based, not request-based.** Two requests to the
   same endpoint can differ in cost by 20x. Rate limiting by request
   count ignores this variance entirely.

3. **Providers cannot be paged.** When a third-party model provider
   degrades, your escalation options are "wait" or "failover." The
   incident management playbook changes.

## Layout

```
src/
  types.ts          Core types: Node, ReadResult, TokenCapacity, etc.
  consistency.ts    Eventual, strong, and causal consistency simulation
  failures.ts       Timeout strategies, failure detection, circuit breaker
  capacity.ts       Token-based capacity planning vs request-based
  latency.ts        Log-normal latency distribution for LLM requests
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Eventual consistency converges within timeout |
| 2 | Strong consistency blocks until majority acks |
| 3 | CAP theorem: CP fails during partition, AP succeeds |
| 4 | Exponential backoff with jitter spreads retries |
| 5 | Phi accrual detector adapts to network conditions |
| 6 | Token-based capacity differs from request-based |
| 7 | Token budget determines effective RPS by request size |
| 8 | LLM latency is 100x+ higher than traditional APIs |
| 9 | Timeout strategy must account for token count |
| 10 | Circuit breaker state machine (closed -> open -> half-open) |
| 11 | Queue model shows wait time grows nonlinearly near capacity |
| 12 | Timeout setting trades completion rate for latency |

## Why token-based capacity

Consider two requests to the same model endpoint:
- Request A: 100 input tokens, 100 output tokens
- Request B: 100 input tokens, 2000 output tokens

Request B uses 10x the model compute and takes 10x longer. Request-based
rate limiting treats them identically. Token-based limiting does not.

```
Request-based: 100 req/min limit
  - Allows 100 of Request B = 200,000 tokens
  - Allows 100 of Request A =  20,000 tokens
  - Same limit, 10x different cost

Token-based: 100,000 tokens/min limit
  - Allows 50 of Request B  = 100,000 tokens
  - Allows 500 of Request A = 100,000 tokens
  - Same cost, different request count
```

## Why LLM latency is different

Traditional API latency is roughly normal: most requests cluster around
the mean, outliers are rare. LLM latency is bimodal:

1. **Time to first token (TTFT):** Fixed overhead for loading context and
   generating the first token. Highly variable based on queue depth at
   the provider.

2. **Token generation:** Approximately linear with output token count.
   Relatively predictable once generation starts.

A timeout strategy that assumes normal distribution will either be too
aggressive (cutting off valid requests) or too lenient (waiting forever
for stuck requests).

## Things worth breaking on purpose

- Set `replicationDelayMs` to 0 in the consistency simulator and observe
  immediate convergence.

- Set circuit breaker `failureThreshold` to 1 and observe premature
  tripping on a single failure.

- Set LLM timeout to p50 and observe half the requests timing out.

- Remove jitter from exponential backoff and observe thundering herd on
  retry.
