# Chapter 15 — Chunking Strategies

Demonstrates why money canonicalization fails in BM25 search, and why
treating stated amounts as filters (constraints) rather than search
terms (hints) fixes the problem.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with 28 assertions, exits non-zero if any
fail. Takes about one second.

## The key insight

Canonicalizing `$300,000` to `money:30000000` was supposed to fix
numeric recall by normalizing different formats (`$300K`, `$0.3M`) to
a single token. It does not help, and here is why:

1. BM25 scores the canonical token as one term among many.
2. The token `money:300000000` (three million) contains `money:30000000`
   (three hundred thousand) as a prefix.
3. Substring collisions inflate scores for wrong documents.

The fix: a stated amount is a **constraint**, not a hint. Extract the
amount from the query, filter the corpus to documents containing that
exact amount, then run BM25 on the filtered set.

## Layout

```
src/
├── types.ts          Document, Chunk, SearchResult types
├── normalizer.ts     Money parsing and canonicalization
├── chunker.ts        Document chunking
├── bm25.ts           BM25 search implementation
├── filter.ts         Amount extraction and filtering (the fix)
└── retriever.ts      Combined search with optional filtering
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Money parsing handles $300K, $0.3M, $300,000 correctly |
| 2 | BM25 baseline works for text queries |
| 3 | Canonicalization produces expected tokens |
| 4 | **The bug**: `money:300000000` contains `money:30000000` as prefix |
| 5 | Recall with canonicalization alone (baseline) |
| 6 | **The fix**: amount filter removes distractors |
| 7 | Filter handles format variations ($300K = $300,000) |
| 8 | Filter precision >= canonicalization precision |
| 9 | Amount extraction from queries |
| 10 | Chunk amounts are correctly stored |
| 11 | Direct filter function correctness |
| 12 | Real-world query scenario |
| 13 | **The assertion**: integer comparison vs string includes() |

## Things worth breaking on purpose

- Remove the `amountFilter` logic from the retriever and watch the $3M
  document appear in results for "$300K" queries.

- Change `checkSubstringCollision` to use exact equality instead of
  `includes()` and observe that the collision detection fails — the bug
  that motivated this whole chapter.

- Try searching for "$30,000" and verify that *it* does not incorrectly
  match "$300,000" documents. The filter is bidirectional: smaller
  amounts do not match larger amounts either.
