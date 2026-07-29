// Structured logging for AI systems.
//
// The key insight: logs must be structured to be searchable at scale.
// Unstructured logs become write-only storage. Structured logs become
// a debugging interface.
//
// This implements OpenTelemetry-compatible logging without external deps.

import type {
  LogRecord,
  LogSeverity,
  LoggerConfig,
  TraceContext,
} from './types.ts';

const DEFAULT_CONFIG: LoggerConfig = {
  serviceName: 'ai-service',
  minSeverity: 'INFO',
  structured: true,
};

const SEVERITY_ORDER: LogSeverity[] = [
  'TRACE',
  'DEBUG',
  'INFO',
  'WARN',
  'ERROR',
  'FATAL',
];

/**
 * Compare severity levels.
 */
function severityAtLeast(level: LogSeverity, minimum: LogSeverity): boolean {
  return SEVERITY_ORDER.indexOf(level) >= SEVERITY_ORDER.indexOf(minimum);
}

/**
 * Logger with trace correlation and structured output.
 */
export class Logger {
  private config: LoggerConfig;
  private records: LogRecord[];
  private currentContext: TraceContext | null;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.records = [];
    this.currentContext = null;
  }

  /**
   * Set the current trace context for log correlation.
   */
  setContext(context: TraceContext | null): void {
    this.currentContext = context;
  }

  /**
   * Get the current trace context.
   */
  getContext(): TraceContext | null {
    return this.currentContext;
  }

  /**
   * Log at TRACE level.
   */
  trace(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('TRACE', message, attributes);
  }

  /**
   * Log at DEBUG level.
   */
  debug(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('DEBUG', message, attributes);
  }

  /**
   * Log at INFO level.
   */
  info(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('INFO', message, attributes);
  }

  /**
   * Log at WARN level.
   */
  warn(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('WARN', message, attributes);
  }

  /**
   * Log at ERROR level.
   */
  error(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('ERROR', message, attributes);
  }

  /**
   * Log at FATAL level.
   */
  fatal(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.log('FATAL', message, attributes);
  }

  /**
   * Log with explicit severity.
   */
  log(
    severity: LogSeverity,
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    if (!severityAtLeast(severity, this.config.minSeverity)) {
      return;
    }

    const record: LogRecord = {
      timestampMs: Date.now(),
      severity,
      body: message,
      attributes: {
        'service.name': this.config.serviceName,
        ...attributes,
      },
      traceId: this.currentContext?.traceId ?? null,
      spanId: this.currentContext?.spanId ?? null,
    };

    this.records.push(record);
  }

  /**
   * Log an error object with stack trace.
   */
  logError(
    err: Error,
    message: string = 'An error occurred',
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.error(message, {
      ...attributes,
      'error.type': err.name,
      'error.message': err.message,
      'error.stack': err.stack ?? '',
    });
  }

  /**
   * Create a child logger with additional default attributes.
   */
  child(
    attributes: Record<string, string | number | boolean>
  ): ChildLogger {
    return new ChildLogger(this, attributes);
  }

  /**
   * Get all log records.
   */
  getRecords(): LogRecord[] {
    return this.records.slice();
  }

  /**
   * Get log records for a specific trace.
   */
  getRecordsByTrace(traceId: string): LogRecord[] {
    return this.records.filter((r) => r.traceId === traceId);
  }

  /**
   * Get log records at or above a severity level.
   */
  getRecordsBySeverity(minSeverity: LogSeverity): LogRecord[] {
    return this.records.filter((r) => severityAtLeast(r.severity, minSeverity));
  }

  /**
   * Search logs by attribute value.
   */
  searchByAttribute(
    key: string,
    value: string | number | boolean
  ): LogRecord[] {
    return this.records.filter((r) => r.attributes[key] === value);
  }

  /**
   * Search logs by body text (substring match).
   */
  searchByBody(substring: string): LogRecord[] {
    return this.records.filter((r) =>
      r.body.toLowerCase().includes(substring.toLowerCase())
    );
  }

  /**
   * Format a log record as JSON.
   */
  formatJson(record: LogRecord): string {
    const output: Record<string, unknown> = {
      timestamp: new Date(record.timestampMs).toISOString(),
      severity: record.severity,
      message: record.body,
      ...record.attributes,
    };

    if (record.traceId) {
      output.trace_id = record.traceId;
    }
    if (record.spanId) {
      output.span_id = record.spanId;
    }

    return JSON.stringify(output);
  }

  /**
   * Format a log record as a human-readable line.
   */
  formatLine(record: LogRecord): string {
    const ts = new Date(record.timestampMs).toISOString();
    const level = record.severity.padEnd(5);
    const traceInfo = record.traceId
      ? ` [${record.traceId.slice(0, 8)}]`
      : '';
    const attrs = Object.entries(record.attributes)
      .filter(([k]) => k !== 'service.name')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    return `${ts} ${level}${traceInfo} ${record.body} ${attrs}`.trim();
  }

  /**
   * Clear all log records.
   */
  clear(): void {
    this.records = [];
    this.currentContext = null;
  }
}

/**
 * Child logger with inherited context and additional attributes.
 */
export class ChildLogger {
  private parent: Logger;
  private attributes: Record<string, string | number | boolean>;

  constructor(
    parent: Logger,
    attributes: Record<string, string | number | boolean>
  ) {
    this.parent = parent;
    this.attributes = attributes;
  }

  trace(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('TRACE', message, { ...this.attributes, ...attributes });
  }

  debug(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('DEBUG', message, { ...this.attributes, ...attributes });
  }

  info(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('INFO', message, { ...this.attributes, ...attributes });
  }

  warn(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('WARN', message, { ...this.attributes, ...attributes });
  }

  error(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('ERROR', message, { ...this.attributes, ...attributes });
  }

  fatal(
    message: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    this.parent.log('FATAL', message, { ...this.attributes, ...attributes });
  }
}

/**
 * Log context for correlation across function calls.
 */
export function withLogging<T>(
  logger: Logger,
  context: TraceContext,
  fn: () => T
): T {
  const previousContext = logger.getContext();
  logger.setContext(context);
  try {
    return fn();
  } finally {
    logger.setContext(previousContext);
  }
}

/**
 * Async version of withLogging.
 */
export async function withLoggingAsync<T>(
  logger: Logger,
  context: TraceContext,
  fn: () => Promise<T>
): Promise<T> {
  const previousContext = logger.getContext();
  logger.setContext(context);
  try {
    return await fn();
  } finally {
    logger.setContext(previousContext);
  }
}
