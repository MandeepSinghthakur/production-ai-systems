// Reproduces every numbered step of the Chapter 12 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch12-embeddings)
//   node examples/ch12-embeddings/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const {
  generateEmbedding,
  normalize,
  magnitude,
  createEmbeddingGenerator,
  DEFAULT_DIMENSIONS
} = await import(resolve(srcDir, 'embedding.ts'));

const {
  cosineSimilarity,
  dotProduct,
  euclideanDistance,
  euclideanSimilarity,
  computeSimilarity,
  findMostSimilar,
  areNearlyIdentical,
  isValidSimilarity
} = await import(resolve(srcDir, 'similarity.ts'));

const {
  EmbeddingCache,
  CachedEmbeddingGenerator,
  createCachedGenerator
} = await import(resolve(srcDir, 'caching.ts'));

const {
  detectDrift,
  measureSingleTextDrift,
  shouldReindex,
  createDriftMonitor
} = await import(resolve(srcDir, 'drift.ts'));

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
// Step 1 - Embeddings are deterministic
// ---------------------------------------------------------------------

console.log('\nStep 1 - embeddings are deterministic');

const textA = 'The payment was processed successfully';
const embed1 = generateEmbedding(textA);
const embed2 = generateEmbedding(textA);

check(
  'same text produces identical embedding',
  JSON.stringify(embed1) === JSON.stringify(embed2),
  (v) => v === true,
  'true (deterministic)'
);

const textB = 'A different text altogether';
const embed3 = generateEmbedding(textB);

check(
  'different text produces different embedding',
  JSON.stringify(embed1) === JSON.stringify(embed3),
  (v) => v === false,
  'false (different content)'
);

// ---------------------------------------------------------------------
// Step 2 - Embeddings are normalized to unit length
// ---------------------------------------------------------------------

console.log('\nStep 2 - embeddings are normalized');

const mag1 = magnitude(embed1);
const mag3 = magnitude(embed3);

check(
  'embedding 1 has unit magnitude',
  Math.abs(mag1 - 1.0) < 0.0001,
  (v) => v === true,
  'true (magnitude = 1.0)'
);

check(
  'embedding 2 has unit magnitude',
  Math.abs(mag3 - 1.0) < 0.0001,
  (v) => v === true,
  'true (magnitude = 1.0)'
);

// ---------------------------------------------------------------------
// Step 3 - Cosine similarity is bounded between -1 and 1
// ---------------------------------------------------------------------

console.log('\nStep 3 - cosine similarity bounds');

const simSame = cosineSimilarity(embed1, embed1);
const simDiff = cosineSimilarity(embed1, embed3);

check(
  'identical vectors have similarity 1.0',
  Math.abs(simSame - 1.0) < 0.0001,
  (v) => v === true,
  'true (cosine of same vector = 1)'
);

check(
  'cosine similarity is within [-1, 1]',
  simDiff >= -1 && simDiff <= 1,
  (v) => v === true,
  'true (bounded)'
);

check(
  'cosine similarity validation works',
  isValidSimilarity(simDiff, 'cosine'),
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 4 - Similar texts have higher cosine similarity
// ---------------------------------------------------------------------

console.log('\nStep 4 - semantic similarity');

// Use texts with clear cluster membership for reliable semantic comparison
// Finance cluster: money, payment, budget, cost, price, revenue, profit, expense
// Technology cluster: software, computer, system, digital, technology, data, server, database

const financeText1 = 'budget cost expense payment money';
const financeText2 = 'revenue profit investment fund financial';
const techText = 'server database software network code';

const financeEmbed1 = generateEmbedding(financeText1);
const financeEmbed2 = generateEmbedding(financeText2);
const techEmbed = generateEmbedding(techText);

const simFinanceToFinance = cosineSimilarity(financeEmbed1, financeEmbed2);
const simFinanceToTech = cosineSimilarity(financeEmbed1, techEmbed);

check(
  'related texts have higher similarity',
  simFinanceToFinance > simFinanceToTech,
  (v) => v === true,
  'true (finance-finance > finance-tech)'
);

console.log(`  Finance-to-finance similarity: ${simFinanceToFinance.toFixed(4)}`);
console.log(`  Finance-to-tech similarity: ${simFinanceToTech.toFixed(4)}`);

// ---------------------------------------------------------------------
// Step 5 - Dot product equals cosine for normalized vectors
// ---------------------------------------------------------------------

console.log('\nStep 5 - dot product vs cosine');

const dot1 = dotProduct(embed1, embed3);
const cos1 = cosineSimilarity(embed1, embed3);

check(
  'dot product equals cosine for normalized vectors',
  Math.abs(dot1 - cos1) < 0.0001,
  (v) => v === true,
  'true (when magnitude = 1)'
);

// ---------------------------------------------------------------------
// Step 6 - Euclidean distance properties
// ---------------------------------------------------------------------

console.log('\nStep 6 - euclidean distance');

const eucDist = euclideanDistance(embed1, embed3);
const eucSim = euclideanSimilarity(embed1, embed3);

check(
  'euclidean distance is non-negative',
  eucDist >= 0,
  (v) => v === true,
  'true (distance >= 0)'
);

check(
  'euclidean similarity is bounded [0, 1]',
  eucSim >= 0 && eucSim <= 1,
  (v) => v === true,
  'true (using 1/(1+d) transform)'
);

check(
  'identical vectors have zero euclidean distance',
  euclideanDistance(embed1, embed1) < 0.0001,
  (v) => v === true,
  'true (distance = 0)'
);

// ---------------------------------------------------------------------
// Step 7 - Dimension variations
// ---------------------------------------------------------------------

console.log('\nStep 7 - embedding dimensions');

const embed64 = generateEmbedding(textA, 64);
const embed256 = generateEmbedding(textA, 256);
const embed512 = generateEmbedding(textA, 512);

check(
  '64-dimension embedding has correct length',
  embed64.length === 64,
  (v) => v === true,
  'true'
);

check(
  '256-dimension embedding has correct length',
  embed256.length === 256,
  (v) => v === true,
  'true'
);

check(
  '512-dimension embedding has correct length',
  embed512.length === 512,
  (v) => v === true,
  'true'
);

// All should still be normalized
check(
  'all dimensions produce normalized vectors',
  Math.abs(magnitude(embed64) - 1.0) < 0.0001 &&
  Math.abs(magnitude(embed256) - 1.0) < 0.0001 &&
  Math.abs(magnitude(embed512) - 1.0) < 0.0001,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 8 - Embedding cache reduces redundant computation
// ---------------------------------------------------------------------

console.log('\nStep 8 - embedding caching');

const cache = new EmbeddingCache(100);
const generator = createEmbeddingGenerator({ dimensions: 128 });

// First call - should be a miss
const cached1 = cache.get(textA, 'v1.0');
check(
  'first lookup is a cache miss',
  cached1 === null,
  (v) => v === true,
  'true (not cached yet)'
);

// Generate and cache
const result = generator.embed({ text: textA });
cache.set(textA, result.vector, 'v1.0');

// Second call - should be a hit
const cached2 = cache.get(textA, 'v1.0');
check(
  'second lookup is a cache hit',
  cached2 !== null,
  (v) => v === true,
  'true (cached)'
);

check(
  'cached embedding matches original',
  JSON.stringify(cached2) === JSON.stringify(result.vector),
  (v) => v === true,
  'true'
);

// Different model version - should be a miss
const cached3 = cache.get(textA, 'v2.0');
check(
  'different model version is a cache miss',
  cached3 === null,
  (v) => v === true,
  'true (version mismatch)'
);

// ---------------------------------------------------------------------
// Step 9 - Cache statistics
// ---------------------------------------------------------------------

console.log('\nStep 9 - cache statistics');

const stats = cache.getStats();

check(
  'cache tracks hits',
  stats.hits === 1,
  (v) => v === true,
  'true (1 hit)'
);

check(
  'cache tracks misses',
  stats.misses === 2,
  (v) => v === true,
  'true (2 misses)'
);

check(
  'hit rate is calculated correctly',
  Math.abs(stats.hitRate - 1/3) < 0.01,
  (v) => v === true,
  'true (1 hit / 3 lookups)'
);

// ---------------------------------------------------------------------
// Step 10 - Cached generator reduces API calls
// ---------------------------------------------------------------------

console.log('\nStep 10 - cached embedding generator');

const baseGenerator = createEmbeddingGenerator({ dimensions: 128, modelVersion: 'v1.0' });
const cachedGen = createCachedGenerator(baseGenerator, 50);

// Embed same text multiple times
const texts = ['hello world', 'hello world', 'goodbye world', 'hello world'];
for (const t of texts) {
  cachedGen.embed(t);
}

const cachedStats = cachedGen.getCacheStats();

check(
  'cached generator has hits after repeated text',
  cachedStats.hits === 2,
  (v) => v === true,
  'true (hello world cached twice)'
);

check(
  'cache has correct number of entries',
  cachedStats.totalEntries === 2,
  (v) => v === true,
  'true (2 unique texts)'
);

// ---------------------------------------------------------------------
// Step 11 - Drift detection identifies model changes
// ---------------------------------------------------------------------

console.log('\nStep 11 - drift detection');

// Create embeddings with v1 model
const genV1 = createEmbeddingGenerator({ dimensions: 64, modelVersion: 'v1.0' });
const genV2 = createEmbeddingGenerator({ dimensions: 64, modelVersion: 'v2.0' });

const sampleTexts = [
  'The payment was processed',
  'Budget allocation complete',
  'Revenue exceeded targets',
  'Server maintenance scheduled',
  'Database backup finished',
  'Contract signed by both parties',
  'Legal review completed',
  'Investment portfolio rebalanced',
  'Network security audit done',
  'Software deployment successful'
];

const embeddingsV1 = sampleTexts.map(t => genV1.embed({ text: t }).vector);
const embeddingsV2 = sampleTexts.map(t => genV2.embed({ text: t }).vector);

const driftReport = detectDrift(
  sampleTexts,
  embeddingsV1,
  embeddingsV2,
  'v1.0',
  'v2.0'
);

check(
  'drift report has correct sample size',
  driftReport.sampleSize === 10,
  (v) => v === true,
  'true'
);

check(
  'drift report detects model change',
  driftReport.driftDetected === true,
  (v) => v === true,
  'true (v2 produces different embeddings)'
);

check(
  'drift report includes affected pairs',
  driftReport.affectedPairs.length >= 0,
  (v) => v === true,
  'true (array present)'
);

// ---------------------------------------------------------------------
// Step 12 - Single text drift measurement
// ---------------------------------------------------------------------

console.log('\nStep 12 - single text drift');

const singleOld = generateEmbedding('test text', 64);
const singleNew = generateEmbedding('test text modified', 64);
const singleSame = generateEmbedding('test text', 64);

const driftDifferent = measureSingleTextDrift(singleOld, singleNew);
const driftSame = measureSingleTextDrift(singleOld, singleSame);

check(
  'drift is zero for identical embeddings',
  driftSame < 0.0001,
  (v) => v === true,
  'true (no change)'
);

check(
  'drift is positive for different embeddings',
  driftDifferent > 0,
  (v) => v === true,
  'true (text changed)'
);

// ---------------------------------------------------------------------
// Step 13 - Drift monitor tracks baselines
// ---------------------------------------------------------------------

console.log('\nStep 13 - drift monitor');

const monitor = createDriftMonitor('v1.0');

// Set baselines
const baselineData = sampleTexts.slice(0, 5).map(text => ({
  text,
  embedding: generateEmbedding(text, 64)
}));
monitor.setBaselines(baselineData);

check(
  'monitor tracks baseline count',
  monitor.getBaselineCount() === 5,
  (v) => v === true,
  'true'
);

check(
  'monitor stores baseline version',
  monitor.getBaselineVersion() === 'v1.0',
  (v) => v === true,
  'true'
);

// Check drift for a known text
const knownDrift = monitor.checkDrift(
  sampleTexts[0],
  generateEmbedding(sampleTexts[0], 64)
);

check(
  'drift check returns value for known text',
  knownDrift !== null && knownDrift < 0.001,
  (v) => v === true,
  'true (same embedding = no drift)'
);

// ---------------------------------------------------------------------
// Step 14 - Reindex recommendation
// ---------------------------------------------------------------------

console.log('\nStep 14 - reindex recommendation');

// Create a report with severe drift
const severeDriftReport = {
  modelA: 'v1.0',
  modelB: 'v2.0',
  sampleSize: 100,
  avgCosineDelta: 0.2,
  maxCosineDelta: 0.5,
  driftDetected: true,
  affectedPairs: new Array(15).fill({
    textA: 'a', textB: 'b', oldSimilarity: 0.9, newSimilarity: 0.6, delta: 0.3
  })
};

const shouldReindexSevere = shouldReindex(severeDriftReport);

check(
  'severe drift triggers reindex recommendation',
  shouldReindexSevere === true,
  (v) => v === true,
  'true (avgDelta > 0.15)'
);

// Create a report with minor drift
const minorDriftReport = {
  modelA: 'v1.0',
  modelB: 'v1.1',
  sampleSize: 100,
  avgCosineDelta: 0.02,
  maxCosineDelta: 0.08,
  driftDetected: false,
  affectedPairs: []
};

const shouldReindexMinor = shouldReindex(minorDriftReport);

check(
  'minor drift does not trigger reindex',
  shouldReindexMinor === false,
  (v) => v === true,
  'true (within tolerance)'
);

// ---------------------------------------------------------------------
// Step 15 - Find most similar vectors
// ---------------------------------------------------------------------

console.log('\nStep 15 - similarity search');

const corpus = [
  { id: 'doc1', text: 'payment processing system', vector: generateEmbedding('payment processing system') },
  { id: 'doc2', text: 'medical diagnosis report', vector: generateEmbedding('medical diagnosis report') },
  { id: 'doc3', text: 'financial budget analysis', vector: generateEmbedding('financial budget analysis') },
  { id: 'doc4', text: 'database server maintenance', vector: generateEmbedding('database server maintenance') },
  { id: 'doc5', text: 'investment revenue growth', vector: generateEmbedding('investment revenue growth') }
];

const query = generateEmbedding('money and finance');
const topResults = findMostSimilar(query, corpus, 'cosine', 3);

check(
  'search returns requested number of results',
  topResults.length === 3,
  (v) => v === true,
  'true (top 3)'
);

check(
  'results are sorted by similarity descending',
  topResults[0].score >= topResults[1].score && topResults[1].score >= topResults[2].score,
  (v) => v === true,
  'true'
);

// Financial documents should rank higher for finance query
const financeDocsInTop3 = topResults.filter(r =>
  r.id === 'doc1' || r.id === 'doc3' || r.id === 'doc5'
).length;

check(
  'finance-related documents rank higher for finance query',
  financeDocsInTop3 >= 2,
  (v) => v === true,
  'true (at least 2 of 3 are finance-related)'
);

// ---------------------------------------------------------------------
// Step 16 - Near-duplicate detection
// ---------------------------------------------------------------------

console.log('\nStep 16 - near-duplicate detection');

const original = generateEmbedding('The quick brown fox jumps');
const duplicate = generateEmbedding('The quick brown fox jumps');
const different = generateEmbedding('A slow gray cat sleeps');

check(
  'identical texts are detected as near-duplicates',
  areNearlyIdentical(original, duplicate, 0.99),
  (v) => v === true,
  'true'
);

check(
  'different texts are not near-duplicates',
  areNearlyIdentical(original, different, 0.99),
  (v) => v === false,
  'false'
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
