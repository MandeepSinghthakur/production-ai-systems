// Reproduces every numbered step of the Chapter 9 lab and checks the
// claims the chapter makes. If this script fails, the chapter is wrong.
//
//   node scripts/lab.mjs          (from examples/ch09-observability)
//   node examples/ch09-observability/scripts/lab.mjs   (from repo root)
//
// No external services required — everything runs in-process.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Resolve paths relative to this script, not cwd. This allows the lab
// to run from either the example directory or the repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Dynamic imports with resolved paths
const { Tracer, parseTraceparent, formatTraceparent, withSpan } = await import(
  resolve(srcDir, 'tracing.ts')
);
const { Counter, Gauge, Histogram, MetricsRegistry } = await import(
  resolve(srcDir, 'metrics.ts')
);
const { Logger, withLogging, withLoggingAsync } = await import(
  resolve(srcDir, 'logging.ts')
);
const {
  AlertManager,
  createDefaultAlertRules,
  createTenantAlertRule,
} = await import(resolve(srcDir, 'alerting.ts'));

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
// Step 1 - Distributed tracing: span creation and correlation
// ---------------------------------------------------------------------

console.log('\nStep 1 - distributed tracing: span creation and correlation');

const tracer1 = new Tracer({ serviceName: 'gateway' });

// Start a root span (no parent)
const rootSpan = tracer1.startSpan('handle_request', 'server');

check(
  'root span has no parent',
  rootSpan.parentSpanId,
  (v) => v === null,
  'null (root span)'
);

check(
  'span has valid trace ID',
  rootSpan.traceId.length,
  (v) => v === 32,
  '32 (16-byte hex)'
);

check(
  'span has valid span ID',
  rootSpan.spanId.length,
  (v) => v === 16,
  '16 (8-byte hex)'
);

// Create a child span
const context = tracer1.getContext(rootSpan);
const childSpan = tracer1.startSpan('call_llm', 'client', context);

check(
  'child span shares trace ID',
  childSpan.traceId === rootSpan.traceId,
  (v) => v === true,
  'true (same trace)'
);

check(
  'child span has root as parent',
  childSpan.parentSpanId === rootSpan.spanId,
  (v) => v === true,
  'true (parent-child relationship)'
);

// End spans and check correlation
tracer1.endSpan(childSpan, 'ok');
tracer1.endSpan(rootSpan, 'ok');

const traceSpans = tracer1.getTraceSpans(rootSpan.traceId);
check(
  'both spans recorded in trace',
  traceSpans.length,
  (v) => v === 2,
  '2 (root + child)'
);

check(
  'all spans are correlated',
  traceSpans.every((s) => tracer1.isCorrelated(s, rootSpan.traceId)),
  (v) => v === true,
  'true (all spans share trace ID)'
);

// ---------------------------------------------------------------------
// Step 2 - W3C trace context propagation
// ---------------------------------------------------------------------

console.log('\nStep 2 - W3C trace context propagation');

const tracer2 = new Tracer({ serviceName: 'backend' });

// Simulate receiving a traceparent header from upstream
const incomingHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const parsedContext = parseTraceparent(incomingHeader);

check(
  'traceparent parsed correctly',
  parsedContext !== null,
  (v) => v === true,
  'true (valid header)'
);

check(
  'trace ID extracted',
  parsedContext.traceId,
  (v) => v === '4bf92f3577b34da6a3ce929d0e0e4736',
  '4bf92f3577b34da6a3ce929d0e0e4736'
);

check(
  'parent span ID extracted',
  parsedContext.spanId,
  (v) => v === '00f067aa0ba902b7',
  '00f067aa0ba902b7'
);

// Create a span continuing the trace
const continuedSpan = tracer2.startSpan('process', 'server', parsedContext);

check(
  'continued span uses incoming trace ID',
  continuedSpan.traceId === parsedContext.traceId,
  (v) => v === true,
  'true (trace continues across service)'
);

check(
  'continued span references incoming span as parent',
  continuedSpan.parentSpanId === parsedContext.spanId,
  (v) => v === true,
  'true (parent is upstream span)'
);

// Format for downstream propagation
const outgoingContext = tracer2.getContext(continuedSpan);
const outgoingHeader = formatTraceparent(outgoingContext);

check(
  'traceparent formatted for downstream',
  outgoingHeader.startsWith('00-'),
  (v) => v === true,
  'true (valid W3C format)'
);

tracer2.endSpan(continuedSpan);

// ---------------------------------------------------------------------
// Step 3 - AI-specific metrics with dimensions
// ---------------------------------------------------------------------

console.log('\nStep 3 - AI-specific metrics with dimensions');

const registry = new MetricsRegistry({ serviceName: 'ai-gateway' });

// Record requests from multiple tenants and tiers
const requests = [
  { tenant: 'acme', tier: 'frontier', inputTokens: 500, outputTokens: 1500, latencyMs: 2500, cached: false },
  { tenant: 'acme', tier: 'frontier', inputTokens: 200, outputTokens: 800, latencyMs: 1200, cached: true },
  { tenant: 'acme', tier: 'mid', inputTokens: 100, outputTokens: 400, latencyMs: 800, cached: false },
  { tenant: 'corp', tier: 'mid', inputTokens: 300, outputTokens: 1200, latencyMs: 1500, cached: false },
  { tenant: 'corp', tier: 'small', inputTokens: 50, outputTokens: 150, latencyMs: 200, cached: true },
];

for (const req of requests) {
  registry.recordRequest(req);
}

// Check total requests
const totalRequests = registry.requestsTotal.get({
  tenant: 'acme',
  model: 'frontier',
  operation: 'completion',
  status: 'success',
});

check(
  'requests counted by tenant and model',
  totalRequests,
  (v) => v === 2,
  '2 (acme + frontier requests)'
);

// Check token counts
const acmeInputTokens = registry.inputTokensTotal.get({
  tenant: 'acme',
  model: 'frontier',
  operation: 'completion',
  status: 'success',
});

check(
  'input tokens summed correctly',
  acmeInputTokens,
  (v) => v === 700,
  '700 (500 + 200)'
);

// Check cache metrics
const cacheHits = registry.cacheHitsTotal.get({
  tenant: 'acme',
  model: 'frontier',
  operation: 'completion',
  status: 'success',
});

check(
  'cache hits tracked',
  cacheHits,
  (v) => v === 1,
  '1 (one cached request)'
);

// Check latency histogram
const latencyCount = registry.requestLatency.getCount({
  tenant: 'acme',
  model: 'frontier',
  operation: 'completion',
  status: 'success',
});

check(
  'latency histogram observations counted',
  latencyCount,
  (v) => v === 2,
  '2 (two requests recorded)'
);

// ---------------------------------------------------------------------
// Step 4 - Histogram percentile calculation
// ---------------------------------------------------------------------

console.log('\nStep 4 - histogram percentile calculation');

const histogram = new Histogram(
  'test_latency',
  'Test latency',
  'ms',
  [100, 250, 500, 1000, 2500, 5000]
);

// Add observations with known distribution
const latencies = [50, 100, 150, 200, 300, 400, 500, 800, 1000, 2000, 3000, 5000];
for (const latency of latencies) {
  histogram.observe({}, latency);
}

const p50 = histogram.getPercentile({}, 50);
const p90 = histogram.getPercentile({}, 90);
const p99 = histogram.getPercentile({}, 99);

check(
  'p50 in expected range',
  p50 >= 200 && p50 <= 500,
  (v) => v === true,
  'true (median around 350ms)'
);

check(
  'p90 in expected range',
  p90 >= 2500 && p90 <= 5000,
  (v) => v === true,
  'true (p90 in upper buckets)'
);

check(
  'p99 is highest bucket',
  p99 >= 3000,
  (v) => v === true,
  'true (p99 at tail)'
);

// ---------------------------------------------------------------------
// Step 5 - Structured logging with trace correlation
// ---------------------------------------------------------------------

console.log('\nStep 5 - structured logging with trace correlation');

const logger = new Logger({ serviceName: 'llm-service', minSeverity: 'DEBUG' });
const logTracer = new Tracer({ serviceName: 'llm-service' });

const logSpan = logTracer.startSpan('process_request', 'server');
const logContext = logTracer.getContext(logSpan);

// Set context for log correlation
logger.setContext(logContext);

logger.info('Request received', { tenant: 'acme', request_id: 'req-123' });
logger.debug('Processing prompt', { tokens: 500 });
logger.info('Response generated', { output_tokens: 1200, latency_ms: 1500 });

logTracer.endSpan(logSpan);

const records = logger.getRecords();

check(
  'logs recorded',
  records.length,
  (v) => v === 3,
  '3 (info + debug + info)'
);

check(
  'logs have trace ID',
  records.every((r) => r.traceId === logContext.traceId),
  (v) => v === true,
  'true (all logs correlated to trace)'
);

check(
  'logs have span ID',
  records.every((r) => r.spanId === logContext.spanId),
  (v) => v === true,
  'true (all logs correlated to span)'
);

// Search logs by attribute
const tenantLogs = logger.searchByAttribute('tenant', 'acme');
check(
  'logs searchable by attribute',
  tenantLogs.length,
  (v) => v === 1,
  '1 (one log has tenant attribute)'
);

// Get logs by trace
const traceLogs = logger.getRecordsByTrace(logContext.traceId);
check(
  'logs retrievable by trace ID',
  traceLogs.length,
  (v) => v === 3,
  '3 (all logs for this trace)'
);

// ---------------------------------------------------------------------
// Step 6 - Log severity filtering
// ---------------------------------------------------------------------

console.log('\nStep 6 - log severity filtering');

const filteredLogger = new Logger({ serviceName: 'test', minSeverity: 'WARN' });

filteredLogger.debug('This should be filtered');
filteredLogger.info('This should also be filtered');
filteredLogger.warn('This should appear');
filteredLogger.error('This should also appear');

const filteredRecords = filteredLogger.getRecords();

check(
  'debug and info filtered out',
  filteredRecords.length,
  (v) => v === 2,
  '2 (only WARN and ERROR)'
);

check(
  'first record is WARN',
  filteredRecords[0].severity,
  (v) => v === 'WARN',
  'WARN'
);

check(
  'second record is ERROR',
  filteredRecords[1].severity,
  (v) => v === 'ERROR',
  'ERROR'
);

// Get records by severity
const errorLogs = filteredLogger.getRecordsBySeverity('ERROR');
check(
  'can filter records by minimum severity',
  errorLogs.length,
  (v) => v === 1,
  '1 (only ERROR level)'
);

// ---------------------------------------------------------------------
// Step 7 - Alert rule evaluation
// ---------------------------------------------------------------------

console.log('\nStep 7 - alert rule evaluation');

const alertManager = new AlertManager();

// Add a custom alert rule
alertManager.addRule({
  name: 'high_latency',
  description: 'Request latency too high',
  metric: 'llm_request_duration_ms',
  condition: 'gt',
  threshold: 5000,
  windowMs: 60_000,
  labels: { tenant: 'acme' },
  severity: 'warning',
});

// Create metrics that should trigger the alert
const alertMetrics = [
  {
    name: 'llm_request_duration_ms',
    description: 'Request latency',
    unit: 'ms',
    type: 'histogram',
    dataPoints: [
      { timestampMs: Date.now(), value: 6000, labels: { tenant: 'acme' } },
    ],
  },
];

const firingAlerts = alertManager.evaluate(alertMetrics);

check(
  'alert fires when threshold exceeded',
  firingAlerts.length,
  (v) => v === 1,
  '1 (high latency alert)'
);

check(
  'alert state is firing',
  alertManager.getState('high_latency')?.firing,
  (v) => v === true,
  'true (alert is active)'
);

check(
  'alert message contains metric value',
  alertManager.getState('high_latency')?.message.includes('6000'),
  (v) => v === true,
  'true (message shows actual value)'
);

// Evaluate with value below threshold - should resolve
const resolvedMetrics = [
  {
    name: 'llm_request_duration_ms',
    description: 'Request latency',
    unit: 'ms',
    type: 'histogram',
    dataPoints: [
      { timestampMs: Date.now(), value: 3000, labels: { tenant: 'acme' } },
    ],
  },
];

alertManager.evaluate(resolvedMetrics);

check(
  'alert resolves when under threshold',
  alertManager.getState('high_latency')?.firing,
  (v) => v === false,
  'false (alert resolved)'
);

check(
  'alert history recorded',
  alertManager.getHistory().length,
  (v) => v >= 2,
  '>=2 (firing + resolved)'
);

// ---------------------------------------------------------------------
// Step 8 - Default AI alert rules
// ---------------------------------------------------------------------

console.log('\nStep 8 - default AI alert rules');

const defaultAlertManager = new AlertManager();
const defaultRules = createDefaultAlertRules();

for (const rule of defaultRules) {
  defaultAlertManager.addRule(rule);
}

const registeredRules = defaultAlertManager.getRules();

check(
  'default rules registered',
  registeredRules.length,
  (v) => v >= 5,
  '>=5 (error rate, latency, tokens, cache, cost)'
);

const errorRateRule = registeredRules.find((r) => r.name === 'high_error_rate');
check(
  'error rate rule is critical',
  errorRateRule?.severity,
  (v) => v === 'critical',
  'critical (high priority alert)'
);

const tokenBudgetRule = registeredRules.find(
  (r) => r.name === 'token_budget_exceeded'
);
check(
  'token budget rule exists',
  tokenBudgetRule !== undefined,
  (v) => v === true,
  'true (AI-specific alert)'
);

// ---------------------------------------------------------------------
// Step 9 - Counter and Gauge behavior
// ---------------------------------------------------------------------

console.log('\nStep 9 - counter and gauge behavior');

const counter = new Counter('test_counter', 'Test counter');
const gauge = new Gauge('test_gauge', 'Test gauge');

// Counter can only increase
counter.inc({ type: 'request' }, 5);
counter.inc({ type: 'request' }, 3);

check(
  'counter accumulates',
  counter.get({ type: 'request' }),
  (v) => v === 8,
  '8 (5 + 3)'
);

// Gauge can increase and decrease
gauge.set({ type: 'active' }, 10);
gauge.inc({ type: 'active' }, 5);
gauge.dec({ type: 'active' }, 3);

check(
  'gauge tracks current value',
  gauge.get({ type: 'active' }),
  (v) => v === 12,
  '12 (10 + 5 - 3)'
);

// Test counter export
const counterMetric = counter.export();
check(
  'counter exports as metric',
  counterMetric.type,
  (v) => v === 'counter',
  'counter'
);

check(
  'counter export has data points',
  counterMetric.dataPoints.length,
  (v) => v === 1,
  '1 (one label set)'
);

// ---------------------------------------------------------------------
// Step 10 - Span events and attributes
// ---------------------------------------------------------------------

console.log('\nStep 10 - span events and attributes');

const eventTracer = new Tracer({ serviceName: 'event-test' });
const eventSpan = eventTracer.startSpan('process', 'internal');

// Add attributes
eventTracer.setAttribute(eventSpan, 'tenant', 'acme');
eventTracer.setAttribute(eventSpan, 'tokens', 1500);
eventTracer.setAttribute(eventSpan, 'cached', true);

// Add events
eventTracer.addEvent(eventSpan, 'cache_check', { hit: false });
eventTracer.addEvent(eventSpan, 'llm_call_start', { model: 'frontier' });
eventTracer.addEvent(eventSpan, 'llm_call_end', { tokens: 1500 });

eventTracer.endSpan(eventSpan);

check(
  'span has custom attributes',
  eventSpan.attributes.tenant,
  (v) => v === 'acme',
  'acme'
);

check(
  'span has numeric attribute',
  eventSpan.attributes.tokens,
  (v) => v === 1500,
  '1500'
);

check(
  'span has boolean attribute',
  eventSpan.attributes.cached,
  (v) => v === true,
  'true'
);

check(
  'span has events',
  eventSpan.events.length,
  (v) => v === 3,
  '3 (cache_check, llm_call_start, llm_call_end)'
);

check(
  'events have timestamps',
  eventSpan.events.every((e) => e.timestampMs > 0),
  (v) => v === true,
  'true (all events timestamped)'
);

// ---------------------------------------------------------------------
// Step 11 - Critical path analysis
// ---------------------------------------------------------------------

console.log('\nStep 11 - critical path analysis');

const pathTracer = new Tracer({ serviceName: 'pipeline' });

// Build a trace with multiple paths
// Root -> [child1 -> grandchild1, child2 -> grandchild2 -> great]
const pathRoot = pathTracer.startSpan('root', 'server');
const rootCtx = pathTracer.getContext(pathRoot);

const child1 = pathTracer.startSpan('child1', 'internal', rootCtx);
const child1Ctx = pathTracer.getContext(child1);
const grandchild1 = pathTracer.startSpan('grandchild1', 'internal', child1Ctx);
pathTracer.endSpan(grandchild1);
pathTracer.endSpan(child1);

const child2 = pathTracer.startSpan('child2', 'internal', rootCtx);
const child2Ctx = pathTracer.getContext(child2);
const grandchild2 = pathTracer.startSpan('grandchild2', 'internal', child2Ctx);
const gc2Ctx = pathTracer.getContext(grandchild2);
const great = pathTracer.startSpan('great', 'internal', gc2Ctx);
pathTracer.endSpan(great);
pathTracer.endSpan(grandchild2);
pathTracer.endSpan(child2);

pathTracer.endSpan(pathRoot);

const criticalPath = pathTracer.getCriticalPath(pathRoot.traceId);

check(
  'critical path found',
  criticalPath.length,
  (v) => v === 4,
  '4 (root -> child2 -> grandchild2 -> great)'
);

check(
  'critical path starts at root',
  criticalPath[0].name,
  (v) => v === 'root',
  'root'
);

check(
  'critical path ends at deepest span',
  criticalPath[criticalPath.length - 1].name,
  (v) => v === 'great',
  'great'
);

// ---------------------------------------------------------------------
// Step 12 - withSpan helper for async operations
// ---------------------------------------------------------------------

console.log('\nStep 12 - withSpan helper for async operations');

const asyncTracer = new Tracer({ serviceName: 'async-test' });

// Test successful operation
const successResult = await withSpan(
  asyncTracer,
  'successful_operation',
  async (span) => {
    asyncTracer.setAttribute(span, 'operation', 'test');
    await sleep(10);
    return 'success';
  }
);

const successSpan = asyncTracer.getCompletedSpans().find(
  (s) => s.name === 'successful_operation'
);

check(
  'withSpan returns result',
  successResult,
  (v) => v === 'success',
  'success'
);

check(
  'successful span status is ok',
  successSpan?.status,
  (v) => v === 'ok',
  'ok'
);

check(
  'span has end time',
  successSpan?.endTimeMs !== null,
  (v) => v === true,
  'true (span completed)'
);

// Test failed operation
let errorCaught = false;
try {
  await withSpan(asyncTracer, 'failing_operation', async () => {
    throw new Error('Test error');
  });
} catch {
  errorCaught = true;
}

const errorSpan = asyncTracer.getCompletedSpans().find(
  (s) => s.name === 'failing_operation'
);

check(
  'error propagated from withSpan',
  errorCaught,
  (v) => v === true,
  'true (error thrown)'
);

check(
  'error span status is error',
  errorSpan?.status,
  (v) => v === 'error',
  'error'
);

check(
  'error span has error.message attribute',
  errorSpan?.attributes['error.message'],
  (v) => v === 'Test error',
  'Test error'
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
