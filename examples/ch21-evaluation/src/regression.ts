// Regression detection for eval pipelines.
//
// Compares two eval runs and identifies significant regressions.
// Uses statistical tests to determine if differences are real.

import type {
  EvalResult,
  EvalRunSummary,
  RegressionReport,
  RegressionDetail,
  StatisticalResult,
} from './types.ts';

/**
 * Compare two eval runs and detect regressions.
 *
 * A regression is detected when:
 * 1. The candidate run has a lower average judge score than baseline
 * 2. The difference exceeds the regression threshold
 * 3. The difference is statistically significant
 */
export function detectRegressions(
  baseline: EvalResult[],
  candidate: EvalResult[],
  options?: {
    regressionThreshold?: number;
    confidenceLevel?: number;
  }
): RegressionReport {
  const threshold = options?.regressionThreshold ?? 0.05; // 5% drop
  const confidence = options?.confidenceLevel ?? 0.95;

  // Match examples across runs
  const baselineMap = new Map(baseline.map((r) => [r.exampleId, r]));
  const candidateMap = new Map(candidate.map((r) => [r.exampleId, r]));

  const matchedPairs: Array<{
    exampleId: string;
    baselineScore: number;
    candidateScore: number;
    category?: string;
  }> = [];

  for (const [id, baseResult] of baselineMap) {
    const candResult = candidateMap.get(id);
    if (candResult) {
      matchedPairs.push({
        exampleId: id,
        baselineScore: baseResult.metrics.judgeScore,
        candidateScore: candResult.metrics.judgeScore,
      });
    }
  }

  if (matchedPairs.length === 0) {
    return {
      baselineRunId: 'baseline',
      candidateRunId: 'candidate',
      hasRegression: false,
      regressionThreshold: threshold,
      overallDelta: 0,
      significantRegressions: [],
      improvements: [],
      statisticalSignificance: {
        testName: 'insufficient_data',
        pValue: 1,
        isSignificant: false,
        confidenceLevel: confidence,
        effectSize: 0,
      },
    };
  }

  // Compute overall delta
  const baselineAvg =
    matchedPairs.reduce((sum, p) => sum + p.baselineScore, 0) /
    matchedPairs.length;
  const candidateAvg =
    matchedPairs.reduce((sum, p) => sum + p.candidateScore, 0) /
    matchedPairs.length;
  const overallDelta = candidateAvg - baselineAvg;

  // Identify individual regressions and improvements
  const significantRegressions: RegressionDetail[] = [];
  const improvements: RegressionDetail[] = [];

  for (const pair of matchedPairs) {
    const delta = pair.candidateScore - pair.baselineScore;

    if (delta < -threshold) {
      significantRegressions.push({
        exampleId: pair.exampleId,
        baselineScore: pair.baselineScore,
        candidateScore: pair.candidateScore,
        delta,
      });
    } else if (delta > threshold) {
      improvements.push({
        exampleId: pair.exampleId,
        baselineScore: pair.baselineScore,
        candidateScore: pair.candidateScore,
        delta,
      });
    }
  }

  // Statistical significance test (paired t-test)
  const statResult = pairedTTest(
    matchedPairs.map((p) => p.baselineScore),
    matchedPairs.map((p) => p.candidateScore),
    confidence
  );

  // Determine if there's an overall regression
  const hasRegression =
    overallDelta < -threshold && statResult.isSignificant;

  return {
    baselineRunId: 'baseline',
    candidateRunId: 'candidate',
    hasRegression,
    regressionThreshold: threshold,
    overallDelta,
    significantRegressions,
    improvements,
    statisticalSignificance: statResult,
  };
}

/**
 * Perform a paired t-test on two samples.
 *
 * Tests if the mean difference is significantly different from zero.
 * This is the right test for comparing scores on the same examples.
 */
export function pairedTTest(
  sample1: number[],
  sample2: number[],
  confidenceLevel: number = 0.95
): StatisticalResult {
  const n = Math.min(sample1.length, sample2.length);

  if (n < 2) {
    return {
      testName: 'paired_t_test',
      pValue: 1,
      isSignificant: false,
      confidenceLevel,
      effectSize: 0,
    };
  }

  // Compute differences
  const differences = sample1.map((x, i) => x - sample2[i]);

  // Mean difference
  const meanDiff = differences.reduce((a, b) => a + b, 0) / n;

  // Standard deviation of differences
  const variance =
    differences.reduce((sum, d) => sum + (d - meanDiff) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    // All differences are identical
    return {
      testName: 'paired_t_test',
      pValue: meanDiff === 0 ? 1 : 0,
      isSignificant: meanDiff !== 0,
      confidenceLevel,
      effectSize: 0,
    };
  }

  // t-statistic
  const standardError = stdDev / Math.sqrt(n);
  const tStatistic = meanDiff / standardError;

  // Degrees of freedom
  const df = n - 1;

  // Compute p-value using t-distribution approximation
  // For simplicity, we use a normal approximation for large n
  // and lookup table approximation for small n
  const pValue = tDistributionPValue(Math.abs(tStatistic), df);

  // Effect size (Cohen's d for paired samples)
  const effectSize = meanDiff / stdDev;

  // Significance threshold from confidence level
  const alpha = 1 - confidenceLevel;
  const isSignificant = pValue < alpha;

  return {
    testName: 'paired_t_test',
    pValue,
    isSignificant,
    confidenceLevel,
    effectSize,
  };
}

/**
 * Approximate p-value for t-distribution.
 *
 * Uses a simplified approximation that's accurate enough for
 * regression detection purposes.
 */
function tDistributionPValue(tValue: number, df: number): number {
  // For large df, t approaches normal
  if (df >= 30) {
    return 2 * (1 - normalCDF(tValue));
  }

  // For smaller df, use a rough approximation
  // This is good enough for >10 samples which is typical in evals
  const x = df / (df + tValue * tValue);
  const p = 0.5 * incompleteBeta(df / 2, 0.5, x);
  return 2 * p; // two-tailed
}

/**
 * Standard normal CDF approximation.
 */
function normalCDF(x: number): number {
  // Horner form of error function approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Incomplete beta function approximation.
 */
function incompleteBeta(a: number, b: number, x: number): number {
  // Simple approximation for our use case
  // In production, use a proper math library
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use continued fraction for better accuracy
  const bt =
    Math.exp(
      a * Math.log(x) +
        b * Math.log(1 - x) -
        (lnGamma(a) + lnGamma(b) - lnGamma(a + b))
    );

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaCF(a, b, x)) / a;
  } else {
    return 1 - (bt * betaCF(b, a, 1 - x)) / b;
  }
}

/**
 * Log gamma function (Lanczos approximation).
 */
function lnGamma(z: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953,
  ];

  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += c[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/**
 * Beta continued fraction.
 */
function betaCF(a: number, b: number, x: number): number {
  const maxIterations = 100;
  const epsilon = 3e-7;

  let m = 1;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (let i = 1; i <= maxIterations; i++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
    m++;
  }

  return h;
}

/**
 * Check if a sample size is sufficient for statistical testing.
 */
export function isSampleSufficient(
  sampleSize: number,
  minimumRequired: number = 20
): boolean {
  return sampleSize >= minimumRequired;
}

/**
 * Compute confidence interval for a proportion (pass rate).
 * Uses Wilson score interval for better coverage.
 */
export function wilsonConfidenceInterval(
  successes: number,
  total: number,
  confidenceLevel: number = 0.95
): { lower: number; upper: number } {
  if (total === 0) {
    return { lower: 0, upper: 1 };
  }

  const z = normalQuantile((1 + confidenceLevel) / 2);
  const p = successes / total;
  const n = total;

  const denominator = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin =
    z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);

  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

/**
 * Normal quantile (inverse CDF) approximation.
 */
function normalQuantile(p: number): number {
  // Rational approximation
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
    3.754408661907416e0,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
      )
    );
  }
}
