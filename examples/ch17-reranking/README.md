# Chapter 17 — Re-ranking and Retrieval Evaluation

Demonstrates how cross-encoder re-ranking improves retrieval quality,
how to measure that improvement, and when the latency cost is worth it.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs eleven steps with 19 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Bi-encoder retrieval (embedding similarity, BM25) is fast but imprecise.
Cross-encoder re-ranking is slow but accurate. The cascade architecture
combines both: fast retrieval returns top-N candidates, then the
re-ranker scores those N and reorders them.

The tradeoff is quantifiable:
- Re-ranking 10 documents at 5ms each adds 50ms latency
- Precision@5 typically improves 20-40%
- Quality gains diminish past depth 15-20 for most corpora

## Layout

```
src/
├── types.ts          Type definitions
├── dataset.ts        Sample corpus and relevance judgments
├── metrics.ts        Precision@k, Recall@k, MRR, NDCG
├── reranker.ts       Cross-encoder re-ranker simulation
├── evaluator.ts      Evaluation harness
└── tradeoffs.ts      Latency vs quality measurement
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Metric calculations are correct on known inputs |
| 2 | BM25 baseline retrieval works |
| 3 | **Re-ranker improves precision@5 by at least 20%** |
| 4 | **NDCG increases after re-ranking** |
| 5 | **Latency scales proportionally with re-rank depth** |
| 6 | **Quality gains diminish past certain depth** |
| 7 | MRR (first relevant result) improves |
| 8 | Recall@K behavior with re-ranking |
| 9 | Latency budget determines max re-rank depth |
| 10 | Per-query variance in improvement |
| 11 | Cascade architecture beats retrieve-only |

## Metrics explained

- **Precision@K**: What fraction of top K results are relevant?
- **Recall@K**: What fraction of all relevant documents are in top K?
- **MRR**: Where does the first relevant result appear? (1/rank)
- **NDCG**: How good is the ranking overall? (accounts for position)

## Things worth breaking on purpose

- Set `relevanceBoost: 0` in the reranker config and watch precision
  improvements disappear — the re-ranker is no longer identifying
  relevant documents.

- Increase `latencyPerDocMs` to 50 and observe total latency grow
  to hundreds of milliseconds — this is why re-rank depth matters.

- Remove all relevance judgments from a query and watch metrics
  return degenerate values — evaluation requires ground truth.
