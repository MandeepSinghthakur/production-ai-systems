#!/usr/bin/env node

/**
 * Technical Review Script
 *
 * Validates chapters for promotion from draft → tech status.
 *
 * Usage:
 *   node scripts/review.mjs ch18           # Review single chapter
 *   node scripts/review.mjs --all          # Review all chapters
 *   node scripts/review.mjs --summary      # Show status summary
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BANNED_WORDS = [
  'leverage', 'seamless', 'robust', 'cutting-edge', 'game-changing',
  'revolutionary', 'unlock', 'empower', 'blazing', 'delve', 'tapestry'
];

const REPORTED_SCENARIO_PATTERNS = [
  /\bA (company|team|bank|firm|startup) (had|was|did|built|created|deployed)\b/gi,
  /\bWe (had|were|did|built|created|deployed)\b/gi,
  /\bI (had|was|did|built|created|deployed) at\b/gi
];

const MODEL_NAME_PATTERNS = [
  /\bgpt-4\b/gi, /\bgpt-3\.5\b/gi, /\bclaude-3\b/gi, /\bclaude-2\b/gi,
  /\bgemini\b/gi, /\bllama-2\b/gi, /\bmistral\b/gi, /\bpalm\b/gi
];

const PRICE_PATTERNS = [
  /\$\d+\.\d+\s*(per|\/)\s*(1k|1000|million|m|k)\s*tokens?\b/gi,
  /\$\d+\s*\/\s*(input|output)\s*token/gi
];

const CHAPTERS = [
  { id: 'ch01-distributed-systems', num: 1, assertions: 40 },
  { id: 'ch02-scaling-apis', num: 2, assertions: 35 },
  { id: 'ch03-load-balancing', num: 3, assertions: 34 },
  { id: 'ch04-redis', num: 4, assertions: 21 },
  { id: 'ch05-postgres', num: 5, assertions: 29 },
  { id: 'ch06-kafka', num: 6, assertions: 16 },
  { id: 'ch07-event-driven', num: 7, assertions: 42 },
  { id: 'ch08-outbox-saga', num: 8, assertions: 43 },
  { id: 'ch09-observability', num: 9, assertions: 55 },
  { id: 'ch10-transformers', num: 10, assertions: 38 },
  { id: 'ch11-tokenization', num: 11, assertions: 41 },
  { id: 'ch12-embeddings', num: 12, assertions: 40 },
  { id: 'ch13-streaming', num: 13, assertions: 37 },
  { id: 'ch14-document-ingestion', num: 14, assertions: 43 },
  { id: 'ch15-document-search', num: 15, assertions: 28 },
  { id: 'ch16-vector-search', num: 16, assertions: 24 },
  { id: 'ch17-reranking', num: 17, assertions: 19 },
  { id: 'ch18-llm-gateway', num: 18, assertions: 13 },
  { id: 'ch19-routing', num: 19, assertions: 13 },
  { id: 'ch20-memory', num: 20, assertions: 16 },
  { id: 'ch21-evaluation', num: 21, assertions: 23 },
  { id: 'ch22-security', num: 22, assertions: 30 },
  { id: 'ch23-cost-control', num: 23, assertions: 13 },
  { id: 'ch24-tool-calling', num: 24, assertions: 17 },
  { id: 'ch25-planning', num: 25, assertions: 43 },
  { id: 'ch26-mcp', num: 26, assertions: 35 },
  { id: 'ch27-multi-agent', num: 27, assertions: 16 },
  { id: 'ch28-conversational-assistant', num: 28, assertions: 24 },
  { id: 'ch29-regulated-ai', num: 29, assertions: 42 },
  { id: 'ch30-coding-agent', num: 30, assertions: 49 },
  { id: 'ch31-multi-tenant', num: 31, assertions: 28 },
  { id: 'ch32-architecture-rfcs', num: 32, assertions: 28 },
  { id: 'ch33-incident-management', num: 33, assertions: 26 },
  { id: 'ch34-technical-strategy', num: 34, assertions: 25 },
];

function findProseFile(chapterId) {
  const bookDir = join(ROOT, 'book');
  const files = readdirSync(bookDir);
  const prefix = chapterId.replace(/-/g, '').slice(0, 4); // ch18, ch19, etc.

  for (const file of files) {
    if (file.startsWith(prefix.slice(0, 4)) || file.startsWith(chapterId.slice(0, 4))) {
      return join(bookDir, file);
    }
  }

  // Try with the full id
  const possibleNames = [
    `${chapterId}.md`,
    chapterId.replace('ch', 'ch').replace(/-/g, '-') + '.md'
  ];

  for (const name of possibleNames) {
    const path = join(bookDir, name);
    if (existsSync(path)) return path;
  }

  // Find by chapter number
  const num = chapterId.match(/ch(\d+)/)?.[1];
  if (num) {
    for (const file of files) {
      if (file.startsWith(`ch${num}-`) || file.startsWith(`ch${num.padStart(2, '0')}-`)) {
        return join(bookDir, file);
      }
    }
  }

  return null;
}

function runLab(chapterId, fromDir = 'root') {
  const exampleDir = join(ROOT, 'examples', chapterId);
  const labPath = join(exampleDir, 'scripts', 'lab.mjs');

  if (!existsSync(labPath)) {
    return { pass: false, output: 'Lab file not found', assertions: 0 };
  }

  try {
    let output;
    if (fromDir === 'root') {
      output = execSync(`node ${labPath}`, { cwd: ROOT, encoding: 'utf-8', timeout: 120000 });
    } else {
      output = execSync('node scripts/lab.mjs', { cwd: exampleDir, encoding: 'utf-8', timeout: 120000 });
    }

    const match = output.match(/(\d+)\/(\d+) checks passed/);
    if (match) {
      const [, passed, total] = match;
      return { pass: passed === total, output, assertions: parseInt(total) };
    }
    return { pass: false, output, assertions: 0 };
  } catch (err) {
    return { pass: false, output: err.message, assertions: 0 };
  }
}

function checkBannedWords(content) {
  const found = [];
  for (const word of BANNED_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      found.push({ word, count: matches.length });
    }
  }
  return found;
}

function checkReportedScenarios(content) {
  const found = [];
  for (const pattern of REPORTED_SCENARIO_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return found;
}

function checkModelNames(content) {
  const found = [];
  for (const pattern of MODEL_NAME_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return found;
}

function checkPrices(content) {
  const found = [];
  for (const pattern of PRICE_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return found;
}

function countSections(content) {
  const h2Matches = content.match(/^## /gm);
  return h2Matches ? h2Matches.length : 0;
}

function reviewChapter(chapter) {
  const results = {
    chapter: chapter.id,
    checks: [],
    warnings: [],
    pass: true
  };

  // Check 1: Lab passes from repo root
  const labRoot = runLab(chapter.id, 'root');
  if (labRoot.pass) {
    results.checks.push({ name: 'Lab passes (repo root)', pass: true, detail: `${labRoot.assertions}/${labRoot.assertions}` });
  } else {
    results.checks.push({ name: 'Lab passes (repo root)', pass: false, detail: labRoot.output.slice(0, 100) });
    results.pass = false;
  }

  // Check 2: Lab passes from example dir
  const labDir = runLab(chapter.id, 'example');
  if (labDir.pass) {
    results.checks.push({ name: 'Lab passes (example dir)', pass: true, detail: `${labDir.assertions}/${labDir.assertions}` });
  } else {
    results.checks.push({ name: 'Lab passes (example dir)', pass: false, detail: labDir.output.slice(0, 100) });
    results.pass = false;
  }

  // Find and check prose file
  const proseFile = findProseFile(chapter.id);
  if (!proseFile) {
    results.checks.push({ name: 'Prose file exists', pass: false, detail: 'Not found' });
    results.pass = false;
    return results;
  }

  results.checks.push({ name: 'Prose file exists', pass: true, detail: proseFile.split('/').pop() });

  const content = readFileSync(proseFile, 'utf-8');

  // Check 3: No banned words
  const bannedFound = checkBannedWords(content);
  if (bannedFound.length === 0) {
    results.checks.push({ name: 'No banned words', pass: true, detail: 'Clean' });
  } else {
    const detail = bannedFound.map(b => `${b.word}(${b.count})`).join(', ');
    results.checks.push({ name: 'No banned words', pass: false, detail });
    results.pass = false;
  }

  // Check 4: Scenarios constructed
  const reportedFound = checkReportedScenarios(content);
  if (reportedFound.length === 0) {
    results.checks.push({ name: 'Scenarios constructed', pass: true, detail: 'Clean' });
  } else {
    results.checks.push({ name: 'Scenarios constructed', pass: false, detail: reportedFound[0] });
    results.pass = false;
  }

  // Check 5: No model names
  const modelNames = checkModelNames(content);
  if (modelNames.length === 0) {
    results.checks.push({ name: 'No model names', pass: true, detail: 'Clean' });
  } else {
    results.checks.push({ name: 'No model names', pass: false, detail: modelNames.join(', ') });
    results.pass = false;
  }

  // Check 6: No prices
  const prices = checkPrices(content);
  if (prices.length === 0) {
    results.checks.push({ name: 'No prices', pass: true, detail: 'Clean' });
  } else {
    results.warnings.push({ name: 'Prices found', detail: prices.join(', ') });
  }

  // Check 7: 15 sections
  const sectionCount = countSections(content);
  if (sectionCount >= 15) {
    results.checks.push({ name: '15+ sections', pass: true, detail: `${sectionCount} sections` });
  } else {
    results.checks.push({ name: '15+ sections', pass: false, detail: `Only ${sectionCount} sections` });
    results.pass = false;
  }

  return results;
}

function printResults(results) {
  console.log(`\nCh ${results.chapter}`);

  for (const check of results.checks) {
    const status = check.pass ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`  ${status} ${check.name}`);
    console.log(`         ${check.detail}`);
  }

  for (const warn of results.warnings) {
    console.log(`  \x1b[33m[WARN]\x1b[0m ${warn.name}`);
    console.log(`         ${warn.detail}`);
  }

  const verdict = results.pass ? '\x1b[32mREADY FOR TECH\x1b[0m' : '\x1b[31mNEEDS WORK\x1b[0m';
  console.log(`\nStatus: ${verdict}\n`);
}

function printSummary() {
  console.log('\n## Chapter Status Summary\n');
  console.log('| Ch | Lab | Prose | Status |');
  console.log('|----|-----|-------|--------|');

  for (const chapter of CHAPTERS) {
    const labRoot = runLab(chapter.id, 'root');
    const proseFile = findProseFile(chapter.id);
    const labStatus = labRoot.pass ? '✅' : '❌';
    const proseStatus = proseFile ? '✅' : '❌';
    const overall = (labRoot.pass && proseFile) ? 'Ready' : 'Needs work';
    console.log(`| ${chapter.num} | ${labStatus} | ${proseStatus} | ${overall} |`);
  }
}

// Main
const args = process.argv.slice(2);

if (args.includes('--summary')) {
  printSummary();
} else if (args.includes('--all')) {
  let allPass = true;
  for (const chapter of CHAPTERS) {
    const results = reviewChapter(chapter);
    printResults(results);
    if (!results.pass) allPass = false;
  }
  console.log(allPass ? '\n✅ All chapters ready for tech review' : '\n❌ Some chapters need work');
  process.exit(allPass ? 0 : 1);
} else if (args[0]) {
  const target = args[0].toLowerCase();
  const chapter = CHAPTERS.find(c =>
    c.id === target ||
    c.id.includes(target) ||
    `ch${c.num}` === target ||
    `ch${c.num.toString().padStart(2, '0')}` === target
  );

  if (!chapter) {
    console.error(`Chapter not found: ${target}`);
    console.error('Use chapter ID (ch18-llm-gateway) or number (ch18, 18)');
    process.exit(1);
  }

  const results = reviewChapter(chapter);
  printResults(results);
  process.exit(results.pass ? 0 : 1);
} else {
  console.log('Usage:');
  console.log('  node scripts/review.mjs ch18           # Review single chapter');
  console.log('  node scripts/review.mjs --all          # Review all chapters');
  console.log('  node scripts/review.mjs --summary      # Show status summary');
}
