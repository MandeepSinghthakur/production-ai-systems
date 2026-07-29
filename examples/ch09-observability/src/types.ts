// Core types for observability in AI systems.
// See Chapter 9, "Building Production AI Systems".

/**
 * Model capability tiers. We avoid vendor names and prices.
 */
export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Span kind identifies the role of a span in a distributed trace.
 */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

/**
 * Span status indicates success or failure.
 */
export type SpanStatus = 'unset' | 'ok' | 'error';

/**
 * Log severity levels following OpenTelemetry conventions.
 */
export type LogSeverity =
  | 'TRACE'
  | 'DEBUG'
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'FATAL';

/**
 * A span represents a unit of work in a distributed trace.
 */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startTimeMs: number;
  endTimeMs: number | null;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

/**
 * Events that occur during a span's lifetime.
 */
export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes: Record<string, string | number | boolean>;
}

/**
 * Trace context propagated across service boundaries.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState: string;
}

/**
 * A log record with structured attributes.
 */
export interface LogRecord {
  timestampMs: number;
  severity: LogSeverity;
  body: string;
  attributes: Record<string, string | number | boolean>;
  traceId: string | null;
  spanId: string | null;
}

/**
 * Metric data point with labels.
 */
export interface MetricDataPoint {
  timestampMs: number;
  value: number;
  labels: Record<string, string>;
}

/**
 * A metric with its type and data points.
 */
export interface Metric {
  name: string;
  description: string;
  unit: string;
  type: 'counter' | 'gauge' | 'histogram';
  dataPoints: MetricDataPoint[];
}

/**
 * Histogram bucket boundaries and counts.
 */
export interface HistogramBucket {
  upperBound: number;
  count: number;
}

/**
 * AI-specific metric dimensions.
 */
export interface AIMetricLabels {
  tenant: string;
  model: ModelTier;
  operation: string;
  status: 'success' | 'error';
}

/**
 * LLM request metrics for cost and performance tracking.
 */
export interface LLMRequestMetrics {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  tier: ModelTier;
  tenant: string;
  cached: boolean;
}

/**
 * Alert rule configuration.
 */
export interface AlertRule {
  name: string;
  description: string;
  metric: string;
  condition: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  windowMs: number;
  labels: Record<string, string>;
  severity: 'warning' | 'critical';
}

/**
 * Alert firing state.
 */
export interface AlertState {
  rule: AlertRule;
  firing: boolean;
  firedAt: number | null;
  resolvedAt: number | null;
  value: number;
  message: string;
}

/**
 * Configuration for the tracer.
 */
export interface TracerConfig {
  serviceName: string;
  maxSpansPerTrace: number;
  sampleRate: number;
}

/**
 * Configuration for the metrics collector.
 */
export interface MetricsConfig {
  serviceName: string;
  defaultLabels: Record<string, string>;
  histogramBuckets: number[];
}

/**
 * Configuration for the logger.
 */
export interface LoggerConfig {
  serviceName: string;
  minSeverity: LogSeverity;
  structured: boolean;
}

/**
 * Exported telemetry data for analysis.
 */
export interface TelemetryExport {
  traces: Span[];
  metrics: Metric[];
  logs: LogRecord[];
  exportedAt: number;
}
