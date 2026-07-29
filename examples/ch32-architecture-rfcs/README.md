# Chapter 32: Architecture Reviews and RFCs

This example demonstrates RFC (Request for Comments) and ADR (Architecture Decision Record) validation for AI systems.

## What This Demonstrates

1. **RFC Structure Validation** - Required sections: context, decision, consequences, alternatives
2. **Tradeoff Analysis** - Each alternative must have documented tradeoffs
3. **ADR Linking** - Decisions link to related ADRs for context
4. **AI-Specific Checklist** - Review items for latency, cost, security, reliability, scalability
5. **Workflow Management** - Valid status transitions: draft → review → approved/rejected

## Running the Lab

```bash
# From repo root
node examples/ch32-architecture-rfcs/scripts/lab.mjs

# From this directory
node scripts/lab.mjs
```

## Expected Output

```
Step 1 - RFC has required sections
  [PASS] complete RFC passes validation
  [PASS] no validation errors
  [PASS] RFC has context, decision, consequences, alternatives

Step 2 - trade-offs documented for each alternative
  [PASS] all alternatives have tradeoffs
  [PASS] RFC without tradeoffs flagged

...

27/27 checks passed
```

## Key Files

- `src/types.ts` - Type definitions for RFC, ADR, checklists
- `src/rfc.ts` - RFC structure and validation
- `src/adr.ts` - Architecture Decision Records
- `src/checklist.ts` - AI-specific review checklist
- `src/tradeoffs.ts` - Tradeoff analysis and scoring
- `src/workflow.ts` - RFC lifecycle management
