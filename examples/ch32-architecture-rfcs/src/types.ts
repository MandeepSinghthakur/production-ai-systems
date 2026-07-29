// RFC status lifecycle
export type RFCStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'superseded';

// RFC structure
export interface RFC {
  id: string;
  title: string;
  status: RFCStatus;
  author: string;
  created: Date;
  updated: Date;
  context: string;
  decision: string;
  consequences: string[];
  alternatives: Alternative[];
  relatedADRs: string[];
  reviewers: Reviewer[];
  aiChecklist: AIChecklistItem[];
}

export interface Alternative {
  name: string;
  description: string;
  tradeoffs: Tradeoff[];
}

export interface Tradeoff {
  dimension: string;
  benefit: string;
  cost: string;
}

export interface Reviewer {
  name: string;
  role: string;
  approved: boolean | null;
  comments: string[];
}

export interface AIChecklistItem {
  category: 'latency' | 'cost' | 'security' | 'reliability' | 'scalability';
  question: string;
  answered: boolean;
  answer?: string;
}

// Architecture Decision Record
export interface ADR {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'deprecated' | 'superseded';
  context: string;
  decision: string;
  consequences: string[];
  date: Date;
  supersededBy?: string;
  relatedRFCs: string[];
}

// Validation results
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error';
}

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'warning';
}

// Review checklist
export interface ReviewChecklist {
  rfcId: string;
  items: ChecklistItem[];
  completedAt?: Date;
}

export interface ChecklistItem {
  id: string;
  category: string;
  question: string;
  required: boolean;
  checked: boolean;
  notes?: string;
}

// Workflow transition
export interface StatusTransition {
  from: RFCStatus;
  to: RFCStatus;
  timestamp: Date;
  actor: string;
  reason?: string;
}

// AI-specific checklist categories
export const AI_CHECKLIST_CATEGORIES = [
  'latency',
  'cost',
  'security',
  'reliability',
  'scalability'
] as const;

// Required RFC sections
export const REQUIRED_RFC_SECTIONS = [
  'context',
  'decision',
  'consequences',
  'alternatives'
] as const;

// Valid status transitions
export const VALID_TRANSITIONS: Record<RFCStatus, RFCStatus[]> = {
  draft: ['review'],
  review: ['approved', 'rejected', 'draft'],
  approved: ['superseded'],
  rejected: ['draft'],
  superseded: []
};
