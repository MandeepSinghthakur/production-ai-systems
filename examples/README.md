# Examples

One directory per chapter. Every example runs on Node 22.6+ with no
dependencies — Node strips the TypeScript types at load time, so there
is no build step and no `npm install`.

| Directory | Chapter | Verified by CI |
| --- | --- | --- |
| `ch18-llm-gateway/` | 18 — The LLM Gateway | yes |

## Why each example has a `lab.mjs`

Technical books rot because their claims are prose. This one asserts
them. `scripts/lab.mjs` in each example reproduces the chapter's lab and
checks the numbers the chapter quotes, exiting non-zero when they do not
hold. CI runs it on every commit.

If you change an example and the chapter's numbers move, CI tells you
before a reader does.
