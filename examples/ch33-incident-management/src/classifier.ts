import type { IncidentType, Incident } from './types.ts';
import { AI_INCIDENT_PATTERNS } from './types.ts';

export interface ClassificationResult {
  type: IncidentType;
  confidence: number;
  matchedPatterns: string[];
  suggestedRunbook?: string;
}

export class IncidentClassifier {
  private keywords: Map<IncidentType, string[]>;

  constructor() {
    this.keywords = new Map([
      ['model', ['accuracy', 'hallucination', 'latency', 'inference', 'prediction', 'response quality', 'model', 'embedding']],
      ['security', ['injection', 'jailbreak', 'pii', 'exfiltration', 'unauthorized', 'breach', 'attack', 'exploit']],
      ['cost', ['budget', 'token', 'spending', 'cost', 'billing', 'expensive', 'overage', 'runaway']],
      ['availability', ['outage', 'down', 'unavailable', 'timeout', 'rate limit', 'circuit', 'provider', '503', '504']],
      ['data', ['drift', 'stale', 'corruption', 'index', 'training', 'dataset', 'embedding', 'vector']]
    ]);
  }

  classify(incident: Partial<Incident>): ClassificationResult {
    const text = `${incident.title || ''} ${incident.description || ''}`.toLowerCase();
    const scores = new Map<IncidentType, number>();
    const matchedPatterns = new Map<IncidentType, string[]>();

    for (const [type, keywords] of this.keywords) {
      let score = 0;
      const matches: string[] = [];

      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += 1;
          matches.push(keyword);
        }
      }

      // Check AI-specific patterns
      const patterns = AI_INCIDENT_PATTERNS[type];
      for (const pattern of patterns) {
        const patternText = pattern.replace(/_/g, ' ');
        if (text.includes(patternText)) {
          score += 2; // Patterns worth more
          matches.push(pattern);
        }
      }

      scores.set(type, score);
      matchedPatterns.set(type, matches);
    }

    // Find highest scoring type
    let bestType: IncidentType = 'availability';
    let bestScore = 0;

    for (const [type, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    // Calculate confidence
    const totalScore = Array.from(scores.values()).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? bestScore / totalScore : 0;

    // Suggest runbook based on type
    const suggestedRunbook = this.getSuggestedRunbook(bestType);

    return {
      type: bestType,
      confidence: Math.round(confidence * 100) / 100,
      matchedPatterns: matchedPatterns.get(bestType) || [],
      suggestedRunbook
    };
  }

  private getSuggestedRunbook(type: IncidentType): string {
    const runbookMap: Record<IncidentType, string> = {
      model: 'runbook-model-degradation',
      security: 'runbook-security-incident',
      cost: 'runbook-cost-runaway',
      availability: 'runbook-service-outage',
      data: 'runbook-data-integrity'
    };
    return runbookMap[type];
  }

  classifyByImpactedServices(services: string[]): IncidentType {
    const serviceTypeMap: Record<string, IncidentType> = {
      'llm-gateway': 'availability',
      'embedding-service': 'model',
      'vector-db': 'data',
      'security-scanner': 'security',
      'billing-service': 'cost',
      'model-inference': 'model',
      'rate-limiter': 'availability',
      'audit-service': 'security'
    };

    const typeCounts = new Map<IncidentType, number>();

    for (const service of services) {
      const type = serviceTypeMap[service] || 'availability';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }

    let bestType: IncidentType = 'availability';
    let bestCount = 0;

    for (const [type, count] of typeCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestType = type;
      }
    }

    return bestType;
  }
}
