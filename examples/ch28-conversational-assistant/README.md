# Chapter 28 - Design: A Conversational Assistant at Scale

System design simulation for Chapter 28 of *Building Production AI Systems*.

## Running the lab

From this directory:

```bash
node scripts/lab.mjs
```

From the repo root:

```bash
node examples/ch28-conversational-assistant/scripts/lab.mjs
```

Expected output: `24/24 checks passed`

## What this demonstrates

This is a system design chapter, not a component implementation. The code
validates design calculations rather than running a live system:

- **Capacity planning**: users to messages to tokens to storage
- **Architecture validation**: component dependencies and throughput
- **Gateway sizing**: Little's Law for concurrent connections
- **Memory budgeting**: conversation history within context limits
- **Cost projection**: token costs align with capacity estimates
- **Load simulation**: bottleneck identification under load
- **Failover**: availability with multi-provider routing
- **Scaling decisions**: what changes at 10K, 100K, 1M users

## No dependencies

Runs on Node 22.6+ with no npm install. All calculations are deterministic;
no external services or API keys required.

## Layout

```
src/
  types.ts        Core types: capacity, architecture, costs
  capacity.ts     Capacity planning calculations
  architecture.ts Component definitions and scaling points
  simulator.ts    Load simulation and bottleneck detection
  cost.ts         Cost projections and validation
```

## The design process this models

1. **Requirements gathering**: DAU, messages/user, model mix
2. **Capacity estimates**: tokens/day, storage needs, peak throughput
3. **Architecture definition**: components and their relationships
4. **Bottleneck analysis**: which component saturates first
5. **Cost projection**: infrastructure + tokens at each scale
6. **Scaling strategy**: what to change at each growth milestone

## Key assertions the lab validates

| Check | Why it matters |
| --- | --- |
| Capacity consistency | tokens/user * users = total tokens |
| Architecture validity | no circular dependencies |
| Gateway sizing | Little's Law: concurrent = rate * time |
| Memory budget | fits within context window |
| Cost alignment | projected cost matches token estimates |
| Failover availability | > 90% during provider outage |

## References to earlier chapters

This design assembles concepts from:

- Ch 18: LLM Gateway for request handling
- Ch 19: Multi-provider routing for availability
- Ch 20: Memory management for conversation history
- Ch 21: Evaluation pipelines (eval service in architecture)
- Ch 22: Security filters for prompt injection
- Ch 23: Cost control and budget enforcement

## Things worth experimenting with

- Change `dailyActiveUsers` to 1M and observe which component
  becomes the bottleneck first.

- Adjust `modelTierDistribution` to use 50% frontier models and
  observe cost scaling.

- Reduce `totalMemoryBytes` to 10% and observe eviction pressure.

- Set `requestsPerSecondCapacity` of provider-primary to half of
  peak traffic and observe failover events.
