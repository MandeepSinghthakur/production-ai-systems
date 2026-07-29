import type {
  RFC,
  RFCStatus,
  ValidationResult,
  ValidationError,
  ValidationWarning
} from './types.ts';
import { AI_CHECKLIST_CATEGORIES } from './types.ts';

export class RFCValidator {
  validate(rfc: RFC): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check required sections
    if (!rfc.context || rfc.context.trim().length === 0) {
      errors.push({
        field: 'context',
        message: 'Context section is required',
        severity: 'error'
      });
    }

    if (!rfc.decision || rfc.decision.trim().length === 0) {
      errors.push({
        field: 'decision',
        message: 'Decision section is required',
        severity: 'error'
      });
    }

    if (!rfc.consequences || rfc.consequences.length === 0) {
      errors.push({
        field: 'consequences',
        message: 'At least one consequence must be documented',
        severity: 'error'
      });
    }

    if (!rfc.alternatives || rfc.alternatives.length === 0) {
      errors.push({
        field: 'alternatives',
        message: 'At least one alternative must be documented',
        severity: 'error'
      });
    }

    // Check alternatives have tradeoffs
    for (const alt of rfc.alternatives || []) {
      if (!alt.tradeoffs || alt.tradeoffs.length === 0) {
        errors.push({
          field: `alternatives.${alt.name}`,
          message: `Alternative "${alt.name}" must have documented tradeoffs`,
          severity: 'error'
        });
      }
    }

    // Check AI checklist completeness
    const answeredCategories = new Set(
      rfc.aiChecklist
        .filter(item => item.answered)
        .map(item => item.category)
    );

    for (const category of AI_CHECKLIST_CATEGORIES) {
      if (!answeredCategories.has(category)) {
        warnings.push({
          field: 'aiChecklist',
          message: `AI checklist category "${category}" not addressed`,
          severity: 'warning'
        });
      }
    }

    // Check for reviewers if in review status
    if (rfc.status === 'review' && rfc.reviewers.length === 0) {
      warnings.push({
        field: 'reviewers',
        message: 'RFC in review status should have assigned reviewers',
        severity: 'warning'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  hasRequiredSections(rfc: RFC): boolean {
    return (
      rfc.context.trim().length > 0 &&
      rfc.decision.trim().length > 0 &&
      rfc.consequences.length > 0 &&
      rfc.alternatives.length > 0
    );
  }

  getCompletionPercentage(rfc: RFC): number {
    let score = 0;
    const total = 6;

    if (rfc.context.trim().length > 0) score++;
    if (rfc.decision.trim().length > 0) score++;
    if (rfc.consequences.length > 0) score++;
    if (rfc.alternatives.length > 0) score++;
    if (rfc.alternatives.every(a => a.tradeoffs.length > 0)) score++;
    if (rfc.aiChecklist.filter(i => i.answered).length >= 3) score++;

    return Math.round((score / total) * 100);
  }
}

export class RFCBuilder {
  private rfc: Partial<RFC>;

  constructor(id: string, title: string, author: string) {
    this.rfc = {
      id,
      title,
      author,
      status: 'draft',
      created: new Date(),
      updated: new Date(),
      context: '',
      decision: '',
      consequences: [],
      alternatives: [],
      relatedADRs: [],
      reviewers: [],
      aiChecklist: []
    };
  }

  withContext(context: string): RFCBuilder {
    this.rfc.context = context;
    this.rfc.updated = new Date();
    return this;
  }

  withDecision(decision: string): RFCBuilder {
    this.rfc.decision = decision;
    this.rfc.updated = new Date();
    return this;
  }

  addConsequence(consequence: string): RFCBuilder {
    this.rfc.consequences = this.rfc.consequences || [];
    this.rfc.consequences.push(consequence);
    this.rfc.updated = new Date();
    return this;
  }

  addAlternative(name: string, description: string): RFCBuilder {
    this.rfc.alternatives = this.rfc.alternatives || [];
    this.rfc.alternatives.push({
      name,
      description,
      tradeoffs: []
    });
    this.rfc.updated = new Date();
    return this;
  }

  addTradeoffToAlternative(
    alternativeName: string,
    dimension: string,
    benefit: string,
    cost: string
  ): RFCBuilder {
    const alt = this.rfc.alternatives?.find(a => a.name === alternativeName);
    if (alt) {
      alt.tradeoffs.push({ dimension, benefit, cost });
      this.rfc.updated = new Date();
    }
    return this;
  }

  addAIChecklistItem(
    category: 'latency' | 'cost' | 'security' | 'reliability' | 'scalability',
    question: string,
    answer?: string
  ): RFCBuilder {
    this.rfc.aiChecklist = this.rfc.aiChecklist || [];
    this.rfc.aiChecklist.push({
      category,
      question,
      answered: answer !== undefined,
      answer
    });
    this.rfc.updated = new Date();
    return this;
  }

  linkADR(adrId: string): RFCBuilder {
    this.rfc.relatedADRs = this.rfc.relatedADRs || [];
    if (!this.rfc.relatedADRs.includes(adrId)) {
      this.rfc.relatedADRs.push(adrId);
    }
    this.rfc.updated = new Date();
    return this;
  }

  addReviewer(name: string, role: string): RFCBuilder {
    this.rfc.reviewers = this.rfc.reviewers || [];
    this.rfc.reviewers.push({
      name,
      role,
      approved: null,
      comments: []
    });
    this.rfc.updated = new Date();
    return this;
  }

  build(): RFC {
    return this.rfc as RFC;
  }
}
