# Chapter 6 - Kafka Internals for LLM Workloads

Demonstrates event-driven LLM pipelines with Kafka-like semantics:
consumer timeouts for long inference, exactly-once delivery,
backpressure handling, and dead letter queues.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all four steps with 13 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

LLM processing times (10-60 seconds) break standard Kafka consumer
configurations. The defaults assume sub-second processing. If your
consumer takes 30 seconds to process a message and your session
timeout is 10 seconds, you lose your partition assignment mid-inference.

The fix: session timeout must exceed max processing time, and consumers
must send heartbeats during processing.

## Layout

```
src/
  types.ts        Core types: Message, LLMRequest, ConsumerConfig
  simulator.ts    In-memory Kafka-like broker for testing
  producer.ts     Idempotent message production
  consumer.ts     Long-running consumer with heartbeats
  dlq.ts          Dead letter queue handler
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Consumer handles 30s processing without session timeout |
| 2 | Failed messages route to DLQ with categorized reasons |
| 3 | Idempotency keys prevent duplicate message processing |
| 4 | Backpressure pauses consumption when rate limited |

## LLM-specific Kafka configuration

Standard Kafka defaults assume sub-second processing. For LLM workloads:

| Setting | Default | LLM workload | Why |
| --- | --- | --- | --- |
| session.timeout.ms | 10,000 | 120,000 | Must exceed max inference time |
| heartbeat.interval.ms | 3,000 | 10,000 | Keep alive during long requests |
| max.poll.records | 500 | 1-10 | Process fewer, longer messages |
| max.poll.interval.ms | 300,000 | 600,000 | Allow batch of long requests |

## Exactly-once semantics

For expensive LLM calls, duplicate processing wastes money. The pattern:

1. Producer generates idempotency key from request content
2. Broker deduplicates on key before writing
3. Consumer commits offset only after successful processing
4. On failure, message routes to DLQ rather than reprocessing forever

## Backpressure

When the provider rate-limits you:

1. Consumer detects 429 response
2. Pause partition consumption
3. Apply exponential backoff
4. Resume when rate limit window expires

This prevents queue buildup and retry storms.

## Things worth breaking on purpose

- Set session.timeout.ms below processing time and observe rebalance
  mid-inference.

- Remove idempotency key and observe duplicate processing when
  producer retries.

- Disable DLQ routing and observe poison message blocking partition.
