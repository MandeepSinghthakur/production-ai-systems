// Distributed tracing for AI systems.
//
// The key insight: LLM requests span multiple services and take seconds,
// not milliseconds. Traces are essential for understanding where time goes
// and correlating failures across service boundaries.
//
// This implements OpenTelemetry-compatible tracing without external deps.

import { randomBytes } from 'node:crypto';
import type {
  Span,
  SpanKind,
  SpanStatus,
  SpanEvent,
  TraceContext,
  TracerConfig,
} from './types.ts';

const DEFAULT_CONFIG: TracerConfig = {
  serviceName: 'ai-service',
  maxSpansPerTrace: 1000,
  sampleRate: 1.0,
};

/**
 * Generate a 16-byte hex trace ID (W3C format).
 */
function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate an 8-byte hex span ID (W3C format).
 */
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Parse a W3C traceparent header.
 * Format: version-traceid-spanid-flags
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, spanId, flags] = parts;

  // Version 00 is the only supported version
  if (version !== '00') return null;
  if (traceId.length !== 32) return null;
  if (spanId.length !== 16) return null;
  if (flags.length !== 2) return null;

  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    traceState: '',
  };
}

/**
 * Format a trace context as a W3C traceparent header.
 */
export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Tracer manages distributed traces across an AI pipeline.
 *
 * This models OpenTelemetry's tracer API without requiring the full SDK.
 */
export class Tracer {
  private config: TracerConfig;
  private activeSpans: Map<string, Span>;
  private completedSpans: Span[];
  private spansByTrace: Map<string, Span[]>;

  constructor(config: Partial<TracerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeSpans = new Map();
    this.completedSpans = [];
    this.spansByTrace = new Map();
  }

  /**
   * Start a new span. If parentContext is provided, this span becomes
   * a child of the existing trace. Otherwise, a new trace is created.
   */
  startSpan(
    name: string,
    kind: SpanKind = 'internal',
    parentContext?: TraceContext,
    attributes: Record<string, string | number | boolean> = {}
  ): Span {
    // Determine trace and parent
    let traceId: string;
    let parentSpanId: string | null;

    if (parentContext) {
      traceId = parentContext.traceId;
      parentSpanId = parentContext.spanId;
    } else {
      traceId = generateTraceId();
      parentSpanId = null;
    }

    // Check sampling
    if (Math.random() > this.config.sampleRate) {
      // Return a no-op span that will not be recorded
      const noopSpan: Span = {
        traceId,
        spanId: generateSpanId(),
        parentSpanId,
        name,
        kind,
        startTimeMs: Date.now(),
        endTimeMs: null,
        status: 'unset',
        attributes: { ...attributes, 'sampling.sampled': false },
        events: [],
      };
      return noopSpan;
    }

    const span: Span = {
      traceId,
      spanId: generateSpanId(),
      parentSpanId,
      name,
      kind,
      startTimeMs: Date.now(),
      endTimeMs: null,
      status: 'unset',
      attributes: {
        'service.name': this.config.serviceName,
        ...attributes,
      },
      events: [],
    };

    this.activeSpans.set(span.spanId, span);

    // Track spans by trace for correlation
    const traceSpans = this.spansByTrace.get(traceId) ?? [];
    traceSpans.push(span);
    this.spansByTrace.set(traceId, traceSpans);

    return span;
  }

  /**
   * End a span and record its duration.
   */
  endSpan(span: Span, status: SpanStatus = 'ok'): void {
    span.endTimeMs = Date.now();
    span.status = status;
    this.activeSpans.delete(span.spanId);
    this.completedSpans.push(span);
  }

  /**
   * Add an event to a span. Events mark points in time during execution.
   */
  addEvent(
    span: Span,
    name: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    const event: SpanEvent = {
      name,
      timestampMs: Date.now(),
      attributes,
    };
    span.events.push(event);
  }

  /**
   * Set an attribute on a span.
   */
  setAttribute(
    span: Span,
    key: string,
    value: string | number | boolean
  ): void {
    span.attributes[key] = value;
  }

  /**
   * Get the trace context for propagation to downstream services.
   */
  getContext(span: Span): TraceContext {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      traceFlags: 1, // Sampled
      traceState: '',
    };
  }

  /**
   * Get all spans for a trace, sorted by start time.
   */
  getTraceSpans(traceId: string): Span[] {
    const spans = this.spansByTrace.get(traceId) ?? [];
    return spans.slice().sort((a, b) => a.startTimeMs - b.startTimeMs);
  }

  /**
   * Get all completed spans.
   */
  getCompletedSpans(): Span[] {
    return this.completedSpans.slice();
  }

  /**
   * Calculate the critical path of a trace (longest sequential chain).
   */
  getCriticalPath(traceId: string): Span[] {
    const spans = this.getTraceSpans(traceId);
    if (spans.length === 0) return [];

    // Build a map of parent to children
    const childrenMap = new Map<string | null, Span[]>();
    for (const span of spans) {
      const children = childrenMap.get(span.parentSpanId) ?? [];
      children.push(span);
      childrenMap.set(span.parentSpanId, children);
    }

    // Find root span(s)
    const roots = spans.filter((s) => s.parentSpanId === null);
    if (roots.length === 0) return [];

    // DFS to find the longest path by duration
    const findLongestPath = (span: Span): Span[] => {
      const children = childrenMap.get(span.spanId) ?? [];
      if (children.length === 0) return [span];

      let longestChildPath: Span[] = [];
      for (const child of children) {
        const path = findLongestPath(child);
        if (path.length > longestChildPath.length) {
          longestChildPath = path;
        }
      }

      return [span, ...longestChildPath];
    };

    // Find the longest path starting from any root
    let criticalPath: Span[] = [];
    for (const root of roots) {
      const path = findLongestPath(root);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }

    return criticalPath;
  }

  /**
   * Check if a span is correlated with a given trace.
   */
  isCorrelated(span: Span, traceId: string): boolean {
    return span.traceId === traceId;
  }

  /**
   * Clear all stored spans.
   */
  clear(): void {
    this.activeSpans.clear();
    this.completedSpans = [];
    this.spansByTrace.clear();
  }
}

/**
 * Convenience function to trace an async operation.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  parentContext?: TraceContext,
  kind: SpanKind = 'internal'
): Promise<T> {
  const span = tracer.startSpan(name, kind, parentContext);
  try {
    const result = await fn(span);
    tracer.endSpan(span, 'ok');
    return result;
  } catch (error) {
    tracer.setAttribute(
      span,
      'error.message',
      error instanceof Error ? error.message : String(error)
    );
    tracer.endSpan(span, 'error');
    throw error;
  }
}
