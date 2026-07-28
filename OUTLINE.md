# Outline

Canonical table of contents. 34 chapters, 8 parts, ~480 pages.

This replaces every earlier draft outline. Those had 11, 9, and 9 parts
respectively with heavy overlap (Redis appeared in three different parts; RAG was
both Part III and Part IV; "Interview Prep" was sometimes a part and sometimes a
suffix on every chapter). One outline, or the book never converges.

**Status values:** `—` not started · `draft` first pass done · `tech` technical
review passed · `copy` copy edit passed · `done` shipped

---

## Structural decisions

Three things worth stating explicitly, because they are the decisions that make
this book different from the four other AI books published this quarter.

**1. Interview material is a section inside every chapter, not a part at the end.**
Earlier drafts had a Part IX for interview prep. That structure ages badly — it
makes the book a study guide with a reference book bolted on. Folding
questions and staff-level answers into each chapter means the book stays useful
after the reader gets the job, which roughly triples its shelf life.

**2. The platform layer comes before agents.** Most books teach agents first
because they demo well. But an agent is a program that runs on a platform, and if
the reader does not already understand gateways, routing, memory, and evaluation,
the agent chapters degrade into framework tutorials. Part V before Part VI is
deliberate.

**3. Distributed systems foundations are compressed, not expanded.** Kleppmann
already wrote that book and wrote it better. Five chapters, framed specifically
around what breaks differently when the workload is LLM inference: 40-second
p99s, token-based rather than request-based capacity, streaming responses that
hold connections open, and providers you cannot page.

---

## Part I — Distributed Systems Foundations (~65 pages)

*Framing: what changes about classic distributed systems when a single request
takes 40 seconds and costs real money.*

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 1 | Distributed Systems for AI Workloads | 14 | — |
| 2 | Scaling Stateless and Streaming APIs | 12 | — |
| 3 | Load Balancing Long-Lived Connections | 12 | — |
| 4 | Caching: Redis Deep Dive | 15 | — |
| 5 | Postgres at Scale | 12 | — |

## Part II — Data and Event Infrastructure (~55 pages)

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 6 | Kafka Internals | 16 | — |
| 7 | Event-Driven Architecture Patterns | 14 | — |
| 8 | Outbox, Saga, and Exactly-Once | 14 | — |
| 9 | Observability and OpenTelemetry | 11 | — |

## Part III — LLM Fundamentals (~50 pages)

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 10 | How Transformers Actually Serve Requests | 14 | — |
| 11 | Tokenization and Context Windows | 12 | — |
| 12 | Embeddings | 12 | — |
| 13 | Streaming and Token Economics | 12 | — |

## Part IV — Retrieval (~65 pages)

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 14 | Document Ingestion and OCR | 15 | — |
| 15 | Chunking Strategies | 14 | — |
| 16 | Vector Databases and Hybrid Search | 18 | — |
| 17 | Re-ranking and Retrieval Evaluation | 18 | — |

## Part V — The AI Platform (~95 pages)

*The core of the book. Almost nothing published covers this layer well.*

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 18 | The LLM Gateway | 18 | **draft** |
| 19 | Multi-Provider Routing and Failover | 16 | **draft** |
| 20 | Conversational Memory | 16 | — |
| 21 | Evaluation Pipelines | 18 | — |
| 22 | AI Security and Prompt Injection | 16 | — |
| 23 | Cost Control and Capacity Planning | 11 | — |

## Part VI — Agentic AI (~60 pages)

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 24 | Tool Calling and Tool Security | 15 | — |
| 25 | Planning, Reflection, and ReAct | 14 | — |
| 26 | The Model Context Protocol | 15 | — |
| 27 | Multi-Agent Systems and Orchestration | 16 | — |

## Part VII — System Design (~60 pages)

*Each chapter is a complete design walkthrough with requirements, capacity
estimates, architecture, and the follow-up questions an interviewer asks.*

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 28 | Design: A Conversational Assistant at Scale | 15 | — |
| 29 | Design: An AI Assistant in a Regulated Domain | 15 | — |
| 30 | Design: A Coding Agent | 15 | — |
| 31 | Design: A Multi-Tenant Agent Platform | 15 | — |

## Part VIII — Staff Engineering (~40 pages)

| # | Chapter | Pages | Status |
| --- | --- | --- | --- |
| 32 | Architecture Reviews and RFCs | 14 | — |
| 33 | Incident Management for AI Systems | 13 | — |
| 34 | Technical Strategy and Influence | 13 | — |

---

## Front and back matter (~35 pages)

| Item | Pages | Status |
| --- | --- | --- |
| Preface: who this is for | 4 | — |
| How to read this book | 3 | — |
| Appendix A: Glossary | 10 | — |
| Appendix B: Cheat sheets | 12 | — |
| Appendix C: Annotated bibliography | 6 | — |

---

## Suggested writing order

Not the reading order. Write from strength outward so the style stabilizes before
the hard chapters.

1. **Ch 18** — done. Sets the quality bar.
2. **Ch 19, 23** — adjacent to 18, reuse its examples and diagrams. Ch 19
   drafted; its example is not built yet (see Known gaps).
3. **Ch 4, 6** — well-trodden ground, fast to write, builds momentum.
4. **Ch 14–17** — the retrieval block, written as a unit so the pipeline is
   coherent end to end.
5. **Ch 20, 21, 22** — the rest of Part V.
6. **Ch 24–27** — agents, written last among the technical parts because the
   ecosystem is moving fastest here and later drafts age less.
7. **Ch 28–31** — system design, which is mostly assembly of earlier chapters.
8. **Ch 1–3, 5, 7–13** — foundations, written last. Counterintuitive, but you
   will not know what foundations the book actually needs until the AI chapters
   exist, and writing them first guarantees you over-explain.
9. **Ch 32–34, front matter, appendices.**


---

## Known gaps

Recorded here rather than left to be discovered, because an unrecorded gap
becomes a promise the book does not keep.

| Gap | Impact | Fix |
| --- | --- | --- |
| `examples/ch19-routing/` does not exist | Chapter 19's Code Walkthrough and Lab reference files that are not in the repo. The snippets are correct but unverified. | Build it to the ch18 pattern: two mock providers, one with a 3% nested-field regression, plus `scripts/lab.mjs` asserting the chapter's four steps. |
| CI verifies chapter 18 only | Chapter 19's numbers are prose, not assertions. | Add `examples/ch19-routing` to the `verify-examples` job once built. |
| No EPUB or print pipeline | Web only. | Deliberate. Not before eight chapters exist — see README. |
| `USERNAME` placeholder in `mkdocs.yml` and `book/index.md` | Repo and edit links 404. | `sh setup.sh <username>` on first clone. |
| Executable bit is not preserved through archiving | `./setup.sh` fails with permission denied. | Invoke as `sh setup.sh`, or `chmod +x setup.sh` after extracting. |

A chapter whose example does not exist is `draft`, never `tech`. Chapter 19
cannot advance past `draft` until its lab runs green in CI.
