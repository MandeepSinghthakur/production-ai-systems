// Reproduces every numbered step of the Chapter 4 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch04-redis)
//   node examples/ch04-redis/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { PromptCache } = await import(resolve(srcDir, 'cache.ts'));
const { TokenRateLimiter, RequestRateLimiter } = await import(
  resolve(srcDir, 'rate-limiter.ts')
);
const { HotKeyDetector, HotKeyReplicator } = await import(
  resolve(srcDir, 'hot-key.ts')
);
const {
  generateZipfPrompts,
  simulateCacheLoad,
  simulateRateLimitBurst,
  compareRateLimitStrategies,
  simulateHotKeyDetection,
  generateVariableTokenRequests,
  simulateMemoryPressure,
} = await import(resolve(srcDir, 'simulator.ts'));

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
// Step 1 - Cache hit rate with Zipf distribution
// ---------------------------------------------------------------------

console.log('\nStep 1 - cache hit rate with Zipf distribution');

const cache1 = new PromptCache({
  maxEntries: 100,
  maxMemoryBytes: 10 * 1024 * 1024,
  ttlMs: 60_000,
  evictionPolicy: 'lru',
});

// Generate 1000 requests with Zipf distribution over 50 unique prompts
// Skew of 1.0 means ~20% of prompts account for ~80% of traffic
const zipfPrompts = generateZipfPrompts(50, 1000, 1.0);
const cacheResult = simulateCacheLoad(cache1, zipfPrompts, 500);

check(
  'cache hit rate >80% for repeated prompts',
  cacheResult.hitRate,
  (v) => v > 0.8,
  '>0.80 (Zipf distribution concentrates traffic on few prompts)'
);

check(
  'tokens saved equals hits times tokens per response',
  cacheResult.totalTokensSaved,
  (v) => v === cacheResult.cacheHits * 500,
  `${cacheResult.cacheHits * 500} (each hit saves 500 tokens)`
);

// ---------------------------------------------------------------------
// Step 2 - LRU eviction under memory pressure
// ---------------------------------------------------------------------

console.log('\nStep 2 - LRU eviction under memory pressure');

const cache2 = new PromptCache({
  maxEntries: 10,
  maxMemoryBytes: 10_000, // 10 KB limit
  ttlMs: 60_000,
  evictionPolicy: 'lru',
});

// Add 20 entries, each ~1KB. Should trigger evictions.
const pressureResult = simulateMemoryPressure(cache2, 1000, 20);

check(
  'eviction fires under memory pressure',
  pressureResult.evictions,
  (v) => v > 0,
  '>0 (memory limit forces eviction)'
);

check(
  'cache size bounded by maxEntries',
  pressureResult.finalSize,
  (v) => v <= 10,
  '<=10 (maxEntries constraint respected)'
);

// Verify LRU: the entry we access most recently survives eviction
// Use a separate cache with entry-based limit only
const cacheLRU = new PromptCache({
  maxEntries: 5,
  maxMemoryBytes: 100 * 1024 * 1024, // Large memory limit
  ttlMs: 60_000,
  evictionPolicy: 'lru',
});

// Add entries in order: survivor, then 4 others
cacheLRU.set('survivor', 'response', 100);
await new Promise((r) => setTimeout(r, 5)); // Small delay for distinct timestamps

cacheLRU.set('victim_1', 'response', 100);
cacheLRU.set('victim_2', 'response', 100);
cacheLRU.set('victim_3', 'response', 100);
cacheLRU.set('victim_4', 'response', 100);

// Access survivor to make it most recently used
await new Promise((r) => setTimeout(r, 5));
cacheLRU.get('survivor');

// Add new entries to trigger evictions - victims should be evicted
await new Promise((r) => setTimeout(r, 5));
cacheLRU.set('new_1', 'response', 100);
cacheLRU.set('new_2', 'response', 100);
cacheLRU.set('new_3', 'response', 100);
cacheLRU.set('new_4', 'response', 100);

// Survivor should still be there (recently accessed)
const survivorResult = cacheLRU.get('survivor');
// Victim_1 should be gone (least recently used)
const victimResult = cacheLRU.get('victim_1');

check(
  'LRU keeps recently accessed entries',
  survivorResult.hit,
  (v) => v === true,
  'true (accessed entry survives eviction)'
);

check(
  'LRU evicts least recently used',
  victimResult.hit,
  (v) => v === false,
  'false (unaccessed entry evicted)'
);

// ---------------------------------------------------------------------
// Step 3 - TTL expiration
// ---------------------------------------------------------------------

console.log('\nStep 3 - TTL expiration');

const cache3 = new PromptCache({
  maxEntries: 100,
  maxMemoryBytes: 10 * 1024 * 1024,
  ttlMs: 50, // 50ms TTL for fast testing
  evictionPolicy: 'lru',
});

cache3.set('expires_soon', 'response', 100);

// Immediately should hit
const beforeExpiry = cache3.get('expires_soon');
check(
  'entry available before TTL',
  beforeExpiry.hit,
  (v) => v === true,
  'true (entry exists within TTL)'
);

// Wait for expiry
await new Promise((resolve) => setTimeout(resolve, 60));

const afterExpiry = cache3.get('expires_soon');
check(
  'entry expired after TTL',
  afterExpiry.hit,
  (v) => v === false,
  'false (entry removed after TTL)'
);

// ---------------------------------------------------------------------
// Step 4 - Token-based rate limiting
// ---------------------------------------------------------------------

console.log('\nStep 4 - token-based rate limiting');

const tokenLimiter = new TokenRateLimiter({
  tokensPerWindow: 10_000,
  windowMs: 60_000,
  burstMultiplier: 1.0, // No burst for predictable testing
});

// Generate 50 requests with variable token counts
const variableRequests = generateVariableTokenRequests(50, 100, 2000);
const rateLimitResult = simulateRateLimitBurst(
  tokenLimiter,
  'tenant-a',
  variableRequests
);

check(
  'token budget respected',
  rateLimitResult.totalTokensConsumed,
  (v) => v <= 10_000,
  '<=10000 (cannot exceed token budget)'
);

check(
  'some requests rejected when budget exhausted',
  rateLimitResult.rejected,
  (v) => v > 0,
  '>0 (variable token counts exhaust budget)'
);

// ---------------------------------------------------------------------
// Step 5 - Token vs request rate limiting comparison
// ---------------------------------------------------------------------

console.log('\nStep 5 - token vs request rate limiting comparison');

const reqLimiter = new RequestRateLimiter(20, 60_000); // 20 requests/min
const tokLimiter = new TokenRateLimiter({
  tokensPerWindow: 10_000,
  windowMs: 60_000,
  burstMultiplier: 1.0,
});

// Mix of small and large requests
const mixedRequests = [
  { tokens: 100 }, // small
  { tokens: 100 },
  { tokens: 100 },
  { tokens: 100 },
  { tokens: 100 },
  { tokens: 4000 }, // large - should blow token budget
  { tokens: 4000 },
  { tokens: 4000 },
  { tokens: 100 },
  { tokens: 100 },
];

const comparison = compareRateLimitStrategies(
  reqLimiter,
  tokLimiter,
  'tenant-compare',
  mixedRequests
);

check(
  'request-based allows more total tokens',
  comparison.requestBased.totalTokens > comparison.tokenBased.totalTokens,
  (v) => v === true,
  'true (request counting ignores token cost)'
);

check(
  'token-based respects budget despite fewer requests',
  comparison.tokenBased.totalTokens,
  (v) => v <= 10_000,
  '<=10000 (token budget enforced)'
);

// ---------------------------------------------------------------------
// Step 6 - Hot key detection
// ---------------------------------------------------------------------

console.log('\nStep 6 - hot key detection');

const detector = new HotKeyDetector(60_000, 50); // threshold of 50

// Generate prompts with one very hot key
const hotPrompts = [];
for (let i = 0; i < 1000; i++) {
  if (i % 5 === 0) {
    hotPrompts.push('hot_prompt'); // 20% of traffic
  } else {
    hotPrompts.push(`cold_prompt_${i % 100}`);
  }
}

const hotKeyResult = simulateHotKeyDetection(detector, hotPrompts, 5);

check(
  'hot key detection identifies top keys',
  hotKeyResult.hotKeysDetected,
  (v) => v >= 1,
  '>=1 (at least the dominant prompt detected)'
);

check(
  'top hot key is the repeated prompt',
  hotKeyResult.topHotKey,
  (v) => v === 'hot_prompt',
  '"hot_prompt" (most frequent key identified)'
);

check(
  'hot key count matches access pattern',
  hotKeyResult.topHotKeyCount,
  (v) => v >= 150, // Should be ~200 (20% of 1000)
  '>=150 (approximately 20% of traffic)'
);

// ---------------------------------------------------------------------
// Step 7 - Hot key replication
// ---------------------------------------------------------------------

console.log('\nStep 7 - hot key replication');

const replicatorDetector = new HotKeyDetector(60_000, 10);
const replicator = new HotKeyReplicator(replicatorDetector, 50, 5_000);

// Simulate a remote cache
const remoteCache = new Map();
remoteCache.set('hot_key', 'hot_value');
remoteCache.set('cold_key', 'cold_value');

let remoteHits = 0;
const fetcher = (key) => () => {
  remoteHits++;
  return remoteCache.get(key) ?? null;
};

// Access hot_key many times to make it hot
for (let i = 0; i < 20; i++) {
  replicator.get('hot_key', fetcher('hot_key'));
}

const remoteHitsBefore = remoteHits;

// Now hot_key should be served locally
const localResult = replicator.get('hot_key', fetcher('hot_key'));
const remoteHitsAfter = remoteHits;

check(
  'hot key served from local cache',
  localResult.source,
  (v) => v === 'local',
  '"local" (hot key replicated locally)'
);

check(
  'local cache prevents remote hit',
  remoteHitsAfter,
  (v) => v === remoteHitsBefore,
  `${remoteHitsBefore} (no new remote fetch for local hit)`
);

// Cold key should still hit remote
const coldResult = replicator.get('cold_key', fetcher('cold_key'));
check(
  'cold key fetched from remote',
  coldResult.source,
  (v) => v === 'remote',
  '"remote" (cold key not replicated)'
);

// ---------------------------------------------------------------------
// Step 8 - Cache hash collision resistance
// ---------------------------------------------------------------------

console.log('\nStep 8 - cache hash collision resistance');

const cache4 = new PromptCache();

// Similar prompts should produce different hashes
const hash1 = cache4.hashPrompt('What is the weather today?');
const hash2 = cache4.hashPrompt('What is the weather today');
const hash3 = cache4.hashPrompt('what is the weather today?');

check(
  'trailing punctuation changes hash',
  hash1 !== hash2,
  (v) => v === true,
  'true (different prompts, different hashes)'
);

check(
  'case normalization produces same hash',
  hash1 === hash3,
  (v) => v === true,
  'true (normalization improves hit rate)'
);

// System prompt changes the hash
const hash4 = cache4.hashPrompt('What is the weather today?', 'You are helpful');
const hash5 = cache4.hashPrompt('What is the weather today?', 'You are concise');

check(
  'different system prompts produce different hashes',
  hash4 !== hash5,
  (v) => v === true,
  'true (system prompt is part of cache key)'
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
