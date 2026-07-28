// Reproduces every numbered step of the Chapter 16 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch16-vector-search)
//   node examples/ch16-vector-search/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { embed, cosineSimilarity, getDimensions } =
  await import(resolve(srcDir, 'embedding.ts'));
const { createVectorIndex, indexCorpus } =
  await import(resolve(srcDir, 'vector-index.ts'));
const { createBM25Index, tokenize } =
  await import(resolve(srcDir, 'bm25.ts'));
const { reciprocalRankFusion, weightedRankFusion, rankCorrelation } =
  await import(resolve(srcDir, 'fusion.ts'));
const { createHybridIndex, calculateRecall, calculatePrecision, calculateMRR } =
  await import(resolve(srcDir, 'hybrid.ts'));

// ---------------------------------------------------------------------
// Test corpus: documents with varying semantic and keyword content
// ---------------------------------------------------------------------

const documents = [
  {
    id: 'doc1',
    text: 'The software system processed payment transactions efficiently.',
  },
  {
    id: 'doc2',
    text: 'Financial budget allocation requires careful cost analysis.',
  },
  {
    id: 'doc3',
    text: 'The contract was signed after legal review of all clauses.',
  },
  {
    id: 'doc4',
    text: 'Database server maintenance scheduled for next quarter.',
  },
  {
    id: 'doc5',
    text: 'Investment revenue exceeded profit expectations this fiscal year.',
  },
  {
    id: 'doc6',
    text: 'Technology infrastructure upgrade completed on schedule.',
  },
  {
    id: 'doc7',
    text: 'The agreement binding both parties includes warranty provisions.',
  },
  {
    id: 'doc8',
    text: 'Algorithm optimization reduced processing time by half.',
  },
  {
    id: 'doc9',
    text: 'Annual expense report submitted before the deadline.',
  },
  {
    id: 'doc10',
    text: 'Network security audit found no critical vulnerabilities.',
  },
];

// Test queries with expected relevant documents
const testQueries = [
  {
    query: 'payment processing system',
    // Semantic: doc1 (payment, system), doc8 (processing, algorithm)
    // Keyword: doc1 (payment, system, processed)
    relevant: ['doc1'],
    type: 'keyword-heavy',
  },
  {
    query: 'money and financial costs',
    // Semantic: doc2 (financial, budget, cost), doc5 (investment, revenue, profit)
    // Keyword: doc2 (financial, cost)
    relevant: ['doc2', 'doc5'],
    type: 'semantic',
  },
  {
    query: 'legal agreement contract',
    // Semantic: doc3 (contract, legal, clauses), doc7 (agreement, binding, party)
    // Keyword: doc3 (contract, legal), doc7 (agreement)
    relevant: ['doc3', 'doc7'],
    type: 'mixed',
  },
  {
    query: 'database server',
    // Exact keyword match: doc4
    relevant: ['doc4'],
    type: 'keyword-heavy',
  },
  {
    query: 'computer technology systems',
    // Semantic: doc6 (technology, infrastructure), doc4 (server), doc1 (system)
    // This query tests vector search catching semantic similarity
    relevant: ['doc1', 'doc4', 'doc6'],
    type: 'semantic',
  },
];

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  if (typeof actual === 'number') {
    console.log(`         expected ${expectation}, observed ${actual.toFixed(4)}`);
  } else {
    console.log(`         expected ${expectation}, observed ${actual}`);
  }
}

// ---------------------------------------------------------------------
// Step 1 - Embedding produces deterministic, normalized vectors
// ---------------------------------------------------------------------

console.log('\nStep 1 - embedding properties');

const embed1 = embed('payment processing system');
const embed2 = embed('payment processing system');
const embed3 = embed('financial budget cost');

check(
  'same text produces same embedding',
  JSON.stringify(embed1) === JSON.stringify(embed2),
  (v) => v === true,
  'true (deterministic)'
);

check(
  'embedding has correct dimensions',
  embed1.length,
  (v) => v === getDimensions(),
  `${getDimensions()}`
);

// Check normalization (magnitude should be 1.0)
const magnitude = Math.sqrt(embed1.reduce((sum, v) => sum + v * v, 0));
check(
  'embedding is normalized to unit length',
  Math.abs(magnitude - 1.0) < 0.0001,
  (v) => v === true,
  'true (magnitude = 1.0)'
);

// ---------------------------------------------------------------------
// Step 2 - Cosine similarity reflects semantic similarity
// ---------------------------------------------------------------------

console.log('\nStep 2 - semantic similarity');

const paymentEmbed = embed('payment money financial');
const budgetEmbed = embed('budget cost expense');
const databaseEmbed = embed('database server network');
const contractEmbed = embed('contract agreement legal');

// Similar concepts should have higher similarity
const financeSim = cosineSimilarity(paymentEmbed, budgetEmbed);
const unrelatedSim = cosineSimilarity(paymentEmbed, databaseEmbed);

check(
  'related terms have higher similarity',
  financeSim > unrelatedSim,
  (v) => v === true,
  'true (finance terms more similar to each other)'
);

check(
  'finance similarity is positive',
  financeSim,
  (v) => v > 0.3,
  '> 0.3'
);

// ---------------------------------------------------------------------
// Step 3 - Vector index search works
// ---------------------------------------------------------------------

console.log('\nStep 3 - vector index search');

const vectorIndex = createVectorIndex();
for (const doc of documents) {
  const embedding = embed(doc.text);
  vectorIndex.add({
    docId: doc.id,
    chunkIndex: 0,
    text: doc.text,
    embedding,
  });
}

const vectorResults = vectorIndex.search('payment processing', 5);

check(
  'vector search returns results',
  vectorResults.length,
  (v) => v > 0,
  '> 0'
);

check(
  'vector search finds doc1 (payment processing)',
  vectorResults.some((r) => r.docId === 'doc1'),
  (v) => v === true,
  'true'
);

// Verify scores are in descending order
const vectorScoresDescending = vectorResults.every(
  (r, i) => i === 0 || r.score <= vectorResults[i - 1].score
);
check(
  'vector results sorted by score descending',
  vectorScoresDescending,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 4 - BM25 index search works
// ---------------------------------------------------------------------

console.log('\nStep 4 - BM25 index search');

const bm25Index = createBM25Index();
for (const doc of documents) {
  bm25Index.add(doc.id, 0, doc.text);
}

const bm25Results = bm25Index.search('database server', 5);

check(
  'BM25 search returns results',
  bm25Results.length,
  (v) => v > 0,
  '> 0'
);

check(
  'BM25 finds doc4 (database server)',
  bm25Results[0]?.docId === 'doc4',
  (v) => v === true,
  'true (exact keyword match ranks first)'
);

// ---------------------------------------------------------------------
// Step 5 - RRF fusion combines ranked lists
// ---------------------------------------------------------------------

console.log('\nStep 5 - Reciprocal Rank Fusion');

// Create two different ranked lists
const listA = [
  { docId: 'doc1', chunkIndex: 0, score: 0.9, text: 'a' },
  { docId: 'doc2', chunkIndex: 0, score: 0.8, text: 'b' },
  { docId: 'doc3', chunkIndex: 0, score: 0.7, text: 'c' },
];
const listB = [
  { docId: 'doc2', chunkIndex: 0, score: 0.95, text: 'b' },
  { docId: 'doc1', chunkIndex: 0, score: 0.85, text: 'a' },
  { docId: 'doc4', chunkIndex: 0, score: 0.75, text: 'd' },
];

const fused = reciprocalRankFusion([listA, listB], 60);

check(
  'RRF produces results',
  fused.length,
  (v) => v > 0,
  '> 0'
);

// doc2 should rank highest: rank 1 in listB, rank 2 in listA
// doc1 should rank second: rank 1 in listA, rank 2 in listB
check(
  'RRF promotes items ranked high in both lists',
  fused[0].docId,
  (v) => v === 'doc1' || v === 'doc2',
  'doc1 or doc2 (both ranked high in one list)'
);

// doc3 only appears in listA, doc4 only appears in listB
// They should have lower RRF scores than items in both lists
const doc3Rank = fused.findIndex((r) => r.docId === 'doc3') + 1;
const doc4Rank = fused.findIndex((r) => r.docId === 'doc4') + 1;
check(
  'items in only one list rank lower',
  doc3Rank > 2 && doc4Rank > 2,
  (v) => v === true,
  'true (doc3 and doc4 rank below items in both lists)'
);

// ---------------------------------------------------------------------
// Step 6 - Hybrid search outperforms single-method on mixed queries
// ---------------------------------------------------------------------

console.log('\nStep 6 - hybrid search improvement');

const hybridIndex = createHybridIndex(vectorIndex, bm25Index);

// Test on a query where hybrid should help:
// "legal agreement contract" - needs both semantic (legal concepts) and
// keyword matching (exact terms)
const hybridQuery = 'legal agreement contract';
const hybridResults = hybridIndex.search(hybridQuery, { topK: 5 });
const vectorOnlyResults = hybridIndex.searchVector(hybridQuery, 5);
const bm25OnlyResults = hybridIndex.searchBM25(hybridQuery, 5);

const relevantLegal = ['doc3', 'doc7'];
const hybridRecall = calculateRecall(hybridResults, relevantLegal);
const vectorRecall = calculateRecall(vectorOnlyResults, relevantLegal);
const bm25Recall = calculateRecall(bm25OnlyResults, relevantLegal);

console.log(`  Hybrid recall: ${hybridRecall.toFixed(2)}`);
console.log(`  Vector recall: ${vectorRecall.toFixed(2)}`);
console.log(`  BM25 recall: ${bm25Recall.toFixed(2)}`);

check(
  'hybrid recall >= max(vector, BM25) recall',
  hybridRecall >= Math.max(vectorRecall, bm25Recall),
  (v) => v === true,
  'true (hybrid combines best of both)'
);

// ---------------------------------------------------------------------
// Step 7 - Vector search finds semantic matches BM25 misses
// ---------------------------------------------------------------------

console.log('\nStep 7 - vector catches semantic matches');

// Query using synonyms not in any document
const semanticQuery = 'money costs expenses finances';
const vectorSemanticResults = hybridIndex.searchVector(semanticQuery, 5);
const bm25SemanticResults = hybridIndex.searchBM25(semanticQuery, 5);

// doc2 and doc5 are about finance but may not have exact keyword matches
const financeDocs = ['doc2', 'doc5', 'doc9'];

const vectorFoundFinance = vectorSemanticResults.some(
  (r) => financeDocs.includes(r.docId)
);

check(
  'vector search finds semantic matches',
  vectorFoundFinance,
  (v) => v === true,
  'true (finds finance docs without exact keywords)'
);

// ---------------------------------------------------------------------
// Step 8 - BM25 matches exact keywords vector might miss
// ---------------------------------------------------------------------

console.log('\nStep 8 - BM25 catches exact keywords');

// Query with specific technical terms
const keywordQuery = 'algorithm optimization';
const vectorKeywordResults = hybridIndex.searchVector(keywordQuery, 3);
const bm25KeywordResults = hybridIndex.searchBM25(keywordQuery, 3);

// doc8 has exact match "Algorithm optimization"
const bm25FoundDoc8 = bm25KeywordResults.some((r) => r.docId === 'doc8');

check(
  'BM25 finds exact keyword match',
  bm25FoundDoc8,
  (v) => v === true,
  'true (doc8 has "algorithm optimization")'
);

// ---------------------------------------------------------------------
// Step 9 - Weighted fusion allows tuning
// ---------------------------------------------------------------------

console.log('\nStep 9 - weighted RRF fusion');

const weightedVectorHeavy = weightedRankFusion(
  [vectorResults.slice(0, 5), bm25Results.slice(0, 5)],
  [0.8, 0.2],
  60
);

const weightedBM25Heavy = weightedRankFusion(
  [vectorResults.slice(0, 5), bm25Results.slice(0, 5)],
  [0.2, 0.8],
  60
);

check(
  'weighted fusion produces different rankings',
  JSON.stringify(weightedVectorHeavy) !== JSON.stringify(weightedBM25Heavy),
  (v) => v === true,
  'true (weights affect final ranking)'
);

// ---------------------------------------------------------------------
// Step 10 - Rank correlation measures retriever agreement
// ---------------------------------------------------------------------

console.log('\nStep 10 - rank correlation');

// Query where vector and BM25 should agree (clear keywords and semantics)
const clearQuery = 'payment transaction';
const vectorClear = hybridIndex.searchVector(clearQuery, 5);
const bm25Clear = hybridIndex.searchBM25(clearQuery, 5);

const correlation = rankCorrelation(vectorClear, bm25Clear, 3);

check(
  'rank correlation is between 0 and 1',
  correlation >= 0 && correlation <= 1,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 11 - Precision and recall metrics work correctly
// ---------------------------------------------------------------------

console.log('\nStep 11 - evaluation metrics');

const mockResults = [
  { docId: 'doc1' },
  { docId: 'doc2' },
  { docId: 'doc3' },
];
const mockRelevant = ['doc1', 'doc2', 'doc4'];

const precision = calculatePrecision(mockResults, mockRelevant);
const recall = calculateRecall(mockResults, mockRelevant);
const mrr = calculateMRR(mockResults, mockRelevant);

check(
  'precision calculation correct',
  precision,
  (v) => Math.abs(v - 2/3) < 0.001,
  '0.667 (2 relevant out of 3 retrieved)'
);

check(
  'recall calculation correct',
  recall,
  (v) => Math.abs(v - 2/3) < 0.001,
  '0.667 (2 found out of 3 relevant)'
);

check(
  'MRR calculation correct',
  mrr,
  (v) => Math.abs(v - 1.0) < 0.001,
  '1.0 (first relevant at position 1)'
);

// ---------------------------------------------------------------------
// Step 12 - Full evaluation across test queries
// ---------------------------------------------------------------------

console.log('\nStep 12 - full evaluation across queries');

let totalHybridRecall = 0;
let totalVectorRecall = 0;
let totalBM25Recall = 0;

for (const testQuery of testQueries) {
  const hResults = hybridIndex.search(testQuery.query, { topK: 5 });
  const vResults = hybridIndex.searchVector(testQuery.query, 5);
  const bResults = hybridIndex.searchBM25(testQuery.query, 5);

  totalHybridRecall += calculateRecall(hResults, testQuery.relevant);
  totalVectorRecall += calculateRecall(vResults, testQuery.relevant);
  totalBM25Recall += calculateRecall(bResults, testQuery.relevant);
}

const avgHybridRecall = totalHybridRecall / testQueries.length;
const avgVectorRecall = totalVectorRecall / testQueries.length;
const avgBM25Recall = totalBM25Recall / testQueries.length;

console.log(`  Average hybrid recall: ${avgHybridRecall.toFixed(2)}`);
console.log(`  Average vector recall: ${avgVectorRecall.toFixed(2)}`);
console.log(`  Average BM25 recall: ${avgBM25Recall.toFixed(2)}`);

check(
  'hybrid average recall >= best single method',
  avgHybridRecall >= Math.max(avgVectorRecall, avgBM25Recall) - 0.01,
  (v) => v === true,
  'true (hybrid never worse than best single method)'
);

// ---------------------------------------------------------------------
// Step 13 - The assertion: RRF handles score scale differences
// ---------------------------------------------------------------------

console.log('\nStep 13 - RRF scale invariance');

// Same ranks, wildly different scores
const scaleListA = [
  { docId: 'doc1', chunkIndex: 0, score: 0.99, text: 'a' },
  { docId: 'doc2', chunkIndex: 0, score: 0.95, text: 'b' },
];
const scaleListB = [
  { docId: 'doc1', chunkIndex: 0, score: 1000, text: 'a' },
  { docId: 'doc2', chunkIndex: 0, score: 500, text: 'b' },
];

const fusedScaleA = reciprocalRankFusion([scaleListA], 60);
const fusedScaleB = reciprocalRankFusion([scaleListB], 60);

// Same ranks should produce same RRF scores regardless of original scores
check(
  'RRF produces same result regardless of score scale',
  fusedScaleA[0].docId === fusedScaleB[0].docId,
  (v) => v === true,
  'true (RRF uses ranks, not scores)'
);

check(
  'RRF scores are identical for same ranks',
  Math.abs(fusedScaleA[0].score - fusedScaleB[0].score) < 0.0001,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) {
    console.log(`  - ${f.name}`);
    console.log(`    expected: ${f.expectation}`);
    console.log(`    actual: ${f.actual}`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
