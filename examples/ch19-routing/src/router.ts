// Multi-provider router from Chapter 19.
// Selects targets based on: eligibility, health, stickiness, ranking.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  ExtractionRequest,
  ExtractionResponse,
  TargetConfig,
  HealthState,
  LedgerRecord,
} from './types.ts';
import { metrics } from './metrics.ts';
import { ledger } from './ledger.ts';

// Target configurations
const targets: TargetConfig[] = [
  {
    name: 'provider-a',
    url: 'http://localhost:8091',
    eligibility: {
      residency: ['us', 'eu'],
      tier: ['standard', 'premium'],
    },
    cost: 1.0,
    latencyMs: 50,
  },
  {
    name: 'provider-b',
    url: 'http://localhost:8092',
    eligibility: {
      residency: ['us', 'eu'],
      tier: ['standard', 'premium'],
    },
    cost: 0.8, // cheaper
    latencyMs: 60,
  },
];

// Health state per target
const healthStates = new Map<string, HealthState>();
for (const t of targets) {
  healthStates.set(t.name, { healthy: true, lastCheck: 0, consecutiveFailures: 0 });
}

// Stickiness: conversation -> target mapping
const stickinessMap = new Map<string, string>();

// Configuration
const config = {
  healthCheckIntervalMs: 5000,
  maxConsecutiveFailures: 3,
  stickinessEnabled: true,
};

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

// Stage 1: Eligibility filter (hard constraint)
function filterByEligibility(
  candidates: TargetConfig[],
  residency: 'us' | 'eu',
  tier: 'standard' | 'premium',
): TargetConfig[] {
  return candidates.filter(
    (t) =>
      t.eligibility.residency.includes(residency) &&
      t.eligibility.tier.includes(tier),
  );
}

// Stage 2: Health gating (hard constraint)
function filterByHealth(candidates: TargetConfig[]): TargetConfig[] {
  return candidates.filter((t) => {
    const state = healthStates.get(t.name);
    return state?.healthy ?? false;
  });
}

// Stage 3: Stickiness (override)
function applyStickiness(
  candidates: TargetConfig[],
  conversationId: string,
): TargetConfig | null {
  if (!config.stickinessEnabled) return null;

  const stickyTarget = stickinessMap.get(conversationId);
  if (!stickyTarget) return null;

  const target = candidates.find((t) => t.name === stickyTarget);
  return target ?? null;
}

// Stage 4: Ranking (soft preference) - by cost then latency
function rankTargets(candidates: TargetConfig[]): TargetConfig[] {
  return [...candidates].sort((a, b) => {
    // Lower cost first
    if (a.cost !== b.cost) return a.cost - b.cost;
    // Then lower latency
    return a.latencyMs - b.latencyMs;
  });
}

// Select target using all stages
function selectTarget(
  residency: 'us' | 'eu',
  tier: 'standard' | 'premium',
  conversationId: string,
): TargetConfig | null {
  // Stage 1: Eligibility
  let candidates = filterByEligibility(targets, residency, tier);
  if (candidates.length === 0) {
    metrics.inc('rejected_eligibility');
    return null;
  }

  // Stage 2: Health
  candidates = filterByHealth(candidates);
  if (candidates.length === 0) {
    metrics.inc('rejected_health');
    return null;
  }

  // Stage 3: Stickiness
  const stickyTarget = applyStickiness(candidates, conversationId);
  if (stickyTarget) {
    metrics.inc('sticky_hit');
    return stickyTarget;
  }

  // Stage 4: Ranking
  const ranked = rankTargets(candidates);
  const selected = ranked[0];

  // Record stickiness for future requests
  if (config.stickinessEnabled) {
    stickinessMap.set(conversationId, selected.name);
  }

  return selected;
}

// Check if response has correct schema structure
function validateSchema(response: ExtractionResponse): boolean {
  // Must have policy_id and coverage object
  if (!response.policy_id || typeof response.coverage !== 'object') {
    return false;
  }
  // coverage must have amount
  if (typeof response.coverage.amount !== 'number') {
    return false;
  }
  return true;
}

// Check if effective_date is in the correct location (inside coverage)
function isEffectiveDateInCoverage(response: ExtractionResponse): boolean {
  return (
    typeof response.coverage === 'object' &&
    typeof response.coverage.effective_date === 'string'
  );
}

async function handleExtraction(
  httpReq: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  metrics.inc('router_requests');

  const raw = JSON.parse((await readBody(httpReq)) || '{}');

  const req: ExtractionRequest = {
    requestId: String(raw.requestId ?? `req-${Date.now()}`),
    conversationId: String(raw.conversationId ?? `conv-${Date.now()}`),
    tenant: String(raw.tenant ?? 'unknown'),
    residency: raw.residency ?? 'us',
    tier: raw.tier ?? 'standard',
    payload: raw.payload ?? { documentType: 'policy', content: 'sample' },
  };

  const target = selectTarget(req.residency, req.tier, req.conversationId);

  if (!target) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no_available_target' }));
    return;
  }

  metrics.inc(`requests_to_${target.name}`);

  const started = performance.now();
  let success = false;
  let schemaValid = false;
  let effectiveDateInCoverage = false;

  try {
    const upstream = await fetch(`${target.url}/v1/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });

    if (!upstream.ok) {
      // Mark target as potentially unhealthy
      const state = healthStates.get(target.name);
      if (state) {
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
          state.healthy = false;
        }
      }

      metrics.inc('upstream_errors');
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream_error' }));
      return;
    }

    // Reset consecutive failures on success
    const state = healthStates.get(target.name);
    if (state) {
      state.consecutiveFailures = 0;
      state.healthy = true;
    }

    const response = (await upstream.json()) as ExtractionResponse;
    success = true;
    schemaValid = validateSchema(response);
    effectiveDateInCoverage = isEffectiveDateInCoverage(response);

    // Record field population metric
    metrics.recordFieldPopulation(target.name, effectiveDateInCoverage);

    if (schemaValid) {
      metrics.inc('schema_valid');
    } else {
      metrics.inc('schema_invalid');
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (err) {
    // Network error - mark unhealthy
    const state = healthStates.get(target.name);
    if (state) {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
        state.healthy = false;
      }
    }

    metrics.inc('network_errors');
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'network_error' }));
  } finally {
    const durationMs = performance.now() - started;

    // Always write to ledger with target label
    const record: LedgerRecord = {
      at: Date.now(),
      requestId: req.requestId,
      conversationId: req.conversationId,
      tenant: req.tenant,
      target: target.name,
      durationMs,
      success,
      schemaValid,
      fieldPopulation: {
        effective_date_in_coverage: effectiveDateInCoverage,
      },
    };
    ledger.write(record);
  }
}

// Health check background task
async function checkTargetHealth(target: TargetConfig): Promise<void> {
  const state = healthStates.get(target.name);
  if (!state) return;

  try {
    const res = await fetch(`${target.url}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    state.healthy = res.ok;
    state.lastCheck = Date.now();
    if (res.ok) {
      state.consecutiveFailures = 0;
    }
  } catch {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
      state.healthy = false;
    }
    state.lastCheck = Date.now();
  }
}

// Periodic health checks
setInterval(() => {
  for (const target of targets) {
    checkTargetHealth(target);
  }
}, config.healthCheckIntervalMs);

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (req.method === 'POST' && url === '/v1/extract') {
    handleExtraction(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }

  if (req.method === 'POST' && url === '/admin/config') {
    readBody(req).then((b) => {
      const cfg = JSON.parse(b || '{}');
      if (cfg.stickinessEnabled !== undefined) {
        config.stickinessEnabled = cfg.stickinessEnabled;
      }
      if (cfg.enablePerTargetTracking) {
        metrics.enablePerTargetTracking();
      }
      if (cfg.disablePerTargetTracking) {
        metrics.disablePerTargetTracking();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ...config,
        perTargetTrackingEnabled: metrics.isPerTargetTrackingEnabled(),
      }));
    });
    return;
  }

  // Inject fault to a specific target's health state
  if (req.method === 'POST' && url === '/admin/health') {
    readBody(req).then((b) => {
      const cfg = JSON.parse(b || '{}');
      const targetName = cfg.target;
      const healthy = cfg.healthy ?? true;

      const state = healthStates.get(targetName);
      if (state) {
        state.healthy = healthy;
        state.consecutiveFailures = healthy ? 0 : config.maxConsecutiveFailures;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ target: targetName, healthy }));
    });
    return;
  }

  if (url === '/metrics') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(metrics.snapshot(), null, 2));
    return;
  }

  if (url === '/ledger') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ledger.report(), null, 2));
    return;
  }

  if (url === '/ledger/query') {
    // Demonstrates the target label query capability
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      withTargetLabel: ledger.countRecordsWithoutTargetQuery(),
      note: 'With target label: one query. Without: timestamp archaeology.',
    }, null, 2));
    return;
  }

  if (url === '/health') {
    const healthReport: Record<string, unknown> = {};
    for (const [name, state] of healthStates) {
      healthReport[name] = state;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(healthReport, null, 2));
    return;
  }

  if (url === '/reset') {
    metrics.reset();
    ledger.reset();
    stickinessMap.clear();
    for (const [, state] of healthStates) {
      state.healthy = true;
      state.consecutiveFailures = 0;
    }
    res.writeHead(200).end('{}');
    return;
  }

  res.writeHead(404).end();
});

server.listen(8090, () => {
  console.log('router on http://localhost:8090');
});
