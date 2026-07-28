# Chapter 27 — Multi-Agent Systems and Orchestration

Lab code for Chapter 27 of *Building Production AI Systems*.

## Running the lab

From this directory:

```bash
node scripts/lab.mjs
```

From the repo root:

```bash
node examples/ch27-multi-agent/scripts/lab.mjs
```

Expected output: `16/16 checks passed`

## What this demonstrates

- Multiple agent types (supervisor, worker, specialist)
- Agent handoff with context preservation
- Trace correlation across agents (distributed tracing)
- Deadlock detection and resolution
- Supervisor interrupt capability
- Pipeline and swarm orchestration patterns

## No dependencies

Runs on Node 22.6+ with no npm install. All agent behavior is simulated
in-process; no external services or API keys required.
