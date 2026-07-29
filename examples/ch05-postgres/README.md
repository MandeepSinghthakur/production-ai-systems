# Chapter 5 - Postgres at Scale

Demonstrates connection pooling, indexing strategies, partitioning, and
read replica routing for AI workloads. Models Postgres behavior in pure
TypeScript.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all ten steps with 29 assertions, exits non-zero if any fail.
Takes about 1 second.

## The key insight

AI systems amplify database patterns that matter less at small scale.
Retrieval pipelines generate many queries per user request. Embeddings
and audit logs create massive append-only tables. Prompt caches need
fast exact-match lookups. The patterns in this chapter — pooling,
indexing, partitioning, read replicas — become essential rather than
optional.

## Layout

```
src/
  types.ts          Core types: PoolConfig, IndexDefinition, PartitionDefinition
  pooling.ts        Connection pool with acquire/release and queue
  indexing.ts       Index selection and query planning simulation
  partitioning.ts   Range and list partitioning with pruning
  queries.ts        Read/write routing and JSONB document store
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Connection pooling reduces overhead by 10x+ |
| 2 | Pool handles concurrent requests with queueing |
| 3 | B-tree vs GIN index selection for query types |
| 4 | Partial indexes reduce scan cost for hot paths |
| 5 | Range partitioning by time enables efficient queries |
| 6 | List partitioning by tenant provides isolation |
| 7 | Read replicas handle read-heavy retrieval pipelines |
| 8 | Replica lag monitoring with fallback to primary |
| 9 | JSONB queries with and without GIN indexes |
| 10 | Partition pruning eliminates 90%+ of scanned data |

## Why connection pooling

Postgres connections are expensive. Each connection forks a backend
process (~5-10 MB memory), performs TCP and SSL handshakes, and runs
authentication. Without pooling, bursty AI workloads create connection
storms that exhaust `max_connections`.

| Without Pool | With Pool |
| --- | --- |
| 50ms connect + 10ms query per request | 10ms query per request |
| 600ms for 10 sequential queries | 25ms for 10 concurrent queries |
| Connection per request | Connection per pool |

## Index strategy by query type

| Query Pattern | Index Type | Why |
| --- | --- | --- |
| Equality (`tenant_id = ?`) | B-tree | Default, sorted, supports range too |
| Range (`created_at > ?`) | B-tree or BRIN | B-tree for random access, BRIN for sequential |
| JSONB containment (`data @> ?`) | GIN | Inverted index for nested keys |
| Full-text search | GIN | Supports `@@` operator |
| Hot path with filter | Partial B-tree | Smaller index = faster scan |

## Why partitioning for AI tables

AI systems generate large append-only datasets:

- **Prompts and responses**: audit log, never updated, queried by time
- **Embeddings**: millions of vectors, queried by document
- **Request metrics**: billions of rows, queried by tenant and time

Without partitioning, queries scan entire tables. With range partitioning
by month, a "last 30 days" query touches 1-2 partitions out of 24.

```
Without pruning: scan 24 partitions (100%)
With pruning:    scan 1 partition (4%)
```

## Read replica patterns

AI retrieval pipelines amplify reads. A single user query might:

1. Fetch the conversation history (1 read)
2. Search embeddings (1-10 reads)
3. Fetch source documents (5-20 reads)

That is 25+ reads per user request. Without read replicas, the primary
becomes a bottleneck. Route reads to replicas except when:

- Request requires fresh data (`requiresFreshData: true`)
- Latency budget is too tight for replica lag
- All replicas exceed lag threshold

## Things worth breaking on purpose

- Set `maxConnections: 1` and observe queue contention.

- Remove the GIN index and observe JSONB query performance degrade.

- Set `replicaLagThresholdMs: 0` and observe all reads fall back to
  primary.

- Query across partition boundaries and observe more partitions scanned.
