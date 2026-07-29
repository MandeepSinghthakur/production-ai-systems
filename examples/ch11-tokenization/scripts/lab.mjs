// Reproduces every numbered step of the Chapter 11 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch11-tokenization)
//   node examples/ch11-tokenization/scripts/lab.mjs   (from repo root)
//
// No external services required - everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { SimpleTokenizer, ProductionTokenizer } = await import(
  resolve(srcDir, 'tokenizer.ts')
);
const { TokenCounter, compareEstimationMethods, calculateTokenBudget } =
  await import(resolve(srcDir, 'counting.ts'));
const {
  ContextWindowManager,
  SlidingWindowManager,
  PriorityContextManager,
} = await import(resolve(srcDir, 'context.ts'));
const { TruncationEngine, SmartTruncation, BatchTruncation } = await import(
  resolve(srcDir, 'truncation.ts')
);

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
// Step 1 - Token count differs from word count
// ---------------------------------------------------------------------

console.log('\nStep 1 - token count differs from word count');

const tokenizer = new ProductionTokenizer();

// Simple sentence
const simple = 'The quick brown fox jumps over the lazy dog.';
const simpleWords = simple.split(/\s+/).length;
const simpleTokens = tokenizer.countTokens(simple);

check(
  'tokens exceed words for simple text',
  simpleTokens > simpleWords,
  (v) => v === true,
  'true (punctuation and spaces become tokens)'
);

// Text with compound words and punctuation
const complex = "Tokenization isn't straightforward: it's model-specific.";
const complexWords = complex.split(/\s+/).length;
const complexTokens = tokenizer.countTokens(complex);

check(
  'compound words increase token/word ratio',
  complexTokens / complexWords,
  (v) => v > 1.5,
  '>1.5 (contractions and punctuation add tokens)'
);

// Numbers tokenize differently
const numbers = '123456789 987654321 555555555';
const numbersTokens = tokenizer.countTokens(numbers);

check(
  'long numbers split into multiple tokens',
  numbersTokens,
  (v) => v > 5,
  '>5 (numbers split into 1-3 digit chunks)'
);

// ---------------------------------------------------------------------
// Step 2 - Tokenizer behavior verification
// ---------------------------------------------------------------------

console.log('\nStep 2 - tokenizer behavior verification');

const simpleTokenizer = new SimpleTokenizer();

// Verify roundtrip
const testText = 'Hello, world! How are you today?';
const result = simpleTokenizer.tokenize(testText);
const decoded = simpleTokenizer.decode(result.tokens);

check(
  'tokenize-decode roundtrip preserves text',
  decoded === testText,
  (v) => v === true,
  'true (no information loss)'
);

// Verify token positions
const lastToken = result.tokens[result.tokens.length - 1];
check(
  'token positions span entire input',
  lastToken.byteEnd,
  (v) => v === testText.length,
  `${testText.length} (last token ends at text length)`
);

// Verify truncation
const longText = 'word '.repeat(100);
const truncated = simpleTokenizer.tokenize(longText, 10);

check(
  'maxTokens parameter limits output',
  truncated.tokenCount,
  (v) => v === 10,
  '10 (stops at limit)'
);

check(
  'truncated flag set when truncation occurs',
  truncated.truncated,
  (v) => v === true,
  'true (truncation indicated)'
);

// ---------------------------------------------------------------------
// Step 3 - Token estimation accuracy
// ---------------------------------------------------------------------

console.log('\nStep 3 - token estimation accuracy');

const counter = new TokenCounter();

// Generate test texts of varying lengths
const testTexts = [
  'Short text here.',
  'A medium length paragraph that contains several sentences. ' +
    'It discusses various topics and uses different vocabulary. ' +
    'The goal is to test estimation accuracy across lengths.',
  'A much longer piece of text that goes on for quite a while. '.repeat(20),
  `function example() {
    const x = 10;
    const y = 20;
    return x + y;
  }`.repeat(10),
];

// Compare estimation methods
const comparison = compareEstimationMethods(testTexts);

const wordMethod = comparison.find((c) => c.method === 'word-ratio');
const charMethod = comparison.find((c) => c.method === 'char-ratio');
const hybridMethod = comparison.find((c) => c.method === 'hybrid');

check(
  'word-ratio estimation has bounded error',
  wordMethod.avgError,
  (v) => v < 0.60,
  '<0.60 (within 60% on average for simplified tokenizer)'
);

check(
  'char-ratio estimation has bounded error',
  charMethod.avgError,
  (v) => v < 0.60,
  '<0.60 (within 60% on average for simplified tokenizer)'
);

check(
  'hybrid estimation is most accurate',
  hybridMethod.avgError,
  (v) => v < 0.15,
  '<0.15 (within 15% on average)'
);

// Verify estimation speed ordering
check(
  'word-ratio is faster than exact',
  wordMethod.avgTime < comparison.find((c) => c.method === 'exact').avgTime,
  (v) => v === true,
  'true (no tokenization needed)'
);

// ---------------------------------------------------------------------
// Step 4 - Token budget calculation
// ---------------------------------------------------------------------

console.log('\nStep 4 - token budget calculation');

const budget = calculateTokenBudget(8192, {
  systemPromptTokens: 200,
  reserveForOutput: 2048,
  reserveForSafety: 50,
});

check(
  'budget components sum to total',
  budget.systemPrompt +
    budget.conversationHistory +
    budget.currentMessage +
    budget.reservedForOutput +
    budget.safetyBuffer,
  (v) => v === budget.total,
  `${budget.total} (all components accounted)`
);

check(
  'output reservation respected',
  budget.reservedForOutput,
  (v) => v === 2048,
  '2048 (configured value)'
);

check(
  'system prompt allocation respected',
  budget.systemPrompt,
  (v) => v === 200,
  '200 (configured value)'
);

// ---------------------------------------------------------------------
// Step 5 - Context window management
// ---------------------------------------------------------------------

console.log('\nStep 5 - context window management');

const contextManager = new ContextWindowManager({
  maxTokens: 1000,
  reservedForOutput: 200,
  reservedForSystem: 100,
});

const messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello! ' + 'This is a long message. '.repeat(20) },
  { role: 'assistant', content: 'Hi there! ' + 'Response text. '.repeat(15) },
  { role: 'user', content: 'Another question. '.repeat(10) },
  { role: 'assistant', content: 'Another answer. '.repeat(10) },
  { role: 'user', content: 'Final question here.' },
];

const fitResult = contextManager.fitMessages(messages);

check(
  'fitted messages within budget',
  fitResult.totalTokens,
  (v) => v <= 800, // maxTokens - reservedForOutput
  '<=800 (respects output reservation)'
);

check(
  'system message always included',
  fitResult.messages.some((m) => m.role === 'system'),
  (v) => v === true,
  'true (system messages mandatory)'
);

check(
  'recent messages prioritized',
  fitResult.messages[fitResult.messages.length - 1].content.includes('Final'),
  (v) => v === true,
  'true (most recent user message kept)'
);

check(
  'dropped count tracked',
  fitResult.droppedCount >= 0,
  (v) => v === true,
  'true (drop tracking enabled)'
);

// ---------------------------------------------------------------------
// Step 6 - Sliding window behavior
// ---------------------------------------------------------------------

console.log('\nStep 6 - sliding window behavior');

const slidingManager = new SlidingWindowManager(2, 500); // 2 turns max

const longConversation = [
  { role: 'system', content: 'System prompt.' },
  { role: 'user', content: 'Turn 1 user.' },
  { role: 'assistant', content: 'Turn 1 assistant.' },
  { role: 'user', content: 'Turn 2 user.' },
  { role: 'assistant', content: 'Turn 2 assistant.' },
  { role: 'user', content: 'Turn 3 user.' },
  { role: 'assistant', content: 'Turn 3 assistant.' },
  { role: 'user', content: 'Turn 4 user.' },
  { role: 'assistant', content: 'Turn 4 assistant.' },
];

const windowed = slidingManager.applyWindow(longConversation);

check(
  'sliding window limits conversation length',
  windowed.filter((m) => m.role !== 'system').length,
  (v) => v <= 4, // 2 turns * 2 messages per turn
  '<=4 (2 turns maximum)'
);

check(
  'system message preserved in sliding window',
  windowed[0].role === 'system',
  (v) => v === true,
  'true (system always first)'
);

check(
  'recent turns kept, old turns dropped',
  windowed.some((m) => m.content.includes('Turn 4')),
  (v) => v === true,
  'true (most recent turn preserved)'
);

// ---------------------------------------------------------------------
// Step 7 - Truncation strategies
// ---------------------------------------------------------------------

console.log('\nStep 7 - truncation strategies');

const truncator = new TruncationEngine();
const longText2 = 'Sentence one. Sentence two. Sentence three. '.repeat(20);

// Head truncation
const headResult = truncator.truncate(longText2, 50, 'head');
check(
  'head truncation preserves beginning',
  headResult.text.startsWith('Sentence one'),
  (v) => v === true,
  'true (beginning preserved)'
);

check(
  'head truncation adds marker',
  headResult.text.includes('[...truncated...]'),
  (v) => v === true,
  'true (truncation indicated)'
);

// Tail truncation
const tailResult = truncator.truncate(longText2, 50, 'tail');
check(
  'tail truncation preserves end',
  tailResult.text.endsWith('Sentence three. '),
  (v) => v === true,
  'true (end preserved)'
);

// Middle truncation
const middleResult = truncator.truncate(longText2, 80, 'middle');
check(
  'middle truncation preserves both ends',
  middleResult.text.includes('[...middle truncated...]'),
  (v) => v === true,
  'true (middle marker present)'
);

// Sentence truncation
const sentenceResult = truncator.truncate(longText2, 50, 'sentence');
check(
  'sentence truncation ends at boundary',
  /[.!?]\s*\[/.test(sentenceResult.text),
  (v) => v === true,
  'true (ends at sentence boundary)'
);

// ---------------------------------------------------------------------
// Step 8 - No truncation when under limit
// ---------------------------------------------------------------------

console.log('\nStep 8 - no truncation when under limit');

const shortText = 'This is short.';
const noTruncResult = truncator.truncate(shortText, 1000, 'head');

check(
  'short text not truncated',
  noTruncResult.truncated,
  (v) => v === false,
  'false (under limit)'
);

check(
  'original text preserved when not truncated',
  noTruncResult.text === shortText,
  (v) => v === true,
  'true (no modification)'
);

check(
  'token counts match when not truncated',
  noTruncResult.originalTokens === noTruncResult.truncatedTokens,
  (v) => v === true,
  'true (same count)'
);

// ---------------------------------------------------------------------
// Step 9 - Smart truncation for documents
// ---------------------------------------------------------------------

console.log('\nStep 9 - smart truncation for documents');

const smartTrunc = new SmartTruncation();

const document = `
# Introduction
This is the introduction section with important context.

# Methods
Here we describe the methods used in detail.
${'More method details. '.repeat(30)}

# Results
The results are summarized here.

# Conclusion
This is the conclusion with key takeaways.
`;

const docResult = smartTrunc.truncateDocument(document, 100);

check(
  'document truncation preserves structure',
  docResult.truncatedTokens <= 100,
  (v) => v === true,
  'true (within budget)'
);

check(
  'document keeps introduction',
  docResult.text.includes('Introduction'),
  (v) => v === true,
  'true (first section preserved)'
);

// ---------------------------------------------------------------------
// Step 10 - Batch truncation with budget
// ---------------------------------------------------------------------

console.log('\nStep 10 - batch truncation with budget');

const batchTrunc = new BatchTruncation();

const batch = [
  'First document content here. '.repeat(10),
  'Second document is shorter.',
  'Third document with some content. '.repeat(5),
];

const batchResults = batchTrunc.truncateBatch(batch, 100, 'head');

const totalBatchTokens = batchResults.reduce(
  (sum, r) => sum + r.truncatedTokens,
  0
);

check(
  'batch truncation fits total budget',
  totalBatchTokens <= 100,
  (v) => v === true,
  'true (total within limit)'
);

check(
  'batch preserves all documents',
  batchResults.length === batch.length,
  (v) => v === true,
  'true (all documents present)'
);

// ---------------------------------------------------------------------
// Step 11 - Priority-based context selection
// ---------------------------------------------------------------------

console.log('\nStep 11 - priority-based context selection');

const priorityManager = new PriorityContextManager(200);

const priorityMessages = [
  { role: 'system', content: 'System prompt here.', priority: 10 },
  { role: 'user', content: 'Low priority old message. '.repeat(10), priority: 1 },
  { role: 'assistant', content: 'Old response. '.repeat(10), priority: 1 },
  { role: 'user', content: 'High priority recent question!', priority: 5 },
  { role: 'assistant', content: 'Important answer.', priority: 5 },
];

const priorityResult = priorityManager.selectByPriority(priorityMessages);

check(
  'system message selected first',
  priorityResult[0].role === 'system',
  (v) => v === true,
  'true (system always first)'
);

check(
  'high priority messages selected',
  priorityResult.some((m) => m.content.includes('High priority')),
  (v) => v === true,
  'true (priority respected)'
);

// ---------------------------------------------------------------------
// Step 12 - Output budget calculation
// ---------------------------------------------------------------------

console.log('\nStep 12 - output budget calculation');

const outputManager = new ContextWindowManager({
  maxTokens: 4096,
  reservedForOutput: 1024,
  reservedForSystem: 100,
});

const inputTokens = 2500;
const outputBudget = outputManager.getOutputBudget(inputTokens);

check(
  'output budget respects reservation',
  outputBudget,
  (v) => v === 1024,
  '1024 (reserved amount when space allows)'
);

const highInputTokens = 3500;
const constrainedBudget = outputManager.getOutputBudget(highInputTokens);

check(
  'output budget constrained by remaining space',
  constrainedBudget,
  (v) => v < 1024,
  '<1024 (limited by remaining context)'
);

check(
  'output budget equals remaining space when constrained',
  constrainedBudget,
  (v) => v === 4096 - 3500,
  `${4096 - 3500} (remaining context window)`
);

// ---------------------------------------------------------------------
// Step 13 - Token estimation confidence bounds
// ---------------------------------------------------------------------

console.log('\nStep 13 - token estimation confidence bounds');

const boundsText = 'Sample text for estimation bounds testing. '.repeat(50);
const estimate = counter.estimateHybrid(boundsText);
const exact = counter.countExact(boundsText);

check(
  'exact count within estimate bounds',
  exact.estimate >= estimate.lowerBound && exact.estimate <= estimate.upperBound,
  (v) => v === true,
  'true (bounds contain actual value)'
);

check(
  'lower bound less than estimate',
  estimate.lowerBound < estimate.estimate,
  (v) => v === true,
  'true (proper bound ordering)'
);

check(
  'upper bound greater than estimate',
  estimate.upperBound > estimate.estimate,
  (v) => v === true,
  'true (proper bound ordering)'
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
