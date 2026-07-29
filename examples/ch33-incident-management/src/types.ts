// Incident types specific to AI systems
export type IncidentType = 'model' | 'security' | 'cost' | 'availability' | 'data';

// Severity levels
export type Severity = 'sev1' | 'sev2' | 'sev3' | 'sev4';

// Incident status
export type IncidentStatus = 'detected' | 'acknowledged' | 'investigating' | 'mitigating' | 'resolved' | 'postmortem';

// Core incident structure
export interface Incident {
  id: string;
  type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  description: string;
  detectedAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  impactedServices: string[];
  impactedUsers: number;
  timeline: TimelineEvent[];
  assignees: string[];
  runbookId?: string;
}

// Timeline event
export interface TimelineEvent {
  timestamp: Date;
  actor: string;
  action: string;
  details: string;
}

// Severity criteria
export interface SeverityCriteria {
  severity: Severity;
  userImpact: string;
  revenueImpact: string;
  responseTime: string;
  examples: string[];
}

// Runbook structure
export interface Runbook {
  id: string;
  name: string;
  incidentType: IncidentType;
  steps: RunbookStep[];
  escalationPath: string[];
}

export interface RunbookStep {
  order: number;
  title: string;
  description: string;
  commands?: string[];
  checkpoints: string[];
  rollbackSteps?: string[];
}

// Runbook execution
export interface RunbookExecution {
  runbookId: string;
  incidentId: string;
  startedAt: Date;
  completedAt?: Date;
  stepResults: StepResult[];
}

export interface StepResult {
  stepOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  notes?: string;
}

// Post-incident report
export interface PostIncidentReport {
  incidentId: string;
  title: string;
  summary: string;
  timeline: TimelineEvent[];
  rootCause: RootCause;
  impact: ImpactAssessment;
  actionItems: ActionItem[];
  lessonsLearned: string[];
  generatedAt: Date;
}

export interface RootCause {
  description: string;
  category: 'human' | 'process' | 'technology' | 'external';
  contributingFactors: string[];
}

export interface ImpactAssessment {
  duration: number; // minutes
  usersAffected: number;
  requestsDropped: number;
  revenueImpact: number;
  reputationImpact: 'low' | 'medium' | 'high';
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: Date;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'completed';
}

// AI-specific incident patterns
export const AI_INCIDENT_PATTERNS = {
  model: ['accuracy_degradation', 'latency_spike', 'hallucination', 'bias_detected'],
  security: ['prompt_injection', 'data_exfiltration', 'jailbreak', 'pii_exposure'],
  cost: ['budget_exceeded', 'token_spike', 'runaway_loop', 'cache_miss_storm'],
  availability: ['provider_outage', 'rate_limit', 'timeout_storm', 'circuit_open'],
  data: ['training_drift', 'embedding_corruption', 'index_stale', 'context_overflow']
} as const;

// Severity thresholds
export const SEVERITY_THRESHOLDS: SeverityCriteria[] = [
  {
    severity: 'sev1',
    userImpact: '>50% users affected',
    revenueImpact: '>$100k/hour',
    responseTime: '15 minutes',
    examples: ['Complete service outage', 'Data breach', 'All model responses failing']
  },
  {
    severity: 'sev2',
    userImpact: '10-50% users affected',
    revenueImpact: '$10k-100k/hour',
    responseTime: '30 minutes',
    examples: ['Major feature degraded', 'High error rate', 'Significant latency increase']
  },
  {
    severity: 'sev3',
    userImpact: '<10% users affected',
    revenueImpact: '<$10k/hour',
    responseTime: '4 hours',
    examples: ['Minor feature broken', 'Intermittent errors', 'Non-critical service down']
  },
  {
    severity: 'sev4',
    userImpact: 'Minimal/no user impact',
    revenueImpact: 'None',
    responseTime: 'Next business day',
    examples: ['Cosmetic issues', 'Internal tooling', 'Documentation gaps']
  }
];

// Required sections for postmortem
export const REQUIRED_POSTMORTEM_SECTIONS = [
  'summary',
  'timeline',
  'rootCause',
  'impact',
  'actionItems'
] as const;
