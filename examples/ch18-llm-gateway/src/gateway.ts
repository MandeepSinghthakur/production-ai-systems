// The nine stages from Chapter 18, "Internal Architecture", in order.
// Everything cheap enough to reject a request runs before the router.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { CanonicalRequest, StopReason, Usage } from './types.ts';
import { mockAdapter } from './adapter/mock.ts';
import { streamCompletion } from './adapter/stream.ts';
import { LatencyBreaker } from './router/breaker.ts';
import { metrics } from './metrics.ts';
import { ledger } from './ledger.ts';
import { budget } from './budget.ts';

const ALLOWED_MODELS = new Set(['frontier', 'mid', 'small']);
const MAX_OUTPUT_TOKENS = 200;

const config = {
  // Compressed for the lab. Production values are 5-10x these.
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS ?? 4000),
  maxAttempts: Number(process.env.MAX_ATTEMPTS ?? 3),
  retryBudgetRatio: 0.1,
};

const breaker = new LatencyBreaker();

// Retry budget as a percentage of traffic, not a count per request.
// A count cannot bound total load; a percentage can.
let retryTokens = 0;

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

function sse(res: ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function handleCompletion(
  httpReq: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  metrics.inc('gateway_requests');
  retryTokens = Math.min(retryTokens + config.retryBudgetRatio, 100);

  const raw = JSON.parse((await readBody(httpReq)) || '{}');

  // Stage 1 - ingress. Tenant is who pays; workload is which feature.
  // You need both: billing rolls up by tenant, incident response needs
  // workload granularity.
  const req: CanonicalRequest = {
    schemaVersion: 1,
    tenant: String(raw.tenant ?? 'unknown'),
    workload: String(raw.workload ?? 'unknown'),
    model: String(raw.model ?? 'mid'),
    messages: raw.messages ?? [{ role: 'user', content: 'hello' }],
    maxTokens: Math.min(Number(raw.maxTokens ?? 40), MAX_OUTPUT_TOKENS),
    countedInputTokens: Number(raw.countedInputTokens ?? 12),
  };

  // Stage 2 - policy. Deterministic, cheap, rejects before spend.
  if (!ALLOWED_MODELS.has(req.model)) {
    metrics.inc('rejected_policy');
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'model_not_allowed' }));
    return;
  }

  // Stage 3 - budget. Reserve pessimistically: counted input plus the
  // output ceiling. Reconciled against actuals in the finally below.
  const estimate = req.countedInputTokens + req.maxTokens;
  const reserved = budget.reserve(req.tenant, estimate);
  if (reserved === null) {
    metrics.inc('rejected_budget');
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'budget_exhausted' }));
    return;
  }
  metrics.gauge('budget_headroom', budget.headroom(req.tenant));

  // Stage 5 - routing. Chapter 19 makes this interesting; here it is
  // one provider behind a latency-aware breaker.
  if (!breaker.allow()) {
    metrics.inc('rejected_breaker');
    budget.settle(req.tenant, reserved, 0);
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'provider_unavailable' }));
    return;
  }

  const clientGone = new AbortController();
  res.on('close', () => clientGone.abort());

  // Every attempt costs money, so usage accumulates across retries.
  // This is what makes the price of a retry storm visible in the ledger.
  const total: Usage = { inputTokens: 0, outputTokens: 0, estimated: false };
  const accumulate = (u: Usage): void => {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    if (u.estimated) total.estimated = true;
  };

  let stop: StopReason = 'error';
  let headersSent = false;
  let attempt = 0;

  try {
    while (true) {
      attempt += 1;
      metrics.inc('provider_requests');

      const attemptCtl = new AbortController();
      const onClientGone = (): void => attemptCtl.abort();
      clientGone.signal.addEventListener('abort', onClientGone);

      // Time to FIRST BYTE, not total duration. A generation that is
      // streaming steadily is healthy no matter how long it runs.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        attemptCtl.abort();
      }, config.upstreamTimeoutMs);

      const started = performance.now();
      let sawFirstByte = false;

      try {
        const stream = streamCompletion(
          req,
          mockAdapter,
          attemptCtl.signal,
          accumulate,
        );

        for await (const chunk of stream) {
          if (!sawFirstByte && chunk.kind === 'text') {
            sawFirstByte = true;
            clearTimeout(timer);
            breaker.record(performance.now() - started, false);
          }
          if (!headersSent) {
            headersSent = true;
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
            });
          }
          sse(res, chunk);
          if (chunk.kind === 'terminal') {
            stop = chunk.stop;
            if (chunk.stop !== 'complete') metrics.inc('stream_interrupted');
          }
        }

        if (!sawFirstByte) breaker.record(performance.now() - started, true);
        metrics.inc('completed');
        if (stop === 'error') metrics.inc('failed');
        return;
      } catch (err) {
        clearTimeout(timer);
        breaker.record(performance.now() - started, true);

        if (clientGone.signal.aborted) {
          stop = 'aborted';
          metrics.inc('client_aborted');
          return;
        }

        // The retry boundary, in one condition. Nothing has been
        // observed by the consumer, so another attempt is transparent.
        // After first byte this branch is unreachable - streamCompletion
        // yields a terminal error event instead of throwing.
        const e = err as { retryable?: boolean };
        const retryable = timedOut || e.retryable === true;

        if (retryable && attempt < config.maxAttempts && retryTokens >= 1) {
          retryTokens -= 1;
          metrics.inc('retries');
          // Full jitter. Fixed backoff synchronizes clients into a herd.
          await new Promise((r) => setTimeout(r, Math.random() * 200 * attempt));
          continue;
        }

        metrics.inc('failed');
        if (timedOut) metrics.inc('upstream_timeout');
        stop = 'error';
        if (!headersSent) {
          res.writeHead(504, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream_timeout' }));
        }
        return;
      } finally {
        clearTimeout(timer);
        clientGone.signal.removeEventListener('abort', onClientGone);
      }
    }
  } finally {
    // One ledger row per user request, summed over every attempt it
    // took. Written from a finally so a client hang-up still bills.
    budget.settle(
      req.tenant,
      reserved,
      total.inputTokens + total.outputTokens,
    );
    ledger.write({
      at: Date.now(),
      tenant: req.tenant,
      workload: req.workload,
      provider: mockAdapter.name,
      model: req.model,
      stop,
      usage: total,
    });
    metrics.gauge('budget_headroom', budget.headroom(req.tenant));
    if (!res.writableEnded) res.end();
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'POST' && url === '/v1/completions') {
    handleCompletion(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }

  if (req.method === 'POST' && url === '/admin/config') {
    readBody(req).then((b) => {
      const cfg = JSON.parse(b || '{}');
      if (cfg.breaker) {
        if (cfg.breaker.enabled !== undefined) {
          breaker.enabled = cfg.breaker.enabled;
          if (!cfg.breaker.enabled) breaker.reset();
        }
        breaker.configure(cfg.breaker);
      }
      if (cfg.upstreamTimeoutMs) config.upstreamTimeoutMs = cfg.upstreamTimeoutMs;
      if (cfg.maxAttempts !== undefined) config.maxAttempts = cfg.maxAttempts;
      if (cfg.retryBudgetRatio !== undefined) {
        config.retryBudgetRatio = cfg.retryBudgetRatio;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...config, breaker: breaker.enabled }));
    });
    return;
  }

  if (url === '/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ ...metrics.snapshot(), breaker: breaker.state }, null, 2),
    );
    return;
  }

  if (url === '/ledger') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ledger.report(), null, 2));
    return;
  }

  if (url === '/reset') {
    metrics.reset();
    ledger.reset();
    breaker.reset();
    retryTokens = 0;
    res.writeHead(200).end('{}');
    return;
  }

  res.writeHead(404).end();
});

budget.seed('acme', 1_000_000, false); // internal tenant: soft cap
budget.seed('externalco', 2_000, true); // external tenant: hard cap

server.listen(8080, () => {
  console.log('gateway on http://localhost:8080');
});
