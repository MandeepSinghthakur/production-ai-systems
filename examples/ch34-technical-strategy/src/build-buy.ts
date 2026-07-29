import type { BuildBuyAnalysis, BuildOption, BuyOption } from './types.ts';

export class BuildBuyAnalyzer {
  analyze(
    name: string,
    description: string,
    buildOption: BuildOption,
    buyOption: BuyOption,
    weights?: AnalysisWeights
  ): BuildBuyAnalysis {
    const w = weights || {
      cost: 0.3,
      time: 0.25,
      control: 0.2,
      risk: 0.15,
      flexibility: 0.1
    };

    const buildScore = this.scoreBuild(buildOption, w);
    const buyScore = this.scoreBuy(buyOption, w);

    const recommendation: 'build' | 'buy' = buildScore >= buyScore ? 'build' : 'buy';
    const rationale = this.generateRationale(buildOption, buyOption, buildScore, buyScore);

    return {
      name,
      description,
      buildOption,
      buyOption,
      recommendation,
      rationale
    };
  }

  private scoreBuild(option: BuildOption, weights: AnalysisWeights): number {
    let score = 0;

    // Cost score (lower is better, normalize to 0-100)
    const totalBuildCost = option.upfrontCost + option.ongoingCost * 12; // 1 year
    const costScore = Math.max(0, 100 - totalBuildCost / 10000);
    score += costScore * weights.cost;

    // Time score (faster is better)
    const timeScore = Math.max(0, 100 - option.timeToDeliver * 2);
    score += timeScore * weights.time;

    // Control score (build = full control)
    score += 90 * weights.control;

    // Risk score (more risks = lower score)
    const riskScore = Math.max(0, 100 - option.risks.length * 15);
    score += riskScore * weights.risk;

    // Flexibility score (build = more flexible)
    score += 85 * weights.flexibility;

    return Math.round(score);
  }

  private scoreBuy(option: BuyOption, weights: AnalysisWeights): number {
    let score = 0;

    // Cost score
    const totalBuyCost = option.upfrontCost + option.ongoingCost * 12;
    const costScore = Math.max(0, 100 - totalBuyCost / 10000);
    score += costScore * weights.cost;

    // Time score (faster is better)
    const timeScore = Math.max(0, 100 - option.timeToDeliver * 2);
    score += timeScore * weights.time;

    // Control score (buy = less control)
    const controlScores = { low: 70, medium: 50, high: 30 };
    score += controlScores[option.integrationEffort] * weights.control;

    // Risk score
    const riskScore = Math.max(0, 100 - option.risks.length * 15);
    score += riskScore * weights.risk;

    // Flexibility score (buy = less flexible)
    score += 50 * weights.flexibility;

    return Math.round(score);
  }

  private generateRationale(
    build: BuildOption,
    buy: BuyOption,
    buildScore: number,
    buyScore: number
  ): string {
    const diff = Math.abs(buildScore - buyScore);
    const winner = buildScore >= buyScore ? 'Build' : 'Buy';

    let rationale = `${winner} recommended with score ${Math.max(buildScore, buyScore)} vs ${Math.min(buildScore, buyScore)}. `;

    if (diff < 10) {
      rationale += 'Scores are close; decision should factor in team capabilities and strategic priorities. ';
    }

    if (build.timeToDeliver > buy.timeToDeliver * 2) {
      rationale += 'Build option takes significantly longer to deliver. ';
    }

    const buildTotal = build.upfrontCost + build.ongoingCost * 12;
    const buyTotal = buy.upfrontCost + buy.ongoingCost * 12;

    if (buildTotal < buyTotal * 0.7) {
      rationale += 'Build option is significantly cheaper over 12 months. ';
    } else if (buyTotal < buildTotal * 0.7) {
      rationale += 'Buy option is significantly cheaper over 12 months. ';
    }

    return rationale.trim();
  }

  validateAnalysis(analysis: BuildBuyAnalysis): ValidationResult {
    const errors: string[] = [];

    if (!analysis.buildOption.benefits || analysis.buildOption.benefits.length === 0) {
      errors.push('Build option missing benefits');
    }

    if (!analysis.buyOption.benefits || analysis.buyOption.benefits.length === 0) {
      errors.push('Buy option missing benefits');
    }

    if (!analysis.buildOption.risks || analysis.buildOption.risks.length === 0) {
      errors.push('Build option missing risk assessment');
    }

    if (!analysis.buyOption.risks || analysis.buyOption.risks.length === 0) {
      errors.push('Buy option missing risk assessment');
    }

    if (analysis.buildOption.upfrontCost === 0 && analysis.buildOption.ongoingCost === 0) {
      errors.push('Build option has no cost estimate');
    }

    if (analysis.buyOption.upfrontCost === 0 && analysis.buyOption.ongoingCost === 0) {
      errors.push('Buy option has no cost estimate');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  compareOptions(analysis: BuildBuyAnalysis): ComparisonTable {
    const build = analysis.buildOption;
    const buy = analysis.buyOption;

    return {
      dimensions: [
        {
          name: 'Upfront Cost',
          build: `$${build.upfrontCost.toLocaleString()}`,
          buy: `$${buy.upfrontCost.toLocaleString()}`,
          winner: build.upfrontCost <= buy.upfrontCost ? 'build' : 'buy'
        },
        {
          name: 'Annual Cost',
          build: `$${(build.ongoingCost * 12).toLocaleString()}`,
          buy: `$${(buy.ongoingCost * 12).toLocaleString()}`,
          winner: build.ongoingCost <= buy.ongoingCost ? 'build' : 'buy'
        },
        {
          name: 'Time to Deliver',
          build: `${build.timeToDeliver} weeks`,
          buy: `${buy.timeToDeliver} weeks`,
          winner: build.timeToDeliver <= buy.timeToDeliver ? 'build' : 'buy'
        },
        {
          name: 'Team Size Needed',
          build: `${build.teamSize} engineers`,
          buy: `Integration: ${buy.integrationEffort}`,
          winner: build.teamSize <= 2 ? 'build' : 'buy'
        },
        {
          name: 'Risk Count',
          build: `${build.risks.length} risks`,
          buy: `${buy.risks.length} risks`,
          winner: build.risks.length <= buy.risks.length ? 'build' : 'buy'
        }
      ]
    };
  }
}

export interface AnalysisWeights {
  cost: number;
  time: number;
  control: number;
  risk: number;
  flexibility: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ComparisonTable {
  dimensions: ComparisonRow[];
}

export interface ComparisonRow {
  name: string;
  build: string;
  buy: string;
  winner: 'build' | 'buy' | 'tie';
}
