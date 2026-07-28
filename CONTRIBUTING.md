# Contributing

## The bar

A chapter is not finished because it is long. It is finished when it
passes the checklist at the end of `STYLE-GUIDE.md`. Read that file
before writing anything.

`book/ch18-llm-gateway.md` is the reference chapter. If what you are
writing is worse than that, it is not ready.

## Kinds of contribution, easiest to hardest

**Corrections.** Open an issue or a PR. Technical errors are the most
valuable thing you can send. Be specific about what is wrong and how
you know.

**Failure scenarios.** If you have operated a system described here and
seen it break in a way the chapter does not cover, that is worth more
than any amount of prose. Use the five-field format: symptom,
mechanism, detection, mitigation, prevention.

**Examples.** Code must run. See below.

**Chapters.** Open an issue proposing the chapter first, so two people
do not write the same one. Chapters are claimed in `OUTLINE.md`.

## Rules for example code

- Every snippet that appears in the book comes from a file in
  `examples/`. Never retype code into the manuscript.
- Every example runs with `node <file>` on Node 22.6+ with no
  dependencies, or documents exactly what it needs.
- Every example directory has a `scripts/lab.mjs` that asserts the
  claims its chapter makes, and exits non-zero when they fail. CI runs
  these. A chapter whose numbers are not machine-checked is a chapter
  whose numbers will eventually be wrong.
- No secrets, no real endpoints, no employer-identifying config.

## Rules for prose

- No hype vocabulary. The banned list is in `STYLE-GUIDE.md` §1.
- Every superlative needs a number or gets deleted.
- Every design decision names what it costs.
- No model names, no prices, no context window sizes in body text. Use
  capability tiers instead. Vendor specifics are the fastest-rotting
  content in the book and they date it within a quarter.

## Reviews

Technical review and copy edit are separate passes by separate people.
Do not combine them; combining them means neither happens properly.
