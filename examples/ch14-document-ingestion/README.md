# Chapter 14 - Document Ingestion and OCR

Demonstrates document ingestion pipelines for retrieval systems:
text extraction from multiple formats, OCR simulation, metadata
preservation, and format normalization.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Document ingestion is where retrieval quality begins. A document with
corrupted text, lost metadata, or mangled structure produces chunks
that cannot be retrieved correctly. The pipeline must:

1. **Extract text accurately** - different formats need different parsers
2. **Handle OCR gracefully** - scanned documents have lower confidence
3. **Preserve metadata** - source, page numbers, sections matter downstream
4. **Normalize consistently** - same logical content should produce same output

## Layout

```
src/
  types.ts        Core types: ExtractionResult, NormalizedDocument
  extractor.ts    Text extraction from PDF, HTML, plaintext, images
  ocr.ts          OCR simulation with confidence and bounding boxes
  metadata.ts     Title, author, section, language detection
  normalizer.ts   Whitespace, Unicode, format normalization
  pipeline.ts     Orchestrates the full ingestion flow
fixtures/
  sample.txt      Test document (financial report)
  metadata.json   Expected extraction results
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Format detection from content and extension |
| 2 | Text extraction from plaintext, HTML, PDF |
| 3 | OCR processing with confidence scores |
| 4 | Metadata extraction (title, language, sections) |
| 5 | Whitespace and Unicode normalization |
| 6 | Full pipeline orchestration |
| 7 | Graceful error handling |
| 8 | Batch processing with mixed results |
| 9 | Pipeline metrics for monitoring |
| 10 | OCR integration in pipeline |
| 11 | Section boundary preservation |
| 12 | Statistics accuracy |
| 13 | Content preservation assertion |

## Format handling

| Format | Extraction method | Confidence |
| --- | --- | --- |
| plaintext | Direct read | high |
| HTML | Tag stripping, entity decode | high |
| PDF | Page-aware extraction | high |
| image | OCR simulation | medium/low |

## The content preservation assertion

Step 13 asserts that normalization preserves at least 90% of the
original content. This catches bugs where extraction or normalization
accidentally drops text. Without this assertion, silent content loss
would propagate to retrieval, where it becomes a mysterious recall
problem.

## Things worth breaking on purpose

- Set `minConfidence: 'high'` and try to ingest an image document.
  It will fail because OCR cannot guarantee high confidence.

- Remove the section detection and observe that the chapter's
  structural chunking (ch15) produces worse results.

- Inject corrupted Unicode (e.g., surrogate pairs) and verify the
  normalizer handles it without crashing.
