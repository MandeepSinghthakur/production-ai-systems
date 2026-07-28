// Distributed tracing for multi-agent systems.
// See Chapter 27, "Building Production AI Systems".

import type { TraceSpan } from './types.ts';

/**
 * Generate a random ID for traces and spans.
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Trace context passed through the agent system.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
}

/**
 * Creates a new trace with a root span.
 */
export function createTrace(operationName: string, agentId: string): {
  context: TraceContext;
  span: TraceSpan;
} {
  const traceId = generateId();
  const spanId = generateId();

  const span: TraceSpan = {
    traceId,
    spanId,
    parentSpanId: null,
    operationName,
    agentId,
    startTime: Date.now(),
    endTime: null,
    status: 'running',
    tags: {},
  };

  return {
    context: { traceId, spanId, parentSpanId: null },
    span,
  };
}

/**
 * Creates a child span within an existing trace.
 */
export function createChildSpan(
  parent: TraceContext,
  operationName: string,
  agentId: string
): { context: TraceContext; span: TraceSpan } {
  const spanId = generateId();

  const span: TraceSpan = {
    traceId: parent.traceId,
    spanId,
    parentSpanId: parent.spanId,
    operationName,
    agentId,
    startTime: Date.now(),
    endTime: null,
    status: 'running',
    tags: {},
  };

  return {
    context: { traceId: parent.traceId, spanId, parentSpanId: parent.spanId },
    span,
  };
}

/**
 * Completes a span.
 */
export function completeSpan(
  span: TraceSpan,
  status: 'completed' | 'error'
): TraceSpan {
  return {
    ...span,
    endTime: Date.now(),
    status,
  };
}

/**
 * Trace collector that stores all spans for a trace.
 */
export class TraceCollector {
  private spans: Map<string, TraceSpan[]>;

  constructor() {
    this.spans = new Map();
  }

  /**
   * Record a span in the collector.
   */
  record(span: TraceSpan): void {
    const existing = this.spans.get(span.traceId) ?? [];
    existing.push(span);
    this.spans.set(span.traceId, existing);
  }

  /**
   * Get all spans for a trace.
   */
  getSpans(traceId: string): TraceSpan[] {
    return this.spans.get(traceId) ?? [];
  }

  /**
   * Get all unique agent IDs that participated in a trace.
   */
  getAgentsInTrace(traceId: string): string[] {
    const spans = this.getSpans(traceId);
    const agents = new Set(spans.map((s) => s.agentId));
    return Array.from(agents);
  }

  /**
   * Verify that all spans in a trace share the same traceId.
   */
  verifyTraceCorrelation(traceId: string): boolean {
    const spans = this.getSpans(traceId);
    return spans.every((s) => s.traceId === traceId);
  }

  /**
   * Build the span tree for visualization.
   */
  buildSpanTree(traceId: string): Map<string, TraceSpan[]> {
    const spans = this.getSpans(traceId);
    const tree = new Map<string, TraceSpan[]>();

    for (const span of spans) {
      const parentId = span.parentSpanId ?? 'root';
      const children = tree.get(parentId) ?? [];
      children.push(span);
      tree.set(parentId, children);
    }

    return tree;
  }

  /**
   * Clear all recorded spans.
   */
  clear(): void {
    this.spans.clear();
  }
}
