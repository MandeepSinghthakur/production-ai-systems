# Building Production AI Systems

**Distributed Systems, Agentic AI, and LLM Infrastructure at Scale**

---

## Quickstart

## What this book is

Most AI books teach you how to call an LLM API. This one teaches you how to build
the platform that sits behind it: the gateway, the retrieval layer, the agent
runtime, the evaluation harness, and the operational discipline that keeps all of
it alive at 3 a.m.

It assumes you already know how to write software. It does not assume you have
ever run an LLM system in production.

**Target reader:** Senior → Staff → Principal engineers, AI platform engineers,
ML infrastructure engineers, architects. People whose one-line summary is
*"I know software engineering. Teach me how production AI systems actually work."*

**Not the target reader:** Beginners, people looking for prompt-engineering tips,
people who want a LangChain tutorial.

---

## Honest scope note

This manuscript is roughly 480 pages. That is somewhere between 180,000 and
220,000 words. No language model — this one included — can emit that in a single
response, or ten. Anyone who tells you otherwise is describing a plan, not a
deliverable.

The only workflow that actually finishes a book is the one real technical
publishers use: **a repo, a style guide, and one chapter at a time.** That is what
this directory is.

A chapter is "done" when it passes the checklist in `STYLE-GUIDE.md`, not when it
hits a word count.

---

## Repo layout

```
production-ai-systems/
├── README.md              ← you are here
├── OUTLINE.md             ← canonical table of contents + page budgets + status
├── STYLE-GUIDE.md         ← chapter template, voice, code and diagram conventions
├── book/                  ← the manuscript, one file per chapter
│   └── ch18-llm-gateway.md
├── examples/              ← runnable code, one directory per chapter
├── diagrams/              ← exported diagram assets (Mermaid source lives inline)
└── website/               ← companion site build
```

`OUTLINE.md` is the single source of truth for what exists and what does not.
Update the status column when a chapter lands. If it is not in the outline, it is
not in the book.

---

## Writing workflow

1. **Pick the next chapter** from `OUTLINE.md`. Order is a suggestion, not a
   constraint — write the chapters you know best first, so the style stabilizes
   before you hit the hard ones.
2. **Draft against the template** in `STYLE-GUIDE.md`. Every chapter has the same
   fifteen sections in the same order. The consistency is the product.
3. **Write the code first, then the prose.** If the example does not run, the
   chapter is wrong. Code lives in `examples/chNN-slug/` and is included into the
   chapter by reference, never retyped.
4. **Technical review pass.** Every claim about a system's internals gets a
   citation in the Further Reading section or gets cut.
5. **Copy edit pass.** Separate from the technical pass. Do not combine them.

`book/ch18-llm-gateway.md` is the reference implementation of all five steps. It
is the quality bar. If a later chapter is worse than that one, it is not finished.

---

## Build targets

| Format | Toolchain | Notes |
| --- | --- | --- |
| Website | MkDocs Material | Mermaid renders natively, full-text search |
| PDF (print) | Pandoc → LaTeX | 7×10 trim, needs a real template |
| EPUB | Pandoc | Mermaid must be pre-rendered to SVG |
| Kindle | KDP from EPUB | Reflowable; code blocks need width testing |
| Paperback | KDP Print | Bleed and gutter on every diagram |

Do not touch the build pipeline until eight chapters are drafted. Building a
publishing toolchain is a very satisfying way to avoid writing a book.

---

## Current status

| Item | State |
| --- | --- |
| Outline | Locked (34 chapters, 8 parts) |
| Style guide | Locked |
| Chapters drafted | 2 of 34 |
| Examples runnable | 1 of 34 (ch18, verified in CI) |
| Diagrams | Inline Mermaid only |
| Website | Not started |

See `OUTLINE.md` for per-chapter status.
