// Reproduces every numbered step of the Chapter 30 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch30-coding-agent)
//   node examples/ch30-coding-agent/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { CodeGenerator, parseCodeBlocks, estimateTokens } = await import(
  resolve(srcDir, 'generator.ts')
);
const {
  CodeValidator,
  isCodeSafeToExecute,
  summarizeValidationIssues,
} = await import(resolve(srcDir, 'validator.ts'));
const {
  Sandbox,
  createWorkspaceSandbox,
  createRestrictedSandbox,
  isSandboxResultSafe,
} = await import(resolve(srcDir, 'sandbox.ts'));
const {
  ContextManager,
  computeRelevance,
  buildContext,
  summarizeFile,
} = await import(resolve(srcDir, 'context.ts'));
const {
  ToolRegistry,
  createStandardTools,
  createRestrictedRegistry,
  validateToolCall,
  formatToolsForPrompt,
} = await import(resolve(srcDir, 'tools.ts'));

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
// Step 1 - Code generation with syntax validation
// ---------------------------------------------------------------------

console.log('\nStep 1 - Code generation and syntax validation');

const generator = new CodeGenerator();
const validator = new CodeValidator();

// Generate valid code
const validRequest = {
  prompt: 'hello world',
  language: 'typescript',
  context: { relevantFiles: [], totalTokens: 0, budgetTokens: 4000, truncated: false },
};

const validResult = await generator.generate(validRequest);

check(
  'valid code generates without errors',
  validResult.valid,
  (v) => v === true,
  'true (code should be syntactically valid)'
);

check(
  'valid code has no validation errors',
  validResult.validationErrors.length,
  (v) => v === 0,
  '0 validation errors'
);

// Generate invalid code
const invalidRequest = {
  prompt: 'invalid syntax',
  language: 'typescript',
  context: { relevantFiles: [], totalTokens: 0, budgetTokens: 4000, truncated: false },
};

const invalidResult = await generator.generate(invalidRequest);

check(
  'invalid code detected',
  invalidResult.valid,
  (v) => v === false,
  'false (code should be invalid)'
);

check(
  'syntax errors reported',
  invalidResult.validationErrors.length,
  (v) => v > 0,
  '> 0 validation errors'
);

// ---------------------------------------------------------------------
// Step 2 - Destructive command detection
// ---------------------------------------------------------------------

console.log('\nStep 2 - Destructive command detection');

// Test rm -rf detection
const destructiveCode = 'import { execSync } from "child_process";\nexecSync("rm -rf /");\n';
const destructiveValidation = validator.checkSafety(destructiveCode);

check(
  'rm -rf blocked',
  destructiveValidation.some(v => v.type === 'destructive_command'),
  (v) => v === true,
  'true (rm -rf should be detected)'
);

// Test DROP TABLE detection
const sqlCode = 'const query = `DROP TABLE users;`;\ndb.execute(query);';
const sqlValidation = validator.checkSafety(sqlCode);

check(
  'DROP TABLE blocked',
  sqlValidation.some(v => v.type === 'destructive_command'),
  (v) => v === true,
  'true (DROP TABLE should be detected)'
);

// Test DELETE FROM without WHERE
const deleteCode = 'db.execute("DELETE FROM users;");';
const deleteValidation = validator.checkSafety(deleteCode);

check(
  'DELETE FROM without WHERE blocked',
  deleteValidation.some(v => v.type === 'destructive_command'),
  (v) => v === true,
  'true (DELETE FROM without WHERE should be detected)'
);

// Test safe code passes
const safeCode = 'function add(a: number, b: number): number {\n  return a + b;\n}\n';
const safeValidation = validator.checkSafety(safeCode);
const safeBlocking = safeValidation.filter(v => v.severity === 'block');

check(
  'safe code not blocked',
  safeBlocking.length,
  (v) => v === 0,
  '0 blocking violations'
);

// ---------------------------------------------------------------------
// Step 3 - Sandbox path escape prevention
// ---------------------------------------------------------------------

console.log('\nStep 3 - Sandbox path escape prevention');

const sandbox = new Sandbox({
  allowedPaths: ['/workspace/project'],
});

// Test parent directory traversal
const traversalCheck = sandbox.checkPathViolations(
  'fs.readFileSync("../../../etc/passwd")'
);

check(
  'parent traversal blocked',
  traversalCheck !== null,
  (v) => v === true,
  'true (../ should be blocked)'
);

// Test system directory access
const systemCheck = sandbox.checkPathViolations(
  'fs.readFileSync("/etc/shadow")'
);

check(
  'system directory blocked',
  systemCheck !== null,
  (v) => v === true,
  'true (/etc/ should be blocked)'
);

// Test home directory expansion
const homeCheck = sandbox.checkPathViolations(
  'fs.readFileSync("~/.ssh/id_rsa")'
);

check(
  'home directory blocked',
  homeCheck !== null,
  (v) => v === true,
  'true (~/ should be blocked)'
);

// Test allowed path within workspace
const allowedPath = sandbox.isPathAllowed('/workspace/project/src/main.ts');

check(
  'workspace path allowed',
  allowedPath,
  (v) => v === true,
  'true (workspace paths should be allowed)'
);

// ---------------------------------------------------------------------
// Step 4 - Context budget enforcement
// ---------------------------------------------------------------------

console.log('\nStep 4 - Context budget enforcement');

const contextManager = new ContextManager(1000); // 1000 token budget

// Add small file - should fit
const smallFile = 'function small() { return 1; }';
const smallAdded = contextManager.addFile('small.ts', smallFile, 0.8);

check(
  'small file fits in budget',
  smallAdded,
  (v) => v === true,
  'true (small file should be included)'
);

// Add large file - should not fit
const largeFile = 'x'.repeat(5000); // ~1250 tokens
const largeAdded = contextManager.addFile('large.ts', largeFile, 0.5);

check(
  'large file excluded when over budget',
  largeAdded,
  (v) => v === false,
  'false (large file should be excluded)'
);

// Check budget status
const budget = contextManager.getBudgetStatus();

check(
  'budget tracking accurate',
  budget.used <= budget.budget,
  (v) => v === true,
  'true (used should not exceed budget)'
);

// Check context reports truncation
const context = contextManager.getContext();

check(
  'truncation reported when files excluded',
  context.truncated,
  (v) => v === true,
  'true (context should report truncation)'
);

// Check file prioritization
contextManager.clear();
contextManager.addFile('low.ts', 'low priority', 0.2);
contextManager.addFile('high.ts', 'high priority', 0.9);
const sortedContext = contextManager.getContext();

check(
  'files sorted by relevance',
  sortedContext.relevantFiles[0].path,
  (v) => v === 'high.ts',
  'high.ts (highest relevance first)'
);

// ---------------------------------------------------------------------
// Step 5 - Tool permission enforcement
// ---------------------------------------------------------------------

console.log('\nStep 5 - Tool permission enforcement');

// Create restricted registry (read-only)
const readOnlyRegistry = createRestrictedRegistry(['read']);
const standardTools = createStandardTools();
for (const tool of standardTools) {
  readOnlyRegistry.register(tool);
}

// Read operations should work
const readResult = await readOnlyRegistry.execute('read_file', {
  path: 'test.ts',
});

check(
  'read operation allowed',
  readResult.success,
  (v) => v === true,
  'true (read should be allowed)'
);

// Write operations should be blocked
const writeResult = await readOnlyRegistry.execute('write_file', {
  path: 'test.ts',
  content: 'new content',
});

check(
  'write operation blocked when read-only',
  writeResult.blocked,
  (v) => v === true,
  'true (write should be blocked)'
);

// Execute operations should be blocked
const execResult = await readOnlyRegistry.execute('run_command', {
  command: 'ls -la',
});

check(
  'execute operation blocked when read-only',
  execResult.blocked,
  (v) => v === true,
  'true (execute should be blocked)'
);

// With write permission, write should work
const writeRegistry = createRestrictedRegistry(['read', 'write']);
for (const tool of standardTools) {
  writeRegistry.register(tool);
}

const writeAllowedResult = await writeRegistry.execute('write_file', {
  path: 'test.ts',
  content: 'new content',
});

check(
  'write operation allowed with permission',
  writeAllowedResult.success,
  (v) => v === true,
  'true (write should be allowed with permission)'
);

// ---------------------------------------------------------------------
// Step 6 - Tool argument validation
// ---------------------------------------------------------------------

console.log('\nStep 6 - Tool argument validation');

const fullRegistry = createRestrictedRegistry(['read', 'write', 'execute']);
for (const tool of standardTools) {
  fullRegistry.register(tool);
}

// Missing required parameter
const missingResult = await fullRegistry.execute('read_file', {});

check(
  'missing parameter rejected',
  missingResult.success,
  (v) => v === false,
  'false (missing path should fail)'
);

check(
  'error message mentions parameter',
  missingResult.error?.includes('path'),
  (v) => v === true,
  'true (error should mention missing param)'
);

// Invalid parameter type
const invalidTypeResult = await fullRegistry.execute('read_file', {
  path: 12345, // should be string
});

check(
  'wrong type rejected',
  invalidTypeResult.success,
  (v) => v === false,
  'false (wrong type should fail)'
);

// Valid parameters work
const validParamsResult = await fullRegistry.execute('read_file', {
  path: 'valid/path.ts',
});

check(
  'valid parameters accepted',
  validParamsResult.success,
  (v) => v === true,
  'true (valid params should work)'
);

// ---------------------------------------------------------------------
// Step 7 - Destructive command blocking in tools
// ---------------------------------------------------------------------

console.log('\nStep 7 - Destructive command blocking in tools');

// rm -rf should be blocked even with execute permission
const rmResult = await fullRegistry.execute('run_command', {
  command: 'rm -rf /',
});

check(
  'rm -rf blocked by tool',
  rmResult.blocked,
  (v) => v === true,
  'true (rm -rf should be blocked)'
);

check(
  'block reason is destructive_command',
  rmResult.blockReason,
  (v) => v === 'destructive_command',
  'destructive_command'
);

// DROP TABLE should be blocked
const dropResult = await fullRegistry.execute('run_command', {
  command: 'psql -c "DROP TABLE users"',
});

check(
  'DROP TABLE blocked by tool',
  dropResult.blocked,
  (v) => v === true,
  'true (DROP TABLE should be blocked)'
);

// Safe command should work
const safeResult = await fullRegistry.execute('run_command', {
  command: 'ls -la',
});

check(
  'safe command allowed',
  safeResult.success,
  (v) => v === true,
  'true (ls should be allowed)'
);

// ---------------------------------------------------------------------
// Step 8 - Sandbox execution limits
// ---------------------------------------------------------------------

console.log('\nStep 8 - Sandbox execution limits');

const execSandbox = createWorkspaceSandbox('/workspace');

// Infinite loop should timeout
const loopCode = 'while (true) { console.log("forever"); }';
const loopResult = await execSandbox.execute(loopCode, 'javascript');

check(
  'infinite loop times out',
  loopResult.timedOut,
  (v) => v === true,
  'true (infinite loop should timeout)'
);

// Memory exhaustion detected
const memoryCode = 'const arr = [];\nwhile (true) {\n  arr.push(new Array(1000000));\n}';
const memoryResult = await execSandbox.execute(memoryCode, 'javascript');

check(
  'memory exhaustion caught',
  memoryResult.stderr.includes('memory') || memoryResult.exitCode !== 0,
  (v) => v === true,
  'true (memory exhaustion should be caught)'
);

// Valid code executes successfully
const goodCode = 'console.log("hello"); return 42;';
const goodResult = await execSandbox.execute(goodCode, 'javascript');

check(
  'valid code executes',
  goodResult.success,
  (v) => v === true,
  'true (valid code should execute)'
);

// ---------------------------------------------------------------------
// Step 9 - Context relevance scoring
// ---------------------------------------------------------------------

console.log('\nStep 9 - Context relevance scoring');

// File containing query terms should score higher
const highRelevance = computeRelevance(
  'src/auth/login.ts',
  'function login(user) { return authenticate(user); }',
  'login'
);

const lowRelevance = computeRelevance(
  'src/utils/helpers.ts',
  'function formatDate(d) { return d.toString(); }',
  'login'
);

check(
  'relevant file scores higher',
  highRelevance > lowRelevance,
  (v) => v === true,
  'true (login.ts should score higher for "login" query)'
);

// Path match boosts score
const pathMatchRelevance = computeRelevance(
  'src/search/index.ts',
  'export function main() {}',
  'search'
);

check(
  'path match boosts relevance',
  pathMatchRelevance > 0.3,
  (v) => v === true,
  'true (path containing query should score > 0.3)'
);

// Build context prioritizes relevant files
const files = [
  { path: 'irrelevant.ts', content: 'const x = 1;' },
  { path: 'target.ts', content: 'function target() { return "found"; }' },
  { path: 'other.ts', content: 'console.log("other");' },
];

const builtContext = buildContext(files, 'target', 500);
const topFile = builtContext.relevantFiles[0];

check(
  'context prioritizes relevant files',
  topFile.path,
  (v) => v === 'target.ts',
  'target.ts (most relevant should be first)'
);

// ---------------------------------------------------------------------
// Step 10 - File summarization for token savings
// ---------------------------------------------------------------------

console.log('\nStep 10 - File summarization');

const fullFile = `
// This is a comment
import { something } from 'somewhere';

/**
 * Multi-line comment
 * that spans lines
 */

function publicFunction(x: number): number {
  // Implementation details
  const temp = x * 2;
  return temp + 1;
}

class MyClass {
  private field: string;

  constructor() {
    this.field = '';
  }

  method() {
    return this.field;
  }
}

interface MyInterface {
  prop: string;
}

const internalHelper = () => {
  // Private helper
};
`;

const summary = summarizeFile(fullFile);

check(
  'summary includes imports',
  summary.includes('import'),
  (v) => v === true,
  'true (imports should be preserved)'
);

check(
  'summary includes function definition',
  summary.includes('function publicFunction'),
  (v) => v === true,
  'true (function definitions should be preserved)'
);

check(
  'summary includes class definition',
  summary.includes('class MyClass'),
  (v) => v === true,
  'true (class definitions should be preserved)'
);

check(
  'summary includes interface',
  summary.includes('interface MyInterface'),
  (v) => v === true,
  'true (interfaces should be preserved)'
);

check(
  'summary is shorter than original',
  summary.length < fullFile.length,
  (v) => v === true,
  'true (summary should be shorter)'
);

// ---------------------------------------------------------------------
// Step 11 - Combined validation flow
// ---------------------------------------------------------------------

console.log('\nStep 11 - Combined validation flow');

// Test end-to-end: generate, validate, check safety
const e2eRequest = {
  prompt: 'delete files',
  language: 'typescript',
  context: { relevantFiles: [], totalTokens: 0, budgetTokens: 4000, truncated: false },
};

const e2eGenResult = await generator.generate(e2eRequest);
const e2eValidation = validator.validate(e2eGenResult.code, 'typescript');
const e2eSafe = isCodeSafeToExecute({
  ...e2eGenResult,
  safetyViolations: e2eValidation.violations,
});

check(
  'dangerous generated code blocked',
  e2eSafe,
  (v) => v === false,
  'false (destructive code should be blocked)'
);

// Safe code should pass
const safeRequest = {
  prompt: 'sort array',
  language: 'typescript',
  context: { relevantFiles: [], totalTokens: 0, budgetTokens: 4000, truncated: false },
};

const safeGenResult = await generator.generate(safeRequest);
const safeValidation2 = validator.validate(safeGenResult.code, 'typescript');
const safeSafe = isCodeSafeToExecute({
  ...safeGenResult,
  safetyViolations: safeValidation2.violations,
});

check(
  'safe generated code allowed',
  safeSafe,
  (v) => v === true,
  'true (safe code should be allowed)'
);

// ---------------------------------------------------------------------
// Step 12 - Parse code blocks from model response
// ---------------------------------------------------------------------

console.log('\nStep 12 - Code block parsing');

const modelResponse = `
Here's the solution:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

And here's a Python version:

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`
`;

const blocks = parseCodeBlocks(modelResponse);

check(
  'multiple code blocks extracted',
  blocks.length,
  (v) => v === 2,
  '2 code blocks'
);

check(
  'first block is TypeScript',
  blocks[0].language,
  (v) => v === 'typescript',
  'typescript'
);

check(
  'second block is Python',
  blocks[1].language,
  (v) => v === 'python',
  'python'
);

check(
  'code content extracted correctly',
  blocks[0].code.includes('function greet'),
  (v) => v === true,
  'true (code content should be preserved)'
);

// ---------------------------------------------------------------------
// Step 13 - Token estimation
// ---------------------------------------------------------------------

console.log('\nStep 13 - Token estimation');

const shortCode = 'x = 1';
const longCode = 'x'.repeat(1000);

const shortTokens = estimateTokens(shortCode);
const longTokens = estimateTokens(longCode);

check(
  'short code has few tokens',
  shortTokens < 10,
  (v) => v === true,
  'true (short code should have < 10 tokens)'
);

check(
  'long code has many tokens',
  longTokens > 200,
  (v) => v === true,
  'true (long code should have > 200 tokens)'
);

check(
  'token count scales with length',
  longTokens > shortTokens * 10,
  (v) => v === true,
  'true (longer code should have proportionally more tokens)'
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
