# Chapter 4 - Caching: Redis Deep Dive

Demonstrates prompt caching, token-based rate limiting, and hot key
detection for LLM workloads. Models Redis behavior in pure TypeScript.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all eight steps with 21 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

LLM responses are expensive to generate but cheap to store. Exact-match
caching on normalized prompts is safe and can cut costs by 30-80% on
repetitive workloads like internal tooling, FAQ bots, and template-based
generation.

## Layout

```
src/
  types.ts          Core types: CacheEntry, TokenBudgetConfig, HotKeyEntry
  cache.ts          Prompt cache with TTL and LRU/LFU/FIFO eviction
  rate-limiter.ts   Token-based rate limiting (not request-based)
  hot-key.ts        Hot key detection with Count-Min Sketch
  simulator.ts      Load simulation with Zipf distribution
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Cache hit rate >80% for Zipf-distributed prompts |
| 2 | LRU eviction fires under memory pressure |
| 3 | TTL expiration removes stale entries |
| 4 | Token-based rate limiting respects budget |
| 5 | Token limiting vs request limiting comparison |
| 6 | Hot key detection identifies top-N keys |
| 7 | Hot key replication serves from local cache |
| 8 | Hash collision resistance for similar prompts |

## Why token-based rate limiting

Request-based rate limiting fails for LLM workloads because two requests
to the same endpoint can differ in cost by three orders of magnitude. A
100-token classification and a 4000-token summary should not count the
same against the budget.

| Approach | Limit | Problem |
| --- | --- | --- |
| Request-based | 100 req/min | 10 large requests blow token budget |
| Token-based | 100k tokens/min | Actual cost controlled |

## The hot key problem

When everyone asks the same question, one cache key receives all the load.
In Redis, this means one shard handles the entire request volume. Detection
is the first step; replication to local in-process caches is the fix.

```
Normal: requests spread across keys
  key_1: |||
  key_2: ||
  key_3: |

Hot key: one key dominates
  hot_key: ||||||||||||||||||
  key_2: |
  key_3: |
```

## Zipf distribution

Real prompt traffic follows a power-law distribution: a few prompts are
very common, most are rare. The lab uses Zipf with skew=1.0, which means
roughly 20% of unique prompts account for 80% of traffic. This is why
caching works at all.

## Things worth breaking on purpose

- Change the eviction policy from `lru` to `fifo` and observe which
  entries survive.

- Set `ttlMs` to 0 and observe everything expires immediately.

- Remove the delay in the LRU test and observe timing-dependent failures.

- Set the hot key threshold very high and observe nothing gets detected.
