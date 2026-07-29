# Chapter 7 - Event-Driven Architecture Patterns

Demonstrates event-driven patterns for AI systems: event sourcing,
CQRS, schema versioning, ordering guarantees, and idempotency.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all five steps with 42 assertions, exits non-zero if any fail.
Takes under one second.

## The key insight

AI systems generate events at every interaction: conversation starts,
messages sent, tier changes, completions. Event sourcing captures this
naturally. Instead of storing "current state", you store "what happened"
and derive state by replaying events.

The benefits for AI systems:
1. **Audit trail** - every model interaction is recorded
2. **Temporal queries** - what did the conversation look like before that hallucination?
3. **Analytics** - derive any metric from the event stream
4. **Recovery** - rebuild state from events if projections corrupt

The cost: more storage, eventual consistency for read models.

## Layout

```
src/
  types.ts        Core types: Event, Command, Aggregate
  events.ts       Event definitions and in-memory store
  sourcing.ts     Event sourcing: rehydration, snapshots, streams
  cqrs.ts         Command handler and read model projections
  idempotency.ts  Deduplication and ordering enforcement
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Events are immutable, ordered, and version-checked |
| 2 | State reconstructs from events; temporal queries work |
| 3 | CQRS separates commands (writes) from queries (reads) |
| 4 | Idempotency handles duplicate events correctly |
| 5 | Schema versioning supports event evolution |

## Event sourcing for conversations

Traditional approach stores current state:

```
conversations: { id, user_id, messages: [...], token_count, tier }
```

Event sourcing stores what happened:

```
events: [
  { type: 'conversation.started', tier: 'frontier', ... },
  { type: 'message.sent', role: 'user', content: '...', ... },
  { type: 'message.sent', role: 'assistant', tokens: 150, ... },
  { type: 'tier.changed', from: 'frontier', to: 'small', ... },
]
```

The current state is derived by replaying events. This seems like more
work, but it gives you:

- Full history without separate audit logging
- Ability to rebuild any derived data
- Temporal queries ("what was the state at 3pm?")
- Natural fit for AI interaction patterns

## CQRS pattern

Commands change state; queries read it. They use different models.

**Write model (commands):**
- Validates business rules
- Produces events
- Enforces invariants

**Read model (projections):**
- Optimized for queries
- Denormalized for performance
- Eventually consistent with write model

For AI systems, this means:
- Command: "send message" - validates conversation is active, produces event
- Query: "get conversation summary" - reads from pre-computed projection
- Query: "get tenant analytics" - reads from aggregated projection

## Idempotency patterns

Model calls are expensive. Processing the same event twice wastes money.
Three patterns:

1. **Command idempotency** - generate key from command content, check before processing
2. **Event deduplication** - sliding window to catch recent duplicates
3. **Ordering enforcement** - buffer out-of-order events, release when ready

The ordering enforcer is critical: if event version 3 arrives before
version 2, you cannot process it yet. Buffer it, wait for 2, then process
both in order.

## Schema versioning

Events are immutable - you cannot change old events. But schemas evolve.

Strategies:
1. **Additive changes** - new optional fields (backward compatible)
2. **Migration on read** - transform old events to new schema when reading
3. **Versioned projections** - rebuild projection from scratch with new logic

The schema registry in this example supports migrations from one version
to another, applying transformations when replaying old events.

## Things worth breaking on purpose

- Skip version validation and observe corrupted aggregate state.
- Remove idempotency check and observe duplicate processing.
- Process events out of order and observe incorrect state.
- Change event schema without migration and observe broken replay.
