// A conventional breaker counts errors. During a brownout the error
// rate is normal, so it never trips. This one counts slow calls too.

export interface BreakerOptions {
  slowCallMs: number;
  slowCallRateThreshold: number;
  minSamples: number;
  openForMs: number;
  windowMs: number;
  halfOpenProbability: number;
}

export const DEFAULT_BREAKER: BreakerOptions = {
  slowCallMs: 20_000, // (1)
  slowCallRateThreshold: 0.5,
  minSamples: 20,
  openForMs: 30_000,
  windowMs: 30_000,
  halfOpenProbability: 0.1,
};

interface Sample {
  at: number;
  durationMs: number;
  failed: boolean;
}

export class LatencyBreaker {
  enabled = false;

  private opts: BreakerOptions;
  private window: Sample[] = [];
  private openedAt: number | null = null;

  constructor(opts: Partial<BreakerOptions> = {}) {
    this.opts = { ...DEFAULT_BREAKER, ...opts };
  }

  configure(opts: Partial<BreakerOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return Date.now() - this.openedAt < this.opts.openForMs
      ? 'open'
      : 'half-open';
  }

  allow(): boolean {
    if (!this.enabled) return true;
    if (this.openedAt === null) return true;
    if (Date.now() - this.openedAt < this.opts.openForMs) return false;
    return Math.random() < this.opts.halfOpenProbability; // (2)
  }

  record(durationMs: number, failed: boolean): void {
    if (!this.enabled) return;

    this.window.push({ at: Date.now(), durationMs, failed });
    const cutoff = Date.now() - this.opts.windowMs;
    this.window = this.window.filter((s) => s.at >= cutoff);

    if (this.window.length < this.opts.minSamples) return;

    const bad = this.window.filter(
      (s) => s.failed || s.durationMs > this.opts.slowCallMs,
    ).length; // (3)

    if (bad / this.window.length >= this.opts.slowCallRateThreshold) {
      this.openedAt = Date.now();
      this.window = []; // (4)
    }
  }

  reset(): void {
    this.window = [];
    this.openedAt = null;
  }
}
