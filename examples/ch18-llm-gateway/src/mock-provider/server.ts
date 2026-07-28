// A deterministic mock provider that speaks SSE and accepts fault
// injection. No API key, no spend, no rate limits. Everything in the
// Chapter 18 lab is reproducible against this.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface Fault {
  latencyMs: number;
  errorRate: number;
  stallAfterChunk: number; // -1 disables; simulates truncation
}

const fault: Fault = { latencyMs: 0, errorRate: 0, stallAfterChunk: -1 };

let requestCount = 0;

const WORDS = [
  'A', 'gateway', 'is', 'the', 'only', 'place', 'in', 'your',
  'architecture', 'where', 'model', 'traffic', 'is', 'legible', 'and',
  'building', 'it', 'late', 'costs', 'more', 'than', 'building', 'it',
  'wrong', 'which', 'is', 'the', 'entire', 'argument', 'of', 'this',
  'chapter', 'restated', 'as', 'tokens', 'for', 'the', 'load',
  'generator', 'to', 'consume',
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  requestCount += 1;
  const body = JSON.parse((await readBody(req)) || '{}');
  const maxTokens: number = body.max_tokens ?? 40;

  if (Math.random() < fault.errorRate) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'overloaded' }));
    return;
  }

  // A brownout is latency before the first token, not an error.
  if (fault.latencyMs > 0) await sleep(fault.latencyMs);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const count = Math.min(maxTokens, WORDS.length);
  let sent = 0;

  for (let i = 0; i < count; i += 1) {
    if (res.destroyed) return; // consumer hung up
    if (fault.stallAfterChunk >= 0 && i >= fault.stallAfterChunk) {
      res.destroy(); // truncation with no error and no terminal frame
      return;
    }
    res.write(
      `data: ${JSON.stringify({ type: 'delta', text: WORDS[i] + ' ' })}\n\n`,
    );
    sent += 1;
    await sleep(8);
  }

  // Authoritative usage arrives in a trailing frame, and only on a
  // clean finish. This is why the gateway cannot depend on it.
  res.write(
    `data: ${JSON.stringify({
      type: 'usage',
      input_tokens: body.input_tokens ?? 12,
      output_tokens: sent,
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'POST' && url === '/v1/stream') {
    handleStream(req, res).catch(() => res.destroy());
    return;
  }

  if (req.method === 'POST' && url === '/fault') {
    readBody(req).then((b) => {
      Object.assign(fault, JSON.parse(b || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(fault));
    });
    return;
  }

  if (url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestCount, fault }));
    return;
  }

  if (url === '/reset') {
    requestCount = 0;
    Object.assign(fault, { latencyMs: 0, errorRate: 0, stallAfterChunk: -1 });
    res.writeHead(200).end('{}');
    return;
  }

  res.writeHead(404).end();
});

server.listen(8081, () => {
  console.log('mock provider on http://localhost:8081');
});
