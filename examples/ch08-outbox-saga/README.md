# Chapter 8 - Outbox, Saga, and Exactly-Once

Demonstrates transactional patterns for distributed AI systems:
outbox pattern for reliable messaging, saga pattern for distributed
transactions, compensation for rollback, and idempotency for
effective exactly-once delivery.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all twelve steps with 43 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

True exactly-once delivery is impossible in distributed systems. What
we can achieve is "effectively exactly-once" through at-least-once
delivery combined with idempotent processing. The outbox pattern
ensures messages are never lost; idempotency keys ensure duplicates
are harmless.

## Layout

```
src/
  types.ts          Core types: OutboxEntry, Saga, SagaStep
  outbox.ts         Outbox pattern for atomic writes + messaging
  saga.ts           Saga orchestrator with compensation
  compensation.ts   Compensation strategies and handlers
  delivery.ts       Idempotent processing and exactly-once coordination
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Outbox writes domain data and message atomically |
| 2 | Duplicate idempotency keys return existing entry |
| 3 | Outbox publisher delivers pending messages |
| 4 | Failed deliveries are retried until success |
| 5 | Saga executes steps in order |
| 6 | Saga compensates completed steps on failure |
| 7 | Idempotent processor handles duplicate requests |
| 8 | Exactly-once coordinator deduplicates at producer |
| 9 | Dead letter queue captures undeliverable messages |
| 10 | Compensation handler tracks and executes rollbacks |
| 11 | Compensation actions are idempotent |
| 12 | Full LLM saga with reserve/call/persist/charge |

## The dual-write problem

The outbox pattern solves the dual-write problem: when you need to
update a database AND publish a message, either can fail independently.

Without outbox:
```
1. Write to database  <- succeeds
2. Publish message    <- fails
Result: Database updated, but no message sent
```

With outbox:
```
1. Write to database AND outbox entry in same transaction
2. Publisher reads outbox, publishes, marks as published
Result: Either both happen or neither (transaction rollback)
```

## Saga compensation

When a multi-step operation fails mid-way:

```
Step 1: Reserve capacity   <- completed
Step 2: Call LLM           <- completed
Step 3: Persist result     <- completed
Step 4: Charge customer    <- FAILS

Compensation (reverse order):
Step 3: Delete persisted result
Step 2: (Cannot undo LLM call - semantic compensation)
Step 1: Release capacity reservation
```

The key insight: some operations cannot be compensated (you cannot
"un-call" an LLM), but you can perform semantic compensations that
achieve the business goal.

## Effective exactly-once

The pattern:
1. Producer assigns idempotency key based on request content
2. Publisher deduplicates on key before sending
3. Consumer checks idempotency before processing
4. Consumer stores response, returns cached for duplicates

This ensures:
- At-least-once delivery (retries guarantee delivery)
- Idempotent processing (duplicates return same result)
- = Effectively exactly-once (same effect as processing once)

## Things worth breaking on purpose

- Remove the transaction around outbox writes and observe messages
  without corresponding database changes.

- Disable compensation and observe partial state when saga fails
  mid-execution.

- Remove idempotency checks and observe duplicate LLM calls when
  retries happen.

- Set max attempts to 1 and observe messages going to DLQ on
  transient failures.
