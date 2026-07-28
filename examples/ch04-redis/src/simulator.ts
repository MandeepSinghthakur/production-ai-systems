// Load simulation helpers for cache testing.
//
// Generates realistic LLM workload patterns:
// - Zipf distribution for prompt popularity (few prompts very common)
// - Variable token counts per request
// - Session-based access patterns

import type { LLMRequest, ModelTier } from './types.ts';
import { PromptCache } from './cache.ts';
import { TokenRateLimiter, RequestRateLimiter } from './rate-limiter.ts';
import { HotKeyDetector } from './hot-key.ts';

/**
 * Generate prompts with Zipf distribution.
 * A few prompts are very common, most are rare.
 */
export function generateZipfPrompts(
  uniquePrompts: number,
  totalRequests: number,
  skew: number = 1.0
): string[] {
  // Pre-compute Zipf weights
  const weights: number[] = [];
  let totalWeight = 0;
  for (let i = 1; i <= uniquePrompts; i++) {
    const w = 1 / Math.pow(i, skew);
    weights.push(w);
    totalWeight += w;
  }

  // Normalize to probabilities
  const probs = weights.map((w) => w / totalWeight);

  // Generate cumulative distribution
  const cumulative: number[] = [];
  let sum = 0;
  for (const p of probs) {
    sum += p;
    cumulative.push(sum);
  }

  // Sample from distribution
  const prompts: string[] = [];
  for (let i = 0; i < totalRequests; i++) {
    const r = Math.random();
    let idx = 0;
    for (let j = 0; j < cumulative.length; j++) {
      if (r <= cumulative[j]) {
        idx = j;
        break;
      }
    }
    prompts.push(`prompt_${idx}`);
  }

  return prompts;
}

/**
 * Generate a mock LLM response.
 */
export function generateMockResponse(prompt: string, tokens: number): string {
  // Generate a response of approximately the right size
  const words = [];
  let tokenCount = 0;
  while (tokenCount < tokens) {
    words.push(`word${tokenCount}`);
    tokenCount++;
  }
  return words.join(' ');
}

interface CacheSimulationResult {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  evictions: number;
  totalTokensSaved: number;
  uniquePrompts: number;
}

/**
 * Simulate cache behavior under load.
 */
export function simulateCacheLoad(
  cache: PromptCache,
  prompts: string[],
  tokensPerResponse: number = 500
): CacheSimulationResult {
  const uniquePromptSet = new Set<string>();
  let totalTokensSaved = 0;

  for (const prompt of prompts) {
    uniquePromptSet.add(prompt);

    const result = cache.get(prompt);
    if (!result.hit) {
      // Cache miss - would call LLM
      const response = generateMockResponse(prompt, tokensPerResponse);
      cache.set(prompt, response, tokensPerResponse);
    } else {
      // Cache hit - saved tokens
      totalTokensSaved += result.entry?.tokens ?? 0;
    }
  }

  const stats = cache.getStats();
  return {
    totalRequests: prompts.length,
    cacheHits: stats.hits,
    cacheMisses: stats.misses,
    hitRate: stats.hitRate,
    evictions: stats.evictions,
    totalTokensSaved,
    uniquePrompts: uniquePromptSet.size,
  };
}

interface RateLimitSimulationResult {
  totalRequests: number;
  allowed: number;
  rejected: number;
  totalTokensConsumed: number;
}

/**
 * Simulate rate limiting under burst traffic.
 */
export function simulateRateLimitBurst(
  limiter: TokenRateLimiter,
  tenantId: string,
  requests: Array<{ estimatedTokens: number; actualTokens: number }>
): RateLimitSimulationResult {
  let allowed = 0;
  let rejected = 0;
  let totalTokensConsumed = 0;

  for (const req of requests) {
    if (limiter.reserve(tenantId, req.estimatedTokens)) {
      allowed++;
      // Reconcile with actual (in real system, after LLM responds)
      limiter.reconcile(tenantId, req.estimatedTokens, req.actualTokens);
      totalTokensConsumed += req.actualTokens;
    } else {
      rejected++;
    }
  }

  return {
    totalRequests: requests.length,
    allowed,
    rejected,
    totalTokensConsumed,
  };
}

/**
 * Compare token-based vs request-based rate limiting.
 * Shows why request counting fails for LLM workloads.
 */
export function compareRateLimitStrategies(
  requestLimiter: RequestRateLimiter,
  tokenLimiter: TokenRateLimiter,
  tenantId: string,
  requests: Array<{ tokens: number }>
): {
  requestBased: { allowed: number; totalTokens: number };
  tokenBased: { allowed: number; totalTokens: number };
} {
  let requestAllowed = 0;
  let requestTokens = 0;
  let tokenAllowed = 0;
  let tokenTokens = 0;

  for (const req of requests) {
    // Request-based
    const rResult = requestLimiter.check(tenantId + '_req');
    if (rResult.allowed) {
      requestAllowed++;
      requestTokens += req.tokens;
    }

    // Token-based
    if (tokenLimiter.reserve(tenantId + '_tok', req.tokens)) {
      tokenAllowed++;
      tokenTokens += req.tokens;
    }
  }

  return {
    requestBased: { allowed: requestAllowed, totalTokens: requestTokens },
    tokenBased: { allowed: tokenAllowed, totalTokens: tokenTokens },
  };
}

interface HotKeySimulationResult {
  totalRequests: number;
  hotKeysDetected: number;
  hotKeyAccessRatio: number;
  topHotKey: string | null;
  topHotKeyCount: number;
}

/**
 * Simulate hot key detection.
 */
export function simulateHotKeyDetection(
  detector: HotKeyDetector,
  prompts: string[],
  topN: number = 5
): HotKeySimulationResult {
  for (const prompt of prompts) {
    detector.recordAccess(prompt);
  }

  const report = detector.getHotKeys(topN);
  const hotKeyAccesses = report.hotKeys.reduce((sum, k) => sum + k.count, 0);

  return {
    totalRequests: prompts.length,
    hotKeysDetected: report.hotKeys.length,
    hotKeyAccessRatio: prompts.length > 0 ? hotKeyAccesses / prompts.length : 0,
    topHotKey: report.hotKeys.length > 0 ? report.hotKeys[0].key : null,
    topHotKeyCount: report.hotKeys.length > 0 ? report.hotKeys[0].count : 0,
  };
}

/**
 * Generate requests with variable token counts.
 * Models real LLM usage: many small requests, few large ones.
 */
export function generateVariableTokenRequests(
  count: number,
  minTokens: number = 50,
  maxTokens: number = 4000
): Array<{ estimatedTokens: number; actualTokens: number }> {
  const requests: Array<{ estimatedTokens: number; actualTokens: number }> = [];

  for (let i = 0; i < count; i++) {
    // Log-normal distribution for token counts
    const logMean = Math.log(minTokens + (maxTokens - minTokens) / 4);
    const logStd = 0.8;
    const logValue = logMean + logStd * gaussianRandom();
    const actualTokens = Math.min(
      maxTokens,
      Math.max(minTokens, Math.round(Math.exp(logValue)))
    );

    // Estimate is usually higher than actual
    const overestimate = 1 + Math.random() * 0.5;
    const estimatedTokens = Math.round(actualTokens * overestimate);

    requests.push({ estimatedTokens, actualTokens });
  }

  return requests;
}

/**
 * Box-Muller transform for Gaussian random numbers.
 */
function gaussianRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Simulate memory pressure causing evictions.
 */
export function simulateMemoryPressure(
  cache: PromptCache,
  responseSize: number,
  count: number
): { entriesAdded: number; evictions: number; finalSize: number } {
  const statsBefore = cache.getStats();
  const evictionsBefore = statsBefore.evictions;

  for (let i = 0; i < count; i++) {
    const prompt = `unique_prompt_${i}_${Date.now()}`;
    const response = 'x'.repeat(responseSize);
    cache.set(prompt, response, responseSize / 4);
  }

  const statsAfter = cache.getStats();

  return {
    entriesAdded: count,
    evictions: statsAfter.evictions - evictionsBefore,
    finalSize: cache.size(),
  };
}
