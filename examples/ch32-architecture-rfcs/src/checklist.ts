import type { ReviewChecklist, ChecklistItem, RFC } from './types.ts';

// AI-specific review checklist items
const AI_REVIEW_ITEMS: Omit<ChecklistItem, 'checked' | 'notes'>[] = [
  // Latency
  {
    id: 'latency-budget',
    category: 'latency',
    question: 'Is the latency budget defined (p50, p95, p99)?',
    required: true
  },
  {
    id: 'latency-breakdown',
    category: 'latency',
    question: 'Is the latency breakdown documented (model inference, network, preprocessing)?',
    required: true
  },
  // Cost
  {
    id: 'token-cost',
    category: 'cost',
    question: 'Are token costs estimated per request and monthly?',
    required: true
  },
  {
    id: 'cost-ceiling',
    category: 'cost',
    question: 'Is there a cost ceiling or circuit breaker?',
    required: true
  },
  // Security
  {
    id: 'prompt-injection',
    category: 'security',
    question: 'Are prompt injection risks addressed?',
    required: true
  },
  {
    id: 'pii-handling',
    category: 'security',
    question: 'Is PII handling documented?',
    required: false
  },
  // Reliability
  {
    id: 'failure-modes',
    category: 'reliability',
    question: 'Are failure modes documented with mitigations?',
    required: true
  },
  {
    id: 'fallback-strategy',
    category: 'reliability',
    question: 'Is there a fallback strategy when the model is unavailable?',
    required: true
  },
  // Scalability
  {
    id: 'capacity-estimate',
    category: 'scalability',
    question: 'Are capacity estimates provided (requests/sec, concurrent users)?',
    required: true
  },
  {
    id: 'scaling-triggers',
    category: 'scalability',
    question: 'Are scaling triggers defined?',
    required: false
  }
];

export class ReviewChecklistManager {
  createChecklist(rfcId: string): ReviewChecklist {
    return {
      rfcId,
      items: AI_REVIEW_ITEMS.map(item => ({
        ...item,
        checked: false
      }))
    };
  }

  checkItem(checklist: ReviewChecklist, itemId: string, notes?: string): void {
    const item = checklist.items.find(i => i.id === itemId);
    if (item) {
      item.checked = true;
      if (notes) {
        item.notes = notes;
      }
    }
  }

  uncheckItem(checklist: ReviewChecklist, itemId: string): void {
    const item = checklist.items.find(i => i.id === itemId);
    if (item) {
      item.checked = false;
      item.notes = undefined;
    }
  }

  isComplete(checklist: ReviewChecklist): boolean {
    const requiredItems = checklist.items.filter(i => i.required);
    return requiredItems.every(i => i.checked);
  }

  getCompletionStatus(checklist: ReviewChecklist): {
    total: number;
    checked: number;
    requiredTotal: number;
    requiredChecked: number;
    percentage: number;
  } {
    const total = checklist.items.length;
    const checked = checklist.items.filter(i => i.checked).length;
    const requiredItems = checklist.items.filter(i => i.required);
    const requiredTotal = requiredItems.length;
    const requiredChecked = requiredItems.filter(i => i.checked).length;

    return {
      total,
      checked,
      requiredTotal,
      requiredChecked,
      percentage: Math.round((checked / total) * 100)
    };
  }

  getUncheckedRequired(checklist: ReviewChecklist): ChecklistItem[] {
    return checklist.items.filter(i => i.required && !i.checked);
  }

  getItemsByCategory(checklist: ReviewChecklist, category: string): ChecklistItem[] {
    return checklist.items.filter(i => i.category === category);
  }

  validateAgainstRFC(checklist: ReviewChecklist, rfc: RFC): string[] {
    const issues: string[] = [];

    // Check if AI checklist in RFC covers same categories
    const rfcCategories = new Set(rfc.aiChecklist.map(i => i.category));
    const checklistCategories = new Set(checklist.items.map(i => i.category));

    for (const category of checklistCategories) {
      if (!rfcCategories.has(category as any)) {
        issues.push(`RFC does not address category: ${category}`);
      }
    }

    return issues;
  }
}

export function hasAISpecificItems(checklist: ReviewChecklist): boolean {
  const aiCategories = ['latency', 'cost', 'security', 'reliability', 'scalability'];
  const presentCategories = new Set(checklist.items.map(i => i.category));
  return aiCategories.every(c => presentCategories.has(c));
}
