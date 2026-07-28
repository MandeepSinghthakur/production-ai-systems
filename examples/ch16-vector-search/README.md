# Chapter 16 — Vector Databases and Hybrid Search

Demonstrates vector similarity search, BM25 keyword search, and
Reciprocal Rank Fusion (RRF) for combining both into a hybrid
retrieval system.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Vector search and BM25 fail on different queries:

- **Vector search** finds semantically similar documents but misses
  exact keywords. A query for "database server" might return documents
  about "network infrastructure" because the embeddings are similar.

- **BM25** matches exact keywords but misses semantic similarity. A
  query for "money costs" will not find a document about "financial
  budget" unless those exact words appear.

**Hybrid search** runs both methods, then combines results using
Reciprocal Rank Fusion (RRF). RRF converts scores to ranks, making
fusion immune to score scale differences.

## Layout

```
src/
├── types.ts          Document, Chunk, SearchResult types
├── embedding.ts      Deterministic embedding simulation
├── vector-index.ts   In-memory vector index with cosine similarity
├── bm25.ts           BM25 keyword search
├── fusion.ts         RRF and weighted rank fusion
└── hybrid.ts         Hybrid search combining both methods
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Embeddings are deterministic and normalized |
| 2 | Cosine similarity reflects semantic similarity |
| 3 | Vector index search finds semantically similar docs |
| 4 | BM25 search finds exact keyword matches |
| 5 | RRF fuses ranked lists, promoting consensus |
| 6 | Hybrid search recall >= max(vector, BM25) recall |
| 7 | Vector catches semantic matches BM25 misses |
| 8 | BM25 catches exact keywords vector might miss |
| 9 | Weighted fusion allows tuning vector vs BM25 |
| 10 | Rank correlation measures retriever agreement |
| 11 | Precision, recall, MRR metrics work correctly |
| 12 | Full evaluation across mixed query types |
| 13 | **The assertion**: RRF is scale-invariant |

## Things worth breaking on purpose

- Remove the BM25 results from hybrid fusion and observe degraded
  performance on keyword-heavy queries like "database server".

- Set vectorWeight to 0.0 or 1.0 and watch hybrid become equivalent
  to a single method.

- Change the RRF constant k from 60 to 1 and observe how it changes
  the relative importance of ranks.
