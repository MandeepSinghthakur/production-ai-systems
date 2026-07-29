# Chapter 34: Technical Strategy and Influence

This example demonstrates roadmap planning, build vs buy analysis, technical debt scoring, and strategy documentation for AI systems.

## What This Demonstrates

1. **Roadmap Planning** - Initiative tracking with dependency validation
2. **Build vs Buy Analysis** - Structured comparison with cost/benefit analysis
3. **Technical Debt Scoring** - Prioritization by impact, effort, and incident links
4. **Strategy Documentation** - Required sections validation and completeness tracking
5. **Initiative Prioritization** - Weighted scoring with multiple factors

## Running the Lab

```bash
# From repo root
node examples/ch34-technical-strategy/scripts/lab.mjs

# From this directory
node scripts/lab.mjs
```

## Expected Output

```
Step 1 - roadmap dependencies validated
  [PASS] valid roadmap passes dependency check
  [PASS] no circular dependencies detected
  [PASS] circular dependency detected
  [PASS] cycle reported as error

...

30/30 checks passed
```

## Key Files

- `src/types.ts` - Initiative, roadmap, strategy document types
- `src/roadmap.ts` - Roadmap planning with dependency validation
- `src/build-buy.ts` - Build vs buy analysis with weighted scoring
- `src/tech-debt.ts` - Technical debt tracking and prioritization
- `src/strategy.ts` - Strategy document builder and validator
- `src/prioritization.ts` - Initiative prioritization with multiple factors
