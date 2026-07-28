# Style Guide

This document is binding. If a chapter disagrees with it, the chapter is wrong.

---

## 1. Voice

**Write like a staff engineer explaining something to another staff engineer over
lunch, not like a vendor writing documentation.**

| Do | Don't |
| --- | --- |
| "Redis is single-threaded for command execution, which is why a single `KEYS *` stalls every other client." | "Redis offers blazing-fast performance." |
| "This costs about $0.90 per thousand requests at current Sonnet pricing. Check it — pricing moves." | "This is highly cost-effective." |
| "We tried semantic caching first. It fired on 4% of traffic and returned one wrong answer that reached a customer. We removed it." | "Semantic caching can improve cache hit rates." |
| "You probably don't need this below 50 req/s." | "This solution scales to any workload." |

Rules:

- **Second person for instructions, first person plural for design decisions.**
  "You configure the timeout"; "we chose to fail open."
- **Every superlative needs a number or gets deleted.** "Fast" is not a claim.
  "p99 under 40 ms at 2,000 req/s on a single c7g.2xlarge" is a claim.
- **Name the trade-off you are accepting.** A design with no downside described is
  a design that has not been thought about.
- **No hype vocabulary.** Banned: leverage, seamless, robust, cutting-edge,
  game-changing, revolutionary, unlock, empower, blazing, delve, tapestry.
- **Contractions are fine.** This is a book people read at their desk.
- **Sentences under 30 words. Paragraphs under 5 sentences.** Break the rule
  deliberately, not by accident.

### No vendor specifics in body text

No model names, no prices, no context window sizes, no rate limits. Use
capability tiers — `frontier`, `mid`, `small` — and describe cost in
relative terms ("an order of magnitude cheaper").

This is not squeamishness. Vendor specifics are the fastest-rotting content
in the book: they date it within a quarter, they are wrong by the time a
print run ships, and they push readers toward memorizing a lineup rather
than understanding a design. The architecture is the durable part.

Where a specific genuinely carries the point, put it in a dated callout
(below) and cite the provider's own documentation so the reader can check
it against current reality.

### Dating claims

The AI infrastructure landscape moves faster than the book will. Any claim that
will rot gets marked:

> **As of early 2026.** Anthropic's prompt caching charges a write premium and
> discounts reads. Verify current pricing before you model this.

Use this for: model names, prices, context window sizes, library APIs, benchmark
numbers, and anything a vendor controls. Do not use it for architectural
principles — those are the durable part, and marking them signals you are not
confident in them.

---

## 2. The chapter template

Every chapter has these fifteen sections, in this order, with these exact H2
headings. No additions, no reordering, no omissions. If a section has nothing to
say, the chapter is not ready.

```markdown
# Chapter N — Title

> One-sentence thesis. What this chapter argues, not what it covers.

## Learning Objectives
## The Production Story
## Why This Exists
## Core Concepts
## Internal Architecture
## Production Design
## Failure Scenarios
## Scaling Strategy
## Trade-offs
## Code Walkthrough
## Hands-On Lab
## Interview Questions
## Staff-Level Answers
## Exercises
## Further Reading
```

### What goes in each section

**Learning Objectives** — 4–6 bullets, each starting with a verb. Concrete enough
to test. "Explain why X" is fine. "Understand X" is not.

**The Production Story** — 200–400 words. A specific incident, opening the chapter
with a real problem. Anonymize employers, keep the technical detail exact. This is
the section that makes the book worth buying; do not phone it in. Every story ends
at the moment of confusion, not the resolution — the chapter is the resolution.

**Why This Exists** — The problem the component solves and, crucially, what people
did before it existed and why that stopped working. Historical framing beats
feature lists.

**Core Concepts** — Definitions and mental models. Aggressively short. If a reader
already knows the domain they should be able to skip this section entirely without
losing the chapter.

**Internal Architecture** — How the thing works underneath. At least one diagram.
This is where the depth lives.

**Production Design** — How you actually deploy it: topology, sizing, config that
matters, config that does not. Concrete numbers.

**Failure Scenarios** — Minimum three. Each formatted as:

```markdown
### Failure: <name>

**Symptom.** What the on-call engineer sees.
**Mechanism.** What is actually happening.
**Detection.** The specific metric or log line.
**Mitigation.** What you do at 3 a.m.
**Prevention.** What you change so it does not recur.
```

**Scaling Strategy** — What breaks first, second, and third as load grows. Give
the order of magnitude at which each breaks.

**Trade-offs** — A table. Columns: Decision | Buys you | Costs you | Choose when.
No decision has only benefits.

**Code Walkthrough** — Real, runnable, from `examples/`. Annotated. See §3.

**Hands-On Lab** — Something the reader can run in under 20 minutes with Docker.
Include the expected output so they know if it worked.

**Interview Questions** — 6–10 questions. Mix of "explain" and "design."

**Staff-Level Answers** — Model answers to every question above. A staff answer
names the trade-off and picks a side; a senior answer only describes the options.
Show the difference explicitly at least once per chapter.

**Further Reading** — Papers, docs, conference talks. Annotated with why each is
worth the reader's time. 4–8 entries. No filler links.

---

## 3. Code conventions

**Primary language: TypeScript.** Node 20+, ESM, strict mode. The author's
strongest language, and platform-layer code (gateways, routers, orchestrators) is
genuinely well-served by it.

**Secondary language: Python.** Used where the ecosystem forces it — embeddings,
evaluation harnesses, anything touching a model directly. Not used to duplicate a
TypeScript example.

Rules:

- **Every snippet in the book comes from a file in `examples/`.** Never retyped
  into the manuscript by hand. If it drifts, the reader will find out and stop
  trusting the book.
- **Every example runs from `docker compose up`.** No "assume you have Postgres."
- **Error handling is not omitted for brevity.** The error handling *is* the
  lesson in most of these chapters. If a snippet must be trimmed, trim the happy
  path and say so.
- **No secrets, no real endpoints, no employer-identifying config.**
- **Line length ≤ 80 characters.** Print margins are unforgiving, and Kindle is
  worse.
- **Annotate with numbered callouts**, not inline comments:

  ```ts
  const res = await router.dispatch(req);   // (1)
  ```

  Then a numbered list below the block explaining each callout.

---

## 4. Diagram conventions

**Mermaid, inline in the Markdown.** Source in the manuscript, rendered by MkDocs,
pre-rendered to SVG for EPUB and print.

- **Flow direction: top to bottom** (`graph TB`) unless the diagram is a pipeline,
  in which case left to right.
- **Maximum 12 nodes.** Above that, split into two diagrams. A 30-node diagram
  communicates that the system is complicated, and nothing else.
- **Label every edge** that is not obvious. Unlabeled arrows are a wish, not a
  design.
- **Every diagram has a caption** in italics below it, one sentence, explaining
  what the reader should take away.
- **No color as the only signal.** Print is grayscale and some readers are
  colorblind. Use shape and label.

Node shape convention, used consistently across all chapters:

| Shape | Means | Mermaid |
| --- | --- | --- |
| Rectangle | Service you operate | `A[Service]` |
| Rounded | External / third-party | `B(Provider API)` |
| Cylinder | Datastore | `C[(Postgres)]` |
| Diamond | Decision point | `D{Cache hit?}` |
| Hexagon | Queue or stream | `E{{Kafka topic}}` |

---

## 5. Terminology

Pick one and never vary:

| Use | Not |
| --- | --- |
| LLM gateway | AI gateway, model proxy, LLM proxy |
| provider | vendor, backend, upstream model |
| retrieval | RAG pipeline (reserve "RAG" for the pattern itself) |
| agent runtime | agent framework, agent engine |
| eval | evaluation suite, evals (plural only when countable) |
| tenant | customer, org, account |
| request | call, invocation, completion |
| token budget | context budget, token limit |

Capitalization: Kafka, Redis, Postgres (not PostgreSQL in body text), Kubernetes,
FastAPI, OpenTelemetry, Mermaid. Lowercase: embedding, chunking, prompt, gateway,
sharding.

---

## 6. Definition of done

A chapter ships when every box is checked:

- [ ] All fifteen sections present and non-trivial
- [ ] Production Story is specific, anonymized, and ends before the resolution
- [ ] At least one Mermaid diagram, ≤12 nodes, captioned
- [ ] At least three failure scenarios in the five-field format
- [ ] Trade-offs table with a populated "Costs you" column for every row
- [ ] Code compiles and runs from `examples/chNN-slug/`
- [ ] Lab is under 20 minutes and states expected output
- [ ] Every volatile claim carries an "as of" marker
- [ ] Zero banned hype words
- [ ] Terminology matches §5
- [ ] Further Reading has 4–8 annotated entries
- [ ] Technical review pass done (separately)
- [ ] Copy edit pass done (separately)
