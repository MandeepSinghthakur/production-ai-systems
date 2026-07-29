import type { Runbook, RunbookStep, RunbookExecution, StepResult, IncidentType } from './types.ts';

export class RunbookRegistry {
  private runbooks: Map<string, Runbook>;

  constructor() {
    this.runbooks = new Map();
    this.registerDefaultRunbooks();
  }

  private registerDefaultRunbooks(): void {
    // Model degradation runbook
    this.register({
      id: 'runbook-model-degradation',
      name: 'Model Degradation Response',
      incidentType: 'model',
      steps: [
        {
          order: 1,
          title: 'Verify degradation',
          description: 'Check accuracy metrics and error rates',
          commands: ['curl -s metrics.internal/model/accuracy', 'curl -s metrics.internal/model/errors'],
          checkpoints: ['Accuracy below threshold confirmed', 'Error pattern identified']
        },
        {
          order: 2,
          title: 'Enable fallback',
          description: 'Switch to backup model or cached responses',
          commands: ['kubectl set env deployment/llm-gateway FALLBACK_ENABLED=true'],
          checkpoints: ['Fallback model serving requests', 'Error rate stabilized'],
          rollbackSteps: ['kubectl set env deployment/llm-gateway FALLBACK_ENABLED=false']
        },
        {
          order: 3,
          title: 'Investigate root cause',
          description: 'Check recent deployments and data changes',
          checkpoints: ['Root cause identified', 'Fix plan documented']
        }
      ],
      escalationPath: ['on-call-ml', 'ml-lead', 'vp-engineering']
    });

    // Security incident runbook
    this.register({
      id: 'runbook-security-incident',
      name: 'Security Incident Response',
      incidentType: 'security',
      steps: [
        {
          order: 1,
          title: 'Contain the threat',
          description: 'Block malicious requests and isolate affected systems',
          commands: ['kubectl scale deployment/affected-service --replicas=0'],
          checkpoints: ['Malicious traffic blocked', 'No new exploit attempts']
        },
        {
          order: 2,
          title: 'Assess impact',
          description: 'Determine data exposure and affected users',
          checkpoints: ['Affected users identified', 'Data exposure scope determined']
        },
        {
          order: 3,
          title: 'Notify stakeholders',
          description: 'Inform security team, legal, and affected parties',
          checkpoints: ['Security team notified', 'Legal consulted if data breach']
        },
        {
          order: 4,
          title: 'Remediate',
          description: 'Apply fixes and restore service',
          checkpoints: ['Vulnerability patched', 'Service restored with monitoring']
        }
      ],
      escalationPath: ['security-on-call', 'ciso', 'ceo']
    });

    // Cost runaway runbook
    this.register({
      id: 'runbook-cost-runaway',
      name: 'Cost Runaway Response',
      incidentType: 'cost',
      steps: [
        {
          order: 1,
          title: 'Enable cost circuit breaker',
          description: 'Stop non-critical API calls to limit spending',
          commands: ['kubectl set env deployment/llm-gateway COST_LIMIT_ENABLED=true'],
          checkpoints: ['Circuit breaker active', 'Spending rate decreased']
        },
        {
          order: 2,
          title: 'Identify cost source',
          description: 'Find which feature/user is causing excessive spend',
          checkpoints: ['High-cost requests identified', 'Source tenant/feature known']
        },
        {
          order: 3,
          title: 'Apply rate limits',
          description: 'Throttle or block excessive usage',
          checkpoints: ['Rate limits applied', 'Cost within budget']
        }
      ],
      escalationPath: ['platform-on-call', 'finance', 'cto']
    });

    // Service outage runbook
    this.register({
      id: 'runbook-service-outage',
      name: 'Service Outage Response',
      incidentType: 'availability',
      steps: [
        {
          order: 1,
          title: 'Confirm outage scope',
          description: 'Verify which services and regions are affected',
          commands: ['curl -s status.internal/health', 'kubectl get pods -l app=llm-gateway'],
          checkpoints: ['Affected services identified', 'Health status known']
        },
        {
          order: 2,
          title: 'Attempt restart',
          description: 'Rolling restart of affected services',
          commands: ['kubectl rollout restart deployment/llm-gateway'],
          checkpoints: ['Services restarting', 'No crash loops'],
          rollbackSteps: ['kubectl rollout undo deployment/llm-gateway']
        },
        {
          order: 3,
          title: 'Failover to backup',
          description: 'Route traffic to backup region or provider',
          checkpoints: ['Backup region active', 'Traffic rerouted']
        }
      ],
      escalationPath: ['platform-on-call', 'platform-lead', 'vp-engineering']
    });
  }

  register(runbook: Runbook): void {
    this.runbooks.set(runbook.id, runbook);
  }

  get(id: string): Runbook | undefined {
    return this.runbooks.get(id);
  }

  findByType(type: IncidentType): Runbook[] {
    return Array.from(this.runbooks.values()).filter(r => r.incidentType === type);
  }

  list(): Runbook[] {
    return Array.from(this.runbooks.values());
  }
}

export class RunbookExecutor {
  private executions: Map<string, RunbookExecution>;

  constructor() {
    this.executions = new Map();
  }

  startExecution(runbook: Runbook, incidentId: string): RunbookExecution {
    const execution: RunbookExecution = {
      runbookId: runbook.id,
      incidentId,
      startedAt: new Date(),
      stepResults: runbook.steps.map(step => ({
        stepOrder: step.order,
        status: 'pending'
      }))
    };

    this.executions.set(`${runbook.id}-${incidentId}`, execution);
    return execution;
  }

  startStep(execution: RunbookExecution, stepOrder: number): void {
    const result = execution.stepResults.find(r => r.stepOrder === stepOrder);
    if (result) {
      result.status = 'in_progress';
      result.startedAt = new Date();
    }
  }

  completeStep(execution: RunbookExecution, stepOrder: number, notes?: string): void {
    const result = execution.stepResults.find(r => r.stepOrder === stepOrder);
    if (result) {
      result.status = 'completed';
      result.completedAt = new Date();
      if (notes) {
        result.notes = notes;
      }
    }
  }

  failStep(execution: RunbookExecution, stepOrder: number, notes?: string): void {
    const result = execution.stepResults.find(r => r.stepOrder === stepOrder);
    if (result) {
      result.status = 'failed';
      result.completedAt = new Date();
      if (notes) {
        result.notes = notes;
      }
    }
  }

  skipStep(execution: RunbookExecution, stepOrder: number, reason: string): void {
    const result = execution.stepResults.find(r => r.stepOrder === stepOrder);
    if (result) {
      result.status = 'skipped';
      result.notes = reason;
    }
  }

  isComplete(execution: RunbookExecution): boolean {
    return execution.stepResults.every(r =>
      r.status === 'completed' || r.status === 'skipped'
    );
  }

  completeExecution(execution: RunbookExecution): void {
    execution.completedAt = new Date();
  }

  getProgress(execution: RunbookExecution): {
    total: number;
    completed: number;
    percentage: number;
  } {
    const total = execution.stepResults.length;
    const completed = execution.stepResults.filter(r =>
      r.status === 'completed' || r.status === 'skipped'
    ).length;

    return {
      total,
      completed,
      percentage: Math.round((completed / total) * 100)
    };
  }

  getExecution(runbookId: string, incidentId: string): RunbookExecution | undefined {
    return this.executions.get(`${runbookId}-${incidentId}`);
  }

  validateStepOrder(runbook: Runbook, execution: RunbookExecution, stepOrder: number): boolean {
    // Can only start a step if all previous steps are completed
    for (let i = 1; i < stepOrder; i++) {
      const prevResult = execution.stepResults.find(r => r.stepOrder === i);
      if (prevResult && prevResult.status !== 'completed' && prevResult.status !== 'skipped') {
        return false;
      }
    }
    return true;
  }
}
