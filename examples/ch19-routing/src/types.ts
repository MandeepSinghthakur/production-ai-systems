// Canonical schema for multi-provider routing. See Chapter 19.

export interface ExtractionRequest {
  requestId: string;
  conversationId: string;
  tenant: string;
  residency: 'us' | 'eu';
  tier: 'standard' | 'premium';
  payload: {
    documentType: string;
    content: string;
  };
}

export interface CoverageInfo {
  effective_date: string;
  amount: number;
}

export interface ExtractionResponse {
  requestId: string;
  target: string;
  policy_id: string;
  coverage: CoverageInfo;
  // Regression case: effective_date may appear here instead of inside coverage
  effective_date?: string;
}

export interface TargetConfig {
  name: string;
  url: string;
  eligibility: {
    residency: ('us' | 'eu')[];
    tier: ('standard' | 'premium')[];
  };
  cost: number;
  latencyMs: number;
}

export interface HealthState {
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
}

export interface LedgerRecord {
  at: number;
  requestId: string;
  conversationId: string;
  tenant: string;
  target: string;
  durationMs: number;
  success: boolean;
  schemaValid: boolean;
  fieldPopulation: {
    effective_date_in_coverage: boolean;
  };
}

export interface FieldPopulationMetrics {
  total: number;
  effective_date_populated: number;
}
