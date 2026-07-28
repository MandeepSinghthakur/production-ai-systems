# Chapter 20 - Conversational Memory

Demonstrates conversation memory management strategies: sliding windows,
token budget enforcement, summarization, and key fact extraction.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all six steps with 16 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

A conversation that exceeds the model's context window must be trimmed.
The question is what to keep and what to discard. Different strategies
trade off recency against importance, and simplicity against precision.

This example demonstrates three approaches:

1. **Sliding window** - Keep the last N turns, drop the oldest.
   Simple and predictable but loses early context.

2. **Token buffer with eviction** - Stay within a token budget,
   evict based on configurable strategies (FIFO, importance, hybrid).

3. **Summarization with fact extraction** - Compress old history into
   a summary while preserving key facts. More complex but retains
   important information.

## Layout

```
src/
  types.ts          Core types: Message, Turn, KeyFact, MemoryConfig
  tokenizer.ts      Token counting (word-based approximation)
  sliding-window.ts Sliding window memory management
  summary.ts        Conversation summarization and fact extraction
  buffer.ts         Token buffer with eviction strategies
  memory.ts         Combined memory manager
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Token counting accuracy (within 30% of actual) |
| 2 | Sliding window stays under token budget |
| 3 | Summary preserves key facts from compressed history |
| 4 | Token buffer eviction is deterministic |
| 5 | Memory manager automatic compression |
| 6 | Facts persist through compression cycles |

## Token counting

Real implementations use model-specific tokenizers (tiktoken for OpenAI,
etc.). This example uses a word-based approximation:

- Short words (<=3 chars): 1 token
- Medium words (<=8 chars): ~1.3 tokens
- Long words: ~length/4 tokens
- Punctuation: ~0.5 tokens each

This is within 30% of actual for English text, sufficient for memory
management decisions.

## Eviction strategies

| Strategy | How it works | Use when |
| --- | --- | --- |
| FIFO | Evict oldest turns first | Recency matters most |
| Importance | Evict lowest importance first | Some turns are critical |
| Hybrid | FIFO within importance tiers | Balance of both |

## Fact categories

The summarizer extracts facts in these categories:

- **name** - User's name or identity
- **preference** - User preferences and settings
- **goal** - What the user is trying to accomplish
- **constraint** - Requirements and limitations
- **decision** - Decisions made during conversation

Facts persist through compression cycles, so "My name is Alice" from
turn 1 remains available even after turn 1 is summarized.

## Things worth breaking on purpose

- Set maxTokens very low (100) and observe aggressive compression.

- Disable fact extraction and observe information loss through
  compression.

- Use FIFO eviction with high-importance early turns and observe
  them being evicted anyway.

- Set slidingWindowTurns higher than your turn count and observe
  no compression happens.
