// Reproduces every numbered step of the Chapter 20 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch20-memory)
//   node examples/ch20-memory/scripts/lab.mjs   (from repo root)
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
  countTokens,
  countMessageTokens,
  countMessagesTokens,
  isWithinTolerance,
  TOKEN_TEST_SAMPLES,
} = await import(resolve(srcDir, 'tokenizer.ts'));

const { SlidingWindow, createSlidingWindow } = await import(
  resolve(srcDir, 'sliding-window.ts')
);

const { Summarizer, createSummarizer } = await import(
  resolve(srcDir, 'summary.ts')
);

const { TokenBuffer, createBuffer } = await import(
  resolve(srcDir, 'buffer.ts')
);

const { MemoryManager, createMemoryManager } = await import(
  resolve(srcDir, 'memory.ts')
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
  console.log(`         expected ${expectation}, observed ${actual}`);
}

// ---------------------------------------------------------------------
// Step 1 - Token counting accuracy
// ---------------------------------------------------------------------

console.log('\nStep 1 - token counting accuracy');

// Test against known samples
let accurateCount = 0;
for (const sample of TOKEN_TEST_SAMPLES) {
  const estimated = countTokens(sample.text);
  if (isWithinTolerance(estimated, sample.expected, 0.3)) {
    accurateCount++;
  }
}

check(
  'token estimation within 30% for test samples',
  accurateCount,
  (v) => v >= TOKEN_TEST_SAMPLES.length * 0.8,
  `>= ${Math.floor(TOKEN_TEST_SAMPLES.length * 0.8)} of ${TOKEN_TEST_SAMPLES.length} samples accurate`
);

// Test a longer conversation
const longConversation = [
  { role: 'system', content: 'You are a helpful assistant.', timestamp: Date.now() },
  { role: 'user', content: 'Can you help me understand how memory management works in LLM applications?', timestamp: Date.now() },
  { role: 'assistant', content: 'Memory management in LLM applications involves tracking conversation history and ensuring it fits within the model context window. There are several strategies including sliding windows, summarization, and fact extraction.', timestamp: Date.now() },
];

const estimatedConvoTokens = countMessagesTokens(longConversation);

check(
  'conversation token count is reasonable',
  estimatedConvoTokens,
  (v) => v >= 40 && v <= 100,
  'between 40 and 100 tokens for a 3-message conversation'
);

// ---------------------------------------------------------------------
// Step 2 - Sliding window stays within token budget
// ---------------------------------------------------------------------

console.log('\nStep 2 - sliding window token budget enforcement');

const window = createSlidingWindow(10, 500);
window.setSystemPrompt('You are a helpful assistant.');

// Add messages until we exceed the budget
for (let i = 0; i < 20; i++) {
  window.addUserMessage(
    `This is message ${i} with some additional content to use up tokens. ` +
    `We want to verify that the sliding window properly evicts old messages.`
  );
  window.addAssistantMessage(
    `This is response ${i}. I acknowledge your message and provide a helpful response.`
  );
}

const windowTokens = window.getTotalTokens();

check(
  'sliding window stays under token budget',
  windowTokens,
  (v) => v <= 500,
  '<= 500 tokens (configured max)'
);

check(
  'sliding window evicted old turns',
  window.getTurnCount(),
  (v) => v < 20,
  '< 20 turns (some evicted to stay within budget)'
);

// Verify oldest turn was evicted
const oldestTurn = window.getOldestTurn();
check(
  'oldest remaining turn is not turn 0',
  oldestTurn?.index,
  (v) => v > 0,
  '> 0 (turn 0 was evicted)'
);

// ---------------------------------------------------------------------
// Step 3 - Summary preserves key facts
// ---------------------------------------------------------------------

console.log('\nStep 3 - summary preserves key facts');

const summarizer = createSummarizer(200);

// Create turns with extractable facts and realistic token counts
const factyTurns = [
  {
    index: 0,
    user: {
      role: 'user',
      content: 'My name is Alice and I prefer dark mode interfaces. I have been using your service for about two years now and I really appreciate the customization options you provide. The dark mode helps reduce eye strain during late night coding sessions.',
      timestamp: Date.now(),
    },
    assistant: {
      role: 'assistant',
      content: 'Nice to meet you, Alice! I will remember your preference for dark mode. It is great to hear you have been with us for two years. Dark mode is indeed popular among developers for reducing eye strain. Let me know if you need any other customizations.',
      timestamp: Date.now(),
    },
    totalTokens: 120,
    importance: 'normal',
  },
  {
    index: 1,
    user: {
      role: 'user',
      content: 'I am trying to build a chatbot for customer support. The chatbot needs to handle multiple languages and integrate with our existing CRM system. We expect about 10,000 conversations per day initially.',
      timestamp: Date.now(),
    },
    assistant: {
      role: 'assistant',
      content: 'That sounds like a great project. Customer support chatbots can significantly reduce response times. For multi-language support, you will want to consider translation APIs or multilingual models. CRM integration typically involves webhooks or direct API connections. At 10,000 conversations per day, you should plan for robust infrastructure.',
      timestamp: Date.now(),
    },
    totalTokens: 140,
    importance: 'normal',
  },
  {
    index: 2,
    user: {
      role: 'user',
      content: 'The chatbot must handle sensitive financial data securely. We are in a regulated industry so compliance is critical. All data must be encrypted at rest and in transit.',
      timestamp: Date.now(),
    },
    assistant: {
      role: 'assistant',
      content: 'Security is critical for financial data. You will need encryption at rest using AES-256, TLS 1.3 for transit encryption, audit logging for compliance, proper access controls with role-based permissions, and regular security assessments. Consider SOC 2 compliance as a framework.',
      timestamp: Date.now(),
    },
    totalTokens: 100,
    importance: 'high',
  },
];

const summaryResult = summarizer.summarize(factyTurns);

check(
  'summary extracts facts',
  summaryResult.extractedFacts.length,
  (v) => v >= 2,
  '>= 2 facts extracted (name, preference, goal, or constraint)'
);

// Check that name fact was extracted
const nameFact = summaryResult.extractedFacts.find(
  (f) => f.category === 'name'
);
check(
  'name fact extracted correctly',
  nameFact?.content,
  (v) => v && v.toLowerCase().includes('alice'),
  'contains "alice"'
);

// Check compression - summary should be smaller than original
// Note: compressionRatio = originalTokens / summaryTokens, so > 1 means compression
check(
  'summary achieves compression',
  summaryResult.compressionRatio,
  (v) => v > 1.2,
  '> 1.2x compression (summary smaller than original)'
);

// ---------------------------------------------------------------------
// Step 4 - Token buffer eviction is deterministic
// ---------------------------------------------------------------------

console.log('\nStep 4 - token buffer eviction is deterministic');

// Test FIFO eviction
const fifoBuffer = createBuffer(300, 'fifo');
fifoBuffer.setSystemPrompt('System prompt.');

fifoBuffer.addTurn('First message', 'First response', 'low');
fifoBuffer.addTurn('Second message', 'Second response', 'high');
fifoBuffer.addTurn('Third message', 'Third response', 'normal');
fifoBuffer.addTurn('Fourth message', 'Fourth response', 'low');
fifoBuffer.addTurn('Fifth message', 'Fifth response', 'high');

// Force eviction
const fifoResult = fifoBuffer.trimToFit(200);

// The most recent turns should be preserved
const fifoTurns = fifoBuffer.getTurns();
const hasRecentTurn = fifoTurns.some(
  (t) => t.user.content.includes('Fifth')
);

check(
  'FIFO preserves most recent turns',
  hasRecentTurn,
  (v) => v === true,
  'true (most recent turn preserved)'
);

// Test importance-based eviction
const importanceBuffer = createBuffer(300, 'importance');
importanceBuffer.setSystemPrompt('System prompt.');

importanceBuffer.addTurn('Low importance first', 'Response', 'low');
importanceBuffer.addTurn('High importance second', 'Response', 'high');
importanceBuffer.addTurn('Low importance third', 'Response', 'low');
importanceBuffer.addTurn('Critical fourth', 'Response', 'critical');
importanceBuffer.addTurn('Normal fifth', 'Response', 'normal');

// Force eviction
importanceBuffer.trimToFit(200);

const importanceTurns = importanceBuffer.getTurns();
const hasHighImportance = importanceTurns.some(
  (t) => t.importance === 'high' || t.importance === 'critical'
);

check(
  'importance strategy preserves high-importance turns',
  hasHighImportance,
  (v) => v === true,
  'true (high/critical importance preserved over low)'
);

// Test determinism: same input produces same output
const buffer1 = createBuffer(200, 'hybrid');
const buffer2 = createBuffer(200, 'hybrid');

for (const buf of [buffer1, buffer2]) {
  buf.addTurn('Message A', 'Response A', 'low');
  buf.addTurn('Message B', 'Response B', 'high');
  buf.addTurn('Message C', 'Response C', 'normal');
  buf.addTurn('Message D', 'Response D', 'low');
  buf.trimToFit(150);
}

const turns1 = buffer1.getTurns().map((t) => t.user.content);
const turns2 = buffer2.getTurns().map((t) => t.user.content);

check(
  'eviction is deterministic',
  JSON.stringify(turns1) === JSON.stringify(turns2),
  (v) => v === true,
  'true (same input produces same output)'
);

// ---------------------------------------------------------------------
// Step 5 - Memory manager compression
// ---------------------------------------------------------------------

console.log('\nStep 5 - memory manager automatic compression');

// Use a small token budget to force compression
const manager = createMemoryManager(400, 100);
manager.setSystemPrompt('You are a helpful coding assistant.');

// Add messages that will exceed the budget
for (let i = 0; i < 8; i++) {
  manager.addUserMessage(
    `Question ${i}: How do I implement feature ${i} in my application? ` +
    `This requires understanding of various programming concepts and design patterns.`
  );
  manager.addAssistantMessage(
    `For feature ${i}, you would need to consider the architecture carefully. ` +
    `Here are the detailed steps: first design the interface, then implement the core logic, ` +
    `and finally write comprehensive tests to verify correctness.`
  );
}

const stats = manager.getStats();

check(
  'memory manager stays within budget',
  stats.totalTokens,
  (v) => v <= 400,
  '<= 400 tokens (configured max)'
);

check(
  'memory manager compressed history',
  manager.hasBeenCompressed(),
  (v) => v === true,
  'true (compression triggered after threshold)'
);

check(
  'compression count is positive',
  manager.getCompressionCount(),
  (v) => v >= 1,
  '>= 1 (at least one compression occurred)'
);

// ---------------------------------------------------------------------
// Step 6 - Fact preservation through compression
// ---------------------------------------------------------------------

console.log('\nStep 6 - fact preservation through compression');

// Small budget to force compression of initial messages
const factManager = createMemoryManager(300, 50);
factManager.setSystemPrompt('You are a personal assistant.');

// Add messages with important facts (these will get compressed and facts extracted)
factManager.addUserMessage(
  'My name is Bob and I am working on a machine learning project. This is my first time building a production ML system.'
);
factManager.addAssistantMessage(
  'Hello Bob! I would be happy to help with your machine learning project. Building production ML systems is exciting and challenging.'
);

factManager.addUserMessage(
  'I prefer Python for data science work because of the excellent library ecosystem.'
);
factManager.addAssistantMessage(
  'Python is a great choice for data science with libraries like pandas, numpy, and scikit-learn.'
);

// Add more messages to trigger compression of the earlier fact-containing messages
for (let i = 0; i < 6; i++) {
  factManager.addUserMessage(
    `Follow-up question ${i} about various machine learning topics and techniques that I need to understand.`
  );
  factManager.addAssistantMessage(
    `Here is my detailed response to question ${i} with explanations and examples.`
  );
}

// Check that facts were preserved
const facts = factManager.getFacts();

check(
  'facts extracted from conversation',
  facts.length,
  (v) => v >= 1,
  '>= 1 fact extracted'
);

// Verify name was captured
const hasBobFact = factManager.hasFact('name', 'bob');
check(
  'name fact preserved through compression',
  hasBobFact,
  (v) => v === true,
  'true (Bob was extracted and preserved)'
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
