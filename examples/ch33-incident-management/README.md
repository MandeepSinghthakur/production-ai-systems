# Chapter 33: Incident Management for AI Systems

This example demonstrates incident classification, runbook execution, and post-incident analysis for AI-specific incidents.

## What This Demonstrates

1. **Incident Classification** - Categorize incidents as model, security, cost, availability, or data
2. **Severity Scoring** - Calculate severity based on user impact, service criticality, and incident type
3. **Runbook Execution** - Execute runbook steps in order with checkpoints
4. **Timeline Management** - Track all incident events with timestamps
5. **Post-Incident Reports** - Generate postmortems with required sections and action items

## Running the Lab

```bash
# From repo root
node examples/ch33-incident-management/scripts/lab.mjs

# From this directory
node scripts/lab.mjs
```

## Expected Output

```
Step 1 - incident classified correctly
  [PASS] model degradation classified as model incident
  [PASS] prompt injection classified as security incident
  [PASS] budget exceeded classified as cost incident
  [PASS] timeout storm classified as availability incident

...

28/28 checks passed
```

## Key Files

- `src/types.ts` - Incident types, severity definitions, report structures
- `src/classifier.ts` - AI-specific incident type classification
- `src/severity.ts` - Severity scoring based on impact criteria
- `src/runbook.ts` - Runbook registry and execution tracking
- `src/timeline.ts` - Timeline event management and reconstruction
- `src/postmortem.ts` - Post-incident report generation
