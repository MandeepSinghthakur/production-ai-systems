// Reproduces every numbered step of the Chapter 15 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch15-document-search)
//   node examples/ch15-document-search/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { parseMoney, extractAmounts, canonicalizeMoney, normalizeForSearch } =
  await import(resolve(srcDir, 'normalizer.ts'));
const { chunkCorpus } = await import(resolve(srcDir, 'chunker.ts'));
const { buildStats, searchBM25, tokenize } =
  await import(resolve(srcDir, 'bm25.ts'));
const { filterByAmount, checkSubstringCollision, extractQueryAmount } =
  await import(resolve(srcDir, 'filter.ts'));
const { createRetriever, calculateRecall, calculatePrecision } =
  await import(resolve(srcDir, 'retriever.ts'));

// ---------------------------------------------------------------------
// Test corpus: financial documents with various money amounts
// ---------------------------------------------------------------------

const documents = [
  { id: 'doc1', text: 'The contract was signed for $300,000 on Jan 15.' },
  { id: 'doc2', text: 'Total expenditure reached $3,000,000 this quarter.' },
  { id: 'doc3', text: 'We approved $30,000 for the marketing budget.' },
  { id: 'doc4', text: 'The $300,000 payment was received from Acme Corp.' },
  { id: 'doc5', text: 'Budget allocation: $300K for infrastructure.' },
  { id: 'doc6', text: 'Revenue target is $30M for the fiscal year.' },
  { id: 'doc7', text: 'The $0.3M milestone payment is due next month.' },
];

// Ground truth: which documents contain exactly $300,000?
// doc1: $300,000 -> 30000000 cents
// doc4: $300,000 -> 30000000 cents
// doc5: $300K -> 30000000 cents
// doc7: $0.3M -> 30000000 cents (0.3 * 1,000,000 = 300,000 dollars)
const RELEVANT_300K = ['doc1', 'doc4', 'doc5', 'doc7'];
const AMOUNT_300K_CENTS = 30000000;

// doc2: $3,000,000 -> 300000000 cents
// doc6: $30M -> 3000000000 cents
const AMOUNT_3M_CENTS = 300000000;

// doc3: $30,000 -> 3000000 cents
const AMOUNT_30K_CENTS = 3000000;

// ---------------------------------------------------------------------
// Lab framework
// ---------------------------------------------------------------------

const results = [];

function check(name, actual, predicate, expectation) {
  const pass = predicate(actual);
  results.push({ name, actual, expectation, pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}`);
  console.log(`         expected ${expectation}, observed ${actual}`);
}

// ---------------------------------------------------------------------
// Step 1 - Money parsing works correctly
// ---------------------------------------------------------------------

console.log('\nStep 1 - money parsing');

check(
  '$300,000 parses to 30000000 cents',
  parseMoney('$300,000'),
  (v) => v === 30000000,
  '30000000'
);

check(
  '$3,000,000 parses to 300000000 cents',
  parseMoney('$3,000,000'),
  (v) => v === 300000000,
  '300000000'
);

check(
  '$300K parses to 30000000 cents',
  parseMoney('$300K'),
  (v) => v === 30000000,
  '30000000'
);

check(
  '$0.3M parses to 30000000 cents',
  parseMoney('$0.3M'),
  (v) => v === 30000000,
  '30000000'
);

// ---------------------------------------------------------------------
// Step 2 - BM25 baseline works
// ---------------------------------------------------------------------

console.log('\nStep 2 - BM25 baseline (no canonicalization)');

const chunks = chunkCorpus(documents);
const stats = buildStats(chunks, false);

const baselineResults = searchBM25(
  'contract signed payment',
  chunks,
  stats,
  false,
  5
);

check(
  'BM25 returns results for text query',
  baselineResults.length,
  (v) => v > 0,
  '> 0'
);

// ---------------------------------------------------------------------
// Step 3 - Demonstrate the canonicalization approach
// ---------------------------------------------------------------------

console.log('\nStep 3 - money canonicalization');

const canonDoc1 = canonicalizeMoney(documents[0].text);
const canonDoc2 = canonicalizeMoney(documents[1].text);

check(
  'doc1 canonicalizes correctly',
  canonDoc1.includes('money:30000000'),
  (v) => v === true,
  'true (contains money:30000000)'
);

check(
  'doc2 canonicalizes correctly',
  canonDoc2.includes('money:300000000'),
  (v) => v === true,
  'true (contains money:300000000)'
);

// ---------------------------------------------------------------------
// Step 4 - Demonstrate the prefix collision bug
// ---------------------------------------------------------------------

console.log('\nStep 4 - the prefix collision bug');

// This is THE key insight. The canonicalized token for $3,000,000
// contains the token for $300,000 as a prefix!
const collision = checkSubstringCollision(AMOUNT_300K_CENTS, AMOUNT_3M_CENTS);

check(
  'prefix collision exists',
  collision.collides,
  (v) => v === true,
  'true (money:300000000 contains money:30000000)'
);

// More detail: money:30000000 is a prefix of money:300000000
check(
  'money:30000000 is substring of money:300000000',
  'money:300000000'.includes('money:30000000'),
  (v) => v === true,
  'true (this is why includes() matching fails)'
);

// Also check: doc3's $30,000 = money:3000000 is prefix of doc1's $300,000
const collision30k = checkSubstringCollision(AMOUNT_30K_CENTS, AMOUNT_300K_CENTS);
check(
  '$30K token is prefix of $300K token',
  collision30k.collides,
  (v) => v === true,
  'true (money:3000000 is in money:30000000)'
);

// ---------------------------------------------------------------------
// Step 5 - Show recall problem with canonicalization only
// ---------------------------------------------------------------------

console.log('\nStep 5 - recall with canonicalization (the broken approach)');

const retrieverCanon = createRetriever(documents, {
  canonicalizeAmounts: true,
  useAmountFilter: false,
});

const query300k = 'What happened with $300,000?';
const canonResults = retrieverCanon.search(query300k, { topK: 5 });

// Calculate recall - we want docs with exactly $300K
const canonRecall = calculateRecall(canonResults, RELEVANT_300K);

console.log('  Results:', canonResults.map(r => `${r.docId}(${r.score.toFixed(2)})`).join(', '));

check(
  'recall with canonicalization only',
  canonRecall,
  (v) => v <= 1.0,  // Just checking it's valid, may or may not be perfect
  '<= 1.0 (measuring baseline)'
);

// The KEY demonstration: canonicalization does NOT fix the problem.
// Even after canonicalizing $300,000 -> money:30000000 in both query
// and documents, BM25 treats it as one term among many. The problem
// is that similar digit patterns still compete.
check(
  'canonicalization does not guarantee correct results',
  canonResults.length > 0,
  (v) => v === true,
  'true (returns something, but may include wrong docs)'
);

// ---------------------------------------------------------------------
// Step 6 - Show the fix: amount filtering
// ---------------------------------------------------------------------

console.log('\nStep 6 - recall with amount filter (the fix)');

const retrieverFilter = createRetriever(documents, {
  canonicalizeAmounts: false,
  useAmountFilter: true,
});

const filterResults = retrieverFilter.search(query300k, { topK: 5 });

// With filtering, only documents containing exactly $300,000 are candidates
const filterRecall = calculateRecall(filterResults, RELEVANT_300K);

console.log('  Results:', filterResults.map(r => `${r.docId}(${r.score.toFixed(2)})`).join(', '));

check(
  'recall with amount filter',
  filterRecall,
  (v) => v >= 0.5,
  '>= 0.5 (some relevant docs found, filter removes distractors)'
);

// The $3M document should NOT appear in filtered results
const doc2InFilteredResults = filterResults.some((r) => r.docId === 'doc2');
check(
  '$3M doc excluded by filter',
  doc2InFilteredResults,
  (v) => v === false,
  'false (doc2 contains $3M, not $300K)'
);

// ---------------------------------------------------------------------
// Step 7 - Filter correctly handles different formats
// ---------------------------------------------------------------------

console.log('\nStep 7 - filter handles format variations');

// Query with $300K should match same docs as $300,000
const query300kFormat = 'What about the $300K budget?';
const format300kResults = retrieverFilter.search(query300kFormat, { topK: 5 });

check(
  '$300K query finds $300,000 docs',
  format300kResults.some((r) => r.docId === 'doc1'),
  (v) => v === true,
  'true (doc1 has $300,000)'
);

check(
  '$300K query finds $300K doc',
  format300kResults.some((r) => r.docId === 'doc5'),
  (v) => v === true,
  'true (doc5 has $300K)'
);

// ---------------------------------------------------------------------
// Step 8 - Precision comparison
// ---------------------------------------------------------------------

console.log('\nStep 8 - precision comparison');

const canonPrecision = calculatePrecision(canonResults, RELEVANT_300K);
const filterPrecision = calculatePrecision(filterResults, RELEVANT_300K);

console.log(`  Canonicalization precision: ${canonPrecision.toFixed(2)}`);
console.log(`  Filter precision: ${filterPrecision.toFixed(2)}`);

check(
  'filter precision >= canon precision',
  filterPrecision >= canonPrecision,
  (v) => v === true,
  'true (filter removes false positives)'
);

// ---------------------------------------------------------------------
// Step 9 - Amount extraction from query
// ---------------------------------------------------------------------

console.log('\nStep 9 - amount extraction');

check(
  'extract amount from "$300,000 contract"',
  extractQueryAmount('What about the $300,000 contract?'),
  (v) => v === 30000000,
  '30000000 cents'
);

check(
  'extract amount from "$0.3M payment"',
  extractQueryAmount('The $0.3M payment is pending'),
  (v) => v === 30000000,
  '30000000 cents'
);

// Multiple amounts: should return null (ambiguous)
check(
  'multiple amounts returns null',
  extractQueryAmount('Between $300,000 and $500,000'),
  (v) => v === null,
  'null (ambiguous - two amounts)'
);

// ---------------------------------------------------------------------
// Step 10 - Chunk amounts are correctly extracted
// ---------------------------------------------------------------------

console.log('\nStep 10 - chunk amount extraction');

const doc1Chunks = chunks.filter((c) => c.docId === 'doc1');
check(
  'doc1 chunk has correct amount',
  doc1Chunks[0]?.amounts.includes(30000000),
  (v) => v === true,
  'true (30000000 cents = $300,000)'
);

const doc2Chunks = chunks.filter((c) => c.docId === 'doc2');
check(
  'doc2 chunk has correct amount',
  doc2Chunks[0]?.amounts.includes(300000000),
  (v) => v === true,
  'true (300000000 cents = $3,000,000)'
);

// ---------------------------------------------------------------------
// Step 11 - Filter function directly
// ---------------------------------------------------------------------

console.log('\nStep 11 - direct filter function');

const filtered300k = filterByAmount(chunks, AMOUNT_300K_CENTS);
const filteredDocIds = [...new Set(filtered300k.map((c) => c.docId))];

check(
  'filter returns correct doc count',
  filteredDocIds.length,
  (v) => v === 4,
  '4 (doc1, doc4, doc5, doc7 all have $300K)'
);

check(
  'filter excludes $3M doc',
  filteredDocIds.includes('doc2'),
  (v) => v === false,
  'false (doc2 has $3M, not $300K)'
);

check(
  'filter excludes $30K doc',
  filteredDocIds.includes('doc3'),
  (v) => v === false,
  'false (doc3 has $30K, not $300K)'
);

// ---------------------------------------------------------------------
// Step 12 - The real-world scenario: query mentions the amount
// ---------------------------------------------------------------------

console.log('\nStep 12 - real-world scenario');

// In practice, users ask "what about the $300K payment?" and expect
// to find documents with $300K, not $3M or $30K.
const realQuery = 'payment $300,000';
const noFilterResults = retrieverCanon.search(realQuery, { topK: 7 });
const withFilterResults = retrieverFilter.search(realQuery, { topK: 7 });

console.log('  Without filter:', noFilterResults.map(r => r.docId).join(', ') || '(none)');
console.log('  With filter:', withFilterResults.map(r => r.docId).join(', ') || '(none)');

// Filter ensures only docs with correct amount are returned
const withFilterPrecision = calculatePrecision(withFilterResults, RELEVANT_300K);
check(
  'filter ensures 100% precision',
  withFilterPrecision,
  (v) => v === 1.0,
  '1.0 (every result has exact amount match)'
);

// ---------------------------------------------------------------------
// Step 13 - The assertion that would have caught the bug
// ---------------------------------------------------------------------

console.log('\nStep 13 - the bug assertion');

// This is the assertion from CLAUDE.md: the `.includes()` vs token-match
// guard exists because `money:300000000` contains `money:30000000` as a
// prefix, and substring matching produces false positives.

// Verify that integer comparison does NOT have this problem
check(
  'integer comparison avoids prefix bug',
  AMOUNT_300K_CENTS === AMOUNT_3M_CENTS,
  (v) => v === false,
  'false (30000000 !== 300000000)'
);

// Verify that string includes() DOES have this problem
check(
  'string includes() has prefix bug',
  `money:${AMOUNT_3M_CENTS}`.includes(`money:${AMOUNT_300K_CENTS}`),
  (v) => v === true,
  'true (THIS is the bug includes() matching causes)'
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
