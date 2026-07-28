# Chapter 29 — Design: An AI Assistant in a Regulated Domain

Lab code for Chapter 29 of *Building Production AI Systems*.

## Running the lab

From this directory:

```bash
node scripts/lab.mjs
```

From the repo root:

```bash
node examples/ch29-regulated-ai/scripts/lab.mjs
```

Expected output: `42/42 checks passed`

## What this demonstrates

- Audit trail completeness for every AI decision
- Human-in-the-loop approval workflows for high-risk actions
- PII redaction in logs with recoverable compliance access
- Data retention policy enforcement with auto-expiration
- Role-based access control with explicit denials

## No dependencies

Runs on Node 22.6+ with no npm install. All behavior is simulated
in-process; no external services or API keys required.
