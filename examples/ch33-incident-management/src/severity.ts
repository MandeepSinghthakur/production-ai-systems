import type { Severity, Incident, SeverityCriteria } from './types.ts';
import { SEVERITY_THRESHOLDS } from './types.ts';

export interface SeverityScore {
  severity: Severity;
  score: number;
  factors: SeverityFactor[];
  criteria: SeverityCriteria;
}

export interface SeverityFactor {
  name: string;
  value: number | string;
  weight: number;
  contribution: number;
}

export class SeverityScorer {
  score(incident: Partial<Incident>): SeverityScore {
    const factors: SeverityFactor[] = [];
    let totalScore = 0;

    // Factor 1: User impact (0-40 points)
    const userImpact = incident.impactedUsers || 0;
    const userFactor = this.scoreUserImpact(userImpact);
    factors.push(userFactor);
    totalScore += userFactor.contribution;

    // Factor 2: Service criticality (0-30 points)
    const services = incident.impactedServices || [];
    const serviceFactor = this.scoreServiceCriticality(services);
    factors.push(serviceFactor);
    totalScore += serviceFactor.contribution;

    // Factor 3: Incident type (0-20 points)
    const typeFactor = this.scoreIncidentType(incident.type || 'availability');
    factors.push(typeFactor);
    totalScore += typeFactor.contribution;

    // Factor 4: Time sensitivity (0-10 points)
    const timeFactor = this.scoreTimeSensitivity(incident.detectedAt);
    factors.push(timeFactor);
    totalScore += timeFactor.contribution;

    // Map score to severity
    const severity = this.mapScoreToSeverity(totalScore);
    const criteria = SEVERITY_THRESHOLDS.find(t => t.severity === severity)!;

    return {
      severity,
      score: totalScore,
      factors,
      criteria
    };
  }

  private scoreUserImpact(users: number): SeverityFactor {
    let contribution: number;

    if (users > 10000) {
      contribution = 40;
    } else if (users > 1000) {
      contribution = 30;
    } else if (users > 100) {
      contribution = 20;
    } else if (users > 10) {
      contribution = 10;
    } else {
      contribution = 5;
    }

    return {
      name: 'user_impact',
      value: users,
      weight: 0.4,
      contribution
    };
  }

  private scoreServiceCriticality(services: string[]): SeverityFactor {
    const criticalServices = ['llm-gateway', 'payment-service', 'auth-service', 'model-inference'];
    const criticalCount = services.filter(s => criticalServices.includes(s)).length;

    let contribution: number;
    if (criticalCount >= 2) {
      contribution = 30;
    } else if (criticalCount === 1) {
      contribution = 20;
    } else if (services.length > 3) {
      contribution = 15;
    } else {
      contribution = 5;
    }

    return {
      name: 'service_criticality',
      value: `${criticalCount} critical, ${services.length} total`,
      weight: 0.3,
      contribution
    };
  }

  private scoreIncidentType(type: string): SeverityFactor {
    const typeScores: Record<string, number> = {
      security: 20,
      availability: 18,
      cost: 15,
      model: 12,
      data: 10
    };

    const contribution = typeScores[type] || 10;

    return {
      name: 'incident_type',
      value: type,
      weight: 0.2,
      contribution
    };
  }

  private scoreTimeSensitivity(detectedAt?: Date): SeverityFactor {
    if (!detectedAt) {
      return {
        name: 'time_sensitivity',
        value: 'unknown',
        weight: 0.1,
        contribution: 5
      };
    }

    const hour = detectedAt.getHours();
    const isBusinessHours = hour >= 9 && hour <= 17;
    const dayOfWeek = detectedAt.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    let contribution: number;
    if (isWeekday && isBusinessHours) {
      contribution = 10; // Peak hours
    } else if (isWeekday) {
      contribution = 7; // Off-hours weekday
    } else {
      contribution = 4; // Weekend
    }

    return {
      name: 'time_sensitivity',
      value: isBusinessHours ? 'business_hours' : 'off_hours',
      weight: 0.1,
      contribution
    };
  }

  private mapScoreToSeverity(score: number): Severity {
    if (score >= 80) return 'sev1';
    if (score >= 60) return 'sev2';
    if (score >= 40) return 'sev3';
    return 'sev4';
  }

  getSeverityThreshold(severity: Severity): SeverityCriteria {
    return SEVERITY_THRESHOLDS.find(t => t.severity === severity)!;
  }

  validateSeverity(incident: Incident): boolean {
    const calculated = this.score(incident);
    return calculated.severity === incident.severity;
  }
}
