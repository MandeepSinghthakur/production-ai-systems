import type { RFC, Alternative, Tradeoff } from './types.ts';

export interface TradeoffAnalysis {
  rfcId: string;
  alternatives: AlternativeScore[];
  recommendation: string;
  rationale: string;
}

export interface AlternativeScore {
  name: string;
  scores: DimensionScore[];
  totalScore: number;
  normalizedScore: number;
}

export interface DimensionScore {
  dimension: string;
  benefitScore: number;  // 1-5
  costScore: number;     // 1-5 (lower is better)
  netScore: number;
  weight: number;
}

// Standard dimensions for AI system tradeoffs
const STANDARD_DIMENSIONS = [
  { name: 'latency', weight: 1.0 },
  { name: 'cost', weight: 1.0 },
  { name: 'accuracy', weight: 1.2 },
  { name: 'reliability', weight: 1.1 },
  { name: 'complexity', weight: 0.8 },
  { name: 'maintainability', weight: 0.9 }
];

export class TradeoffAnalyzer {
  private dimensionWeights: Map<string, number>;

  constructor() {
    this.dimensionWeights = new Map(
      STANDARD_DIMENSIONS.map(d => [d.name, d.weight])
    );
  }

  setDimensionWeight(dimension: string, weight: number): void {
    this.dimensionWeights.set(dimension, weight);
  }

  analyzeRFC(rfc: RFC): TradeoffAnalysis {
    const alternativeScores = rfc.alternatives.map(alt =>
      this.scoreAlternative(alt)
    );

    // Normalize scores
    const maxScore = Math.max(...alternativeScores.map(a => a.totalScore));
    for (const alt of alternativeScores) {
      alt.normalizedScore = maxScore > 0
        ? Math.round((alt.totalScore / maxScore) * 100)
        : 0;
    }

    // Sort by score descending
    alternativeScores.sort((a, b) => b.totalScore - a.totalScore);

    const recommendation = alternativeScores[0]?.name || 'None';
    const rationale = this.generateRationale(alternativeScores);

    return {
      rfcId: rfc.id,
      alternatives: alternativeScores,
      recommendation,
      rationale
    };
  }

  private scoreAlternative(alt: Alternative): AlternativeScore {
    const scores: DimensionScore[] = alt.tradeoffs.map(t =>
      this.scoreTradeoff(t)
    );

    const totalScore = scores.reduce((sum, s) => sum + s.netScore * s.weight, 0);

    return {
      name: alt.name,
      scores,
      totalScore,
      normalizedScore: 0  // Set after normalization
    };
  }

  private scoreTradeoff(tradeoff: Tradeoff): DimensionScore {
    // Simple scoring based on keyword analysis
    const benefitScore = this.scoreSentiment(tradeoff.benefit, true);
    const costScore = this.scoreSentiment(tradeoff.cost, false);
    const weight = this.dimensionWeights.get(tradeoff.dimension.toLowerCase()) || 1.0;
    const netScore = benefitScore - costScore;

    return {
      dimension: tradeoff.dimension,
      benefitScore,
      costScore,
      netScore,
      weight
    };
  }

  private scoreSentiment(text: string, isBenefit: boolean): number {
    const lower = text.toLowerCase();

    const strongPositive = ['significant', 'major', 'substantial', 'excellent', 'minimal'];
    const positive = ['good', 'better', 'improved', 'reduced', 'faster', 'cheaper'];
    const neutral = ['moderate', 'acceptable', 'standard', 'typical'];
    const negative = ['some', 'slight', 'minor', 'small'];
    const strongNegative = ['high', 'significant', 'major', 'substantial', 'complex'];

    let score = 3; // Default neutral

    if (isBenefit) {
      if (strongPositive.some(w => lower.includes(w))) score = 5;
      else if (positive.some(w => lower.includes(w))) score = 4;
      else if (neutral.some(w => lower.includes(w))) score = 3;
      else if (negative.some(w => lower.includes(w))) score = 2;
      else if (strongNegative.some(w => lower.includes(w))) score = 1;
    } else {
      // For costs, invert the scoring
      if (strongNegative.some(w => lower.includes(w))) score = 5;
      else if (negative.some(w => lower.includes(w))) score = 4;
      else if (neutral.some(w => lower.includes(w))) score = 3;
      else if (positive.some(w => lower.includes(w))) score = 2;
      else if (strongPositive.some(w => lower.includes(w))) score = 1;
    }

    return score;
  }

  private generateRationale(scores: AlternativeScore[]): string {
    if (scores.length === 0) {
      return 'No alternatives to compare.';
    }

    if (scores.length === 1) {
      return `Only one alternative (${scores[0].name}) was evaluated.`;
    }

    const best = scores[0];
    const second = scores[1];
    const margin = best.normalizedScore - second.normalizedScore;

    if (margin > 20) {
      return `${best.name} significantly outscores alternatives with a ${margin}% margin.`;
    } else if (margin > 10) {
      return `${best.name} moderately outscores ${second.name} with a ${margin}% margin.`;
    } else {
      return `${best.name} and ${second.name} are closely matched. Consider additional factors.`;
    }
  }

  validateTradeoffCompleteness(rfc: RFC): string[] {
    const issues: string[] = [];

    for (const alt of rfc.alternatives) {
      if (alt.tradeoffs.length === 0) {
        issues.push(`Alternative "${alt.name}" has no documented tradeoffs`);
      }

      // Check for standard dimensions
      const coveredDimensions = new Set(alt.tradeoffs.map(t => t.dimension.toLowerCase()));
      const requiredDimensions = ['latency', 'cost'];

      for (const dim of requiredDimensions) {
        if (!coveredDimensions.has(dim)) {
          issues.push(`Alternative "${alt.name}" missing tradeoff for: ${dim}`);
        }
      }
    }

    return issues;
  }
}

export function compareAlternatives(alts: Alternative[]): Map<string, Alternative> {
  const comparison = new Map<string, Alternative>();
  for (const alt of alts) {
    comparison.set(alt.name, alt);
  }
  return comparison;
}
