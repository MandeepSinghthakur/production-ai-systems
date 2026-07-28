// Reproduces every numbered step of the Chapter 14 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch14-document-ingestion)
//   node examples/ch14-document-ingestion/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');
const fixturesDir = resolve(__dirname, '..', 'fixtures');

// Dynamic imports with resolved paths
const { extractText, detectFormat, validateExtraction } =
  await import(resolve(srcDir, 'extractor.ts'));
const { processOcr, simulateOcrNoise, calculateCer, postProcessOcr, isOcrUsable } =
  await import(resolve(srcDir, 'ocr.ts'));
const { extractMetadata, extractSections, detectTitle, detectLanguage } =
  await import(resolve(srcDir, 'metadata.ts'));
const { normalizeDocument, normalizeWhitespace, mergePages } =
  await import(resolve(srcDir, 'normalizer.ts'));
const { createPipeline, ingestDocument, canIngest, getPipelineMetrics } =
  await import(resolve(srcDir, 'pipeline.ts'));

// ---------------------------------------------------------------------
// Test documents
// ---------------------------------------------------------------------

const sampleTxt = readFileSync(resolve(fixturesDir, 'sample.txt'), 'utf-8');

const sampleHtml = `
<!DOCTYPE html>
<html>
<head><title>Product Overview</title></head>
<body>
<h1>Product Overview</h1>
<p>Our product helps teams collaborate more effectively.</p>

<h2>Features</h2>
<ul>
  <li>Real-time collaboration</li>
  <li>Version history</li>
  <li>Access controls</li>
</ul>

<h2>Pricing</h2>
<p>Starting at $99/month for teams.</p>

<script>
  // This should be removed
  console.log('tracking');
</script>
</body>
</html>
`;

const samplePdf = `%PDF-1.4
Service Agreement

by Legal Team

1. Terms

The service provider agrees to deliver the following services
according to the schedule defined in Appendix A.

--- PAGE BREAK ---

2. Conditions

Payment shall be made within 30 days of invoice receipt.
The total contract value is $50,000.

--- PAGE BREAK ---

3. Signatures

Both parties agree to the terms above.

%%EOF`;

const sampleImage = `<!-- OCR TEXT:
INVOICE #12345

Date: March 15, 2024
Due: April 15, 2024

Customer: Acme Corporation
Address: 123 Main Street

Items:
- Consulting services: $5,000
- Software license: $2,500
- Support package: $1,000

Total: $8,500

Thank you for your business!
-->`;

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
// Step 1 - Format detection
// ---------------------------------------------------------------------

console.log('\nStep 1 - format detection');

check(
  'detects plaintext format',
  detectFormat('Hello world', 'doc.txt'),
  (v) => v === 'plaintext',
  'plaintext'
);

check(
  'detects HTML format by extension',
  detectFormat('some content', 'page.html'),
  (v) => v === 'html',
  'html'
);

check(
  'detects PDF format by content',
  detectFormat('%PDF-1.4 content', 'unknown.dat'),
  (v) => v === 'pdf',
  'pdf'
);

check(
  'detects image format',
  detectFormat('binary data', 'scan.png'),
  (v) => v === 'image',
  'image'
);

// ---------------------------------------------------------------------
// Step 2 - Text extraction from different formats
// ---------------------------------------------------------------------

console.log('\nStep 2 - text extraction');

const plaintextResult = extractText(sampleTxt, 'report.txt', 'src1');
check(
  'plaintext extraction succeeds',
  plaintextResult.success,
  (v) => v === true,
  'true'
);

check(
  'plaintext has high confidence',
  plaintextResult.averageConfidence,
  (v) => v === 'high',
  'high'
);

const htmlResult = extractText(sampleHtml, 'product.html', 'src2');
check(
  'HTML extraction removes script tags',
  htmlResult.pages[0].text.includes('tracking'),
  (v) => v === false,
  'false (script content stripped)'
);

check(
  'HTML extraction preserves content',
  htmlResult.pages[0].text.includes('Real-time collaboration'),
  (v) => v === true,
  'true'
);

const pdfResult = extractText(samplePdf, 'contract.pdf', 'src3');
check(
  'PDF extraction handles multiple pages',
  pdfResult.pages.length,
  (v) => v >= 2,
  '>= 2 pages'
);

// ---------------------------------------------------------------------
// Step 3 - OCR processing
// ---------------------------------------------------------------------

console.log('\nStep 3 - OCR processing');

const ocrPage = processOcr(sampleImage, 'medium');
check(
  'OCR extracts text from image',
  ocrPage.text.includes('INVOICE'),
  (v) => v === true,
  'true'
);

check(
  'OCR produces bounding boxes',
  ocrPage.boundingBoxes && ocrPage.boundingBoxes.length > 0,
  (v) => v === true,
  'true'
);

check(
  'OCR confidence is reported',
  ['high', 'medium', 'low'].includes(ocrPage.confidence),
  (v) => v === true,
  'true'
);

// Test OCR noise simulation
const cleanText = 'The quick brown fox jumps over the lazy dog';
const noisyLow = simulateOcrNoise(cleanText, 'low');
const noisyHigh = simulateOcrNoise(cleanText, 'high');

// Low quality should have more errors than high quality
const cerLow = calculateCer(noisyLow, cleanText);
const cerHigh = calculateCer(noisyHigh, cleanText);

check(
  'low quality OCR has higher error rate',
  cerLow >= cerHigh,
  (v) => v === true,
  'true (low quality >= high quality error rate)'
);

// ---------------------------------------------------------------------
// Step 4 - Metadata extraction
// ---------------------------------------------------------------------

console.log('\nStep 4 - metadata extraction');

const title = detectTitle(sampleTxt);
check(
  'title detected from document',
  title,
  (v) => v === 'Quarterly Financial Report',
  'Quarterly Financial Report'
);

const language = detectLanguage(sampleTxt);
check(
  'language detected as English',
  language,
  (v) => v === 'en',
  'en'
);

const sections = extractSections(sampleTxt);
check(
  'sections extracted from document',
  sections.length,
  (v) => v >= 4,
  '>= 4 sections (Executive Summary, Revenue, Expenses, Outlook)'
);

const sectionTitles = sections.map(s => s.title);
check(
  'Executive Summary section found',
  sectionTitles.some(t => t && t.includes('Executive Summary')),
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 5 - Normalization
// ---------------------------------------------------------------------

console.log('\nStep 5 - normalization');

const messyText = '  Multiple   spaces\n\n\n\nToo many   newlines  ';
const normalized = normalizeWhitespace(messyText, false);

check(
  'whitespace normalization collapses spaces',
  normalized.includes('  '),
  (v) => v === false,
  'false (no double spaces)'
);

check(
  'whitespace normalization limits newlines',
  normalized.includes('\n\n\n'),
  (v) => v === false,
  'false (max two consecutive newlines)'
);

// Test page merging
const pagesToMerge = ['First page content.', 'Second page content.'];
const merged = mergePages(pagesToMerge, false);

check(
  'page merge combines content',
  merged.includes('First page') && merged.includes('Second page'),
  (v) => v === true,
  'true (both pages present in merged output)'
);

// ---------------------------------------------------------------------
// Step 6 - Full pipeline
// ---------------------------------------------------------------------

console.log('\nStep 6 - full pipeline');

const pipeline = createPipeline();

const txtResult = pipeline.ingest(sampleTxt, 'report.txt');
check(
  'pipeline ingests plaintext successfully',
  txtResult.success,
  (v) => v === true,
  'true'
);

check(
  'pipeline generates document ID',
  txtResult.documentId !== null && txtResult.documentId.startsWith('doc_'),
  (v) => v === true,
  'true (ID starts with doc_)'
);

check(
  'pipeline preserves metadata',
  txtResult.normalized?.metadata.title,
  (v) => v === 'Quarterly Financial Report',
  'Quarterly Financial Report'
);

const htmlPipeResult = pipeline.ingest(sampleHtml, 'product.html');
check(
  'pipeline ingests HTML successfully',
  htmlPipeResult.success,
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 7 - Error handling
// ---------------------------------------------------------------------

console.log('\nStep 7 - error handling');

const emptyResult = pipeline.ingest('', 'empty.txt');
check(
  'empty document fails gracefully',
  emptyResult.success,
  (v) => v === false,
  'false (empty documents rejected)'
);

check(
  'empty document has error message',
  emptyResult.error !== undefined && emptyResult.error.length > 0,
  (v) => v === true,
  'true'
);

// Size limit check
const canIngestResult = canIngest('x'.repeat(100), 'small.txt', { maxSizeBytes: 50 });
check(
  'size limit enforced',
  canIngestResult.canIngest,
  (v) => v === false,
  'false (document exceeds size limit)'
);

// ---------------------------------------------------------------------
// Step 8 - Batch processing
// ---------------------------------------------------------------------

console.log('\nStep 8 - batch processing');

const batchDocs = [
  { content: sampleTxt, filename: 'doc1.txt' },
  { content: sampleHtml, filename: 'doc2.html' },
  { content: '', filename: 'doc3.txt' }, // Should fail
];

const batchResult = pipeline.ingestBatch(batchDocs);

check(
  'batch reports correct total',
  batchResult.total,
  (v) => v === 3,
  '3'
);

check(
  'batch reports correct success count',
  batchResult.succeeded,
  (v) => v === 2,
  '2 (one empty document fails)'
);

check(
  'batch reports correct failure count',
  batchResult.failed,
  (v) => v === 1,
  '1'
);

// ---------------------------------------------------------------------
// Step 9 - Pipeline metrics
// ---------------------------------------------------------------------

console.log('\nStep 9 - pipeline metrics');

const metrics = getPipelineMetrics(batchResult.results);

check(
  'metrics calculates success rate',
  metrics.successRate,
  (v) => Math.abs(v - 2/3) < 0.01,
  '~0.67 (2 of 3 succeeded)'
);

check(
  'metrics tracks input bytes',
  metrics.totalInputBytes,
  (v) => v > 0,
  '> 0'
);

check(
  'metrics tracks output chars',
  metrics.totalOutputChars,
  (v) => v > 0,
  '> 0'
);

// ---------------------------------------------------------------------
// Step 10 - OCR integration in pipeline
// ---------------------------------------------------------------------

console.log('\nStep 10 - OCR integration');

const imageResult = pipeline.ingest(sampleImage, 'invoice.png');

check(
  'image document processed via OCR',
  imageResult.success,
  (v) => v === true,
  'true'
);

check(
  'OCR output is normalized',
  imageResult.normalized?.text.includes('INVOICE'),
  (v) => v === true,
  'true'
);

// OCR produces lower confidence than native text
check(
  'OCR has appropriate confidence',
  imageResult.normalized?.metadata.extractionConfidence,
  (v) => v === 'medium' || v === 'low',
  'medium or low (OCR is never high confidence)'
);

// ---------------------------------------------------------------------
// Step 11 - Section boundaries preserved
// ---------------------------------------------------------------------

console.log('\nStep 11 - section boundaries');

const docWithSections = txtResult.normalized;

check(
  'sections have valid offsets',
  docWithSections?.sections.every(s => s.startOffset >= 0 && s.endOffset > s.startOffset),
  (v) => v === true,
  'true'
);

check(
  'sections have hierarchy levels',
  docWithSections?.sections.every(s => s.level >= 1 && s.level <= 6),
  (v) => v === true,
  'true'
);

// ---------------------------------------------------------------------
// Step 12 - Statistics accurate
// ---------------------------------------------------------------------

console.log('\nStep 12 - statistics accuracy');

check(
  'word count is reasonable',
  txtResult.normalized?.metadata.wordCount,
  (v) => v !== undefined && v > 100 && v < 500,
  'between 100 and 500 words'
);

check(
  'page count is accurate',
  txtResult.normalized?.metadata.pageCount,
  (v) => v === 1,
  '1 (plaintext is single page)'
);

check(
  'PDF page count is accurate',
  pdfResult.pages.length,
  (v) => v === 3,
  '3 (PDF has three pages)'
);

// ---------------------------------------------------------------------
// Step 13 - The assertion that catches content loss
// ---------------------------------------------------------------------

console.log('\nStep 13 - content preservation assertion');

// This is the critical assertion: normalization should not lose significant content
const originalWordCount = sampleTxt.split(/\s+/).filter(w => w.length > 0).length;
const normalizedWordCount = txtResult.normalized?.metadata.wordCount || 0;

// Allow up to 10% loss for header/footer removal, etc.
const contentRetention = normalizedWordCount / originalWordCount;

check(
  'content retention >= 90%',
  contentRetention,
  (v) => v >= 0.9,
  '>= 0.9 (at least 90% of words preserved)'
);

// And the inverse: we should not be adding content
check(
  'no content added during normalization',
  contentRetention <= 1.1,
  (v) => v === true,
  'true (word count should not increase significantly)'
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
