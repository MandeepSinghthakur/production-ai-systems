// Roadmap initiative
export interface Initiative {
  id: string;
  name: string;
  description: string;
  quarter: string;
  status: 'planned' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  dependencies: string[];
  owner: string;
  priority: number; // 1-5, 1 is highest
  effort: 'small' | 'medium' | 'large' | 'xlarge';
  impact: 'low' | 'medium' | 'high' | 'critical';
}

// Roadmap
export interface Roadmap {
  id: string;
  name: string;
  timeframe: string;
  initiatives: Initiative[];
  milestones: Milestone[];
}

export interface Milestone {
  id: string;
  name: string;
  targetDate: Date;
  initiatives: string[];
  status: 'on_track' | 'at_risk' | 'delayed' | 'completed';
}

// Build vs Buy analysis
export interface BuildBuyAnalysis {
  name: string;
  description: string;
  buildOption: BuildOption;
  buyOption: BuyOption;
  recommendation: 'build' | 'buy';
  rationale: string;
}

export interface BuildOption {
  upfrontCost: number;
  ongoingCost: number;
  timeToDeliver: number; // weeks
  teamSize: number;
  risks: string[];
  benefits: string[];
}

export interface BuyOption {
  vendorName: string;
  upfrontCost: number;
  ongoingCost: number;
  timeToDeliver: number; // weeks
  integrationEffort: 'low' | 'medium' | 'high';
  risks: string[];
  benefits: string[];
}

// Technical debt
export interface TechDebt {
  id: string;
  title: string;
  description: string;
  category: 'code' | 'architecture' | 'infrastructure' | 'documentation' | 'testing';
  impact: number; // 1-5
  effort: number; // 1-5
  interestRate: number; // multiplier for future cost
  createdAt: Date;
  owner?: string;
  linkedIncidents: string[];
}

export interface TechDebtScore {
  item: TechDebt;
  priority: number;
  payoffRatio: number;
}

// Strategy document
export interface StrategyDocument {
  title: string;
  version: string;
  author: string;
  createdAt: Date;
  vision: string;
  goals: StrategicGoal[];
  milestones: StrategyMilestone[];
  risks: StrategicRisk[];
  dependencies: StrategyDependency[];
  metrics: SuccessMetric[];
}

export interface StrategicGoal {
  id: string;
  description: string;
  timeframe: string;
  measurable: boolean;
  keyResults: string[];
}

export interface StrategyMilestone {
  id: string;
  name: string;
  targetQuarter: string;
  deliverables: string[];
  dependencies: string[];
}

export interface StrategicRisk {
  id: string;
  description: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
}

export interface StrategyDependency {
  id: string;
  name: string;
  type: 'team' | 'budget' | 'technology' | 'external';
  status: 'secured' | 'in_progress' | 'blocked';
  notes?: string;
}

export interface SuccessMetric {
  name: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  trackingFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

// Prioritization
export interface PrioritizationResult {
  initiatives: ScoredInitiative[];
  topPriorities: string[];
  resourceAllocation: ResourceAllocation[];
}

export interface ScoredInitiative {
  initiative: Initiative;
  score: number;
  factors: PrioritizationFactor[];
}

export interface PrioritizationFactor {
  name: string;
  weight: number;
  score: number;
  contribution: number;
}

export interface ResourceAllocation {
  quarter: string;
  initiatives: string[];
  headcount: number;
  budget: number;
}

// Required strategy sections
export const REQUIRED_STRATEGY_SECTIONS = [
  'vision',
  'goals',
  'milestones',
  'risks'
] as const;

// Effort to weeks mapping
export const EFFORT_WEEKS: Record<string, number> = {
  small: 2,
  medium: 6,
  large: 12,
  xlarge: 26
};

// Impact multipliers
export const IMPACT_MULTIPLIERS: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 5
};
