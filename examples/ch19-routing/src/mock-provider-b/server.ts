// Provider B - Secondary provider with 3% nested-field regression.
// 97% of responses are correct, but 3% flatten effective_date to root level.
// This is the silent quality regression that dashboards miss.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface Fault {
  healthy: boolean;
  latencyMs: number;
  errorRate: number;
}

const fault: Fault = { healthy: true, latencyMs: 0, errorRate: 0 };
let requestCount = 0;

// The regression rate - 3% of responses have wrong structure
const REGRESSION_RATE = 0.03;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

async function handleExtract(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  requestCount += 1;
  const body = JSON.parse((await readBody(req)) || '{}');

  // Check if we're in unhealthy state
  if (!fault.healthy) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'service_unavailable' }));
    return;
  }

  // Random errors based on errorRate
  if (Math.random() < fault.errorRate) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'overloaded' }));
    return;
  }

  // Simulate latency
  if (fault.latencyMs > 0) await sleep(fault.latencyMs);

  // 3% regression: effective_date at wrong level
  const hasRegression = Math.random() < REGRESSION_RATE;

  let response;
  if (hasRegression) {
    // Wrong structure: effective_date is at root level, not inside coverage
    response = {
      requestId: body.requestId ?? 'unknown',
      target: 'provider-b',
      policy_id: 'P' + Math.floor(Math.random() * 1000),
      effective_date: '2024-01-15', // WRONG: should be inside coverage
      coverage: {
        amount: 500000,
        // effective_date missing here
      },
    };
  } else {
    // Correct structure
    response = {
      requestId: body.requestId ?? 'unknown',
      target: 'provider-b',
      policy_id: 'P' + Math.floor(Math.random() * 1000),
      coverage: {
        effective_date: '2024-01-15',
        amount: 500000,
      },
    };
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response));
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'POST' && url === '/v1/extract') {
    handleExtract(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
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

  if (url === '/health') {
    if (fault.healthy) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
    } else {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy' }));
    }
    return;
  }

  if (url === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestCount, fault, regressionRate: REGRESSION_RATE }));
    return;
  }

  if (url === '/reset') {
    requestCount = 0;
    Object.assign(fault, { healthy: true, latencyMs: 0, errorRate: 0 });
    res.writeHead(200).end('{}');
    return;
  }

  res.writeHead(404).end();
});

server.listen(8092, () => {
  console.log('provider-b on http://localhost:8092');
});
