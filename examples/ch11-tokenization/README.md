# Chapter 11 - Tokenization and Context Windows

Demonstrates tokenization, token counting strategies, context window
management, and truncation strategies for LLM workloads. Models
tokenizer behavior in pure TypeScript.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with 41 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Tokens are not words. A single English word might become 1-4 tokens
depending on the vocabulary. Numbers, punctuation, and whitespace all
consume tokens. Understanding this mismatch is critical for capacity
planning and cost control.

## Layout

```
src/
  types.ts          Core types: Token, TokenEstimate, ContextConfig
  tokenizer.ts      BPE-style tokenizer simulation
  counting.ts       Token counting and estimation strategies
  context.ts        Context window management
  truncation.ts     Truncation strategies for fitting limits
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Token count differs from word count |
| 2 | Tokenizer behavior: roundtrip, positions, truncation |
| 3 | Token estimation accuracy across methods |
| 4 | Token budget calculation for context windows |
| 5 | Context window management with message fitting |
| 6 | Sliding window behavior for long conversations |
| 7 | Truncation strategies: head, tail, middle, sentence |
| 8 | No truncation when content fits |
| 9 | Smart document truncation preserving structure |
| 10 | Batch truncation with shared budget |
| 11 | Priority-based context selection |
| 12 | Output budget calculation and constraints |
| 13 | Token estimation confidence bounds |

## Why tokens matter for cost

LLM pricing is per-token, not per-character or per-word. A request
that appears similar in length can vary by 2x in token count depending
on vocabulary, special characters, and whitespace. Cost estimation
without token awareness is unreliable.

| Text type | Tokens per word (approx) |
| --- | --- |
| English prose | 1.2-1.4 |
| Code | 1.5-2.0 |
| JSON/XML | 2.0-3.0 |
| Technical terms | 1.5-2.5 |
| Numbers | 1.0 per 1-3 digits |

## Context window management strategies

Different strategies for different use cases:

| Strategy | Best for | Trade-off |
| --- | --- | --- |
| Sliding window | Chatbots | Loses early context |
| Priority-based | Task assistants | Requires manual scoring |
| Summary-based | Long documents | Summary may lose details |
| Truncation | RAG context | Abrupt information loss |

## Truncation strategies

| Strategy | Keeps | Best for |
| --- | --- | --- |
| Head | Beginning | Narratives, documents |
| Tail | End | Logs, recent history |
| Middle | Both ends | Documents with intro/conclusion |
| Sentence | Complete sentences | Prose that reads naturally |

## Things worth breaking on purpose

- Set maxTokens to 0 in the tokenizer and observe truncation behavior.

- Use a token budget smaller than the system prompt and observe
  constraint violations.

- Set sliding window to 1 turn and observe minimal context retention.

- Use very aggressive truncation limits and observe information loss.
