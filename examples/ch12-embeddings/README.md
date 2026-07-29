# Chapter 12: Embeddings

This example demonstrates embedding fundamentals for production systems: vector generation, similarity metrics, caching strategies, and drift detection.

## What This Demonstrates

1. **Embedding Generation** - Deterministic, normalized vector creation
2. **Similarity Metrics** - Cosine, dot product, and Euclidean distance
3. **Dimension Tradeoffs** - Storage, latency, and semantic resolution
4. **Caching** - Reducing redundant embedding computation
5. **Drift Detection** - Identifying when model updates change similarity relationships

## Running the Lab

```bash
# From repo root
node examples/ch12-embeddings/scripts/lab.mjs

# From this directory
node scripts/lab.mjs
```

## Expected Output

```
Step 1 - embeddings are deterministic
  [PASS] same text produces identical embedding
  [PASS] different text produces different embedding

Step 2 - embeddings are normalized
  [PASS] embedding 1 has unit magnitude
  [PASS] embedding 2 has unit magnitude

Step 3 - cosine similarity bounds
  [PASS] identical vectors have similarity 1.0
  [PASS] cosine similarity is within [-1, 1]
  [PASS] cosine similarity validation works

...

Step 16 - near-duplicate detection
  [PASS] identical texts are detected as near-duplicates
  [PASS] different texts are not near-duplicates

38/38 checks passed
```

## Key Files

- `src/types.ts` - Embedding, similarity, cache, and drift types
- `src/embedding.ts` - Deterministic embedding generation with semantic clusters
- `src/similarity.ts` - Cosine, dot product, and Euclidean similarity metrics
- `src/caching.ts` - LRU cache for embeddings with model version awareness
- `src/drift.ts` - Drift detection and reindex recommendations

## Key Concepts

### Why Normalize Embeddings?

Normalized vectors (magnitude = 1) make cosine similarity equal to the dot product:

```
cosine(a, b) = dot(a, b) / (|a| * |b|)
```

When `|a| = |b| = 1`:

```
cosine(a, b) = dot(a, b)
```

This is 2x faster (one operation instead of three) and numerically stable.

### Why Cache by Model Version?

The same text produces different embeddings with different model versions. Serving a cached v1 embedding when the request expects v2 silently degrades search quality. The cache key must include model version.

### Why Detect Drift?

When embedding models are updated, all stored embeddings become stale. Drift detection identifies whether:
1. The change is uniform (rankings stay the same)
2. The change affects relative similarities (rankings change, search quality degrades)

Only the second case requires reindexing.
