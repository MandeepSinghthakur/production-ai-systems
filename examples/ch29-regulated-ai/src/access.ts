// Role-based access control for regulated AI.
// See Chapter 29, "Building Production AI Systems".

import type { ActionType, RiskLevel, UserRole, AccessRule } from './types.ts';

/**
 * Risk level ordering for comparison.
 */
const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Default access rules.
 */
export const DEFAULT_ACCESS_RULES: AccessRule[] = [
  // Patient can only query and view recommendations
  { role: 'patient', actionType: 'query', allowed: true, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'patient', actionType: 'recommendation', allowed: true, requiresApproval: false, maxRiskLevel: 'medium' },
  { role: 'patient', actionType: 'prescription', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'patient', actionType: 'diagnosis', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'patient', actionType: 'referral', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },

  // Clinician can perform most actions
  { role: 'clinician', actionType: 'query', allowed: true, requiresApproval: false, maxRiskLevel: 'high' },
  { role: 'clinician', actionType: 'recommendation', allowed: true, requiresApproval: false, maxRiskLevel: 'high' },
  { role: 'clinician', actionType: 'prescription', allowed: true, requiresApproval: true, maxRiskLevel: 'high' },
  { role: 'clinician', actionType: 'diagnosis', allowed: true, requiresApproval: true, maxRiskLevel: 'high' },
  { role: 'clinician', actionType: 'referral', allowed: true, requiresApproval: false, maxRiskLevel: 'high' },

  // Admin can do everything but with approval for high-risk
  { role: 'admin', actionType: 'query', allowed: true, requiresApproval: false, maxRiskLevel: 'critical' },
  { role: 'admin', actionType: 'recommendation', allowed: true, requiresApproval: false, maxRiskLevel: 'critical' },
  { role: 'admin', actionType: 'prescription', allowed: true, requiresApproval: true, maxRiskLevel: 'critical' },
  { role: 'admin', actionType: 'diagnosis', allowed: true, requiresApproval: true, maxRiskLevel: 'critical' },
  { role: 'admin', actionType: 'referral', allowed: true, requiresApproval: false, maxRiskLevel: 'critical' },

  // Compliance has read-only access for auditing
  { role: 'compliance', actionType: 'query', allowed: true, requiresApproval: false, maxRiskLevel: 'critical' },
  { role: 'compliance', actionType: 'recommendation', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'compliance', actionType: 'prescription', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'compliance', actionType: 'diagnosis', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
  { role: 'compliance', actionType: 'referral', allowed: false, requiresApproval: false, maxRiskLevel: 'low' },
];

/**
 * Access check result.
 */
export interface AccessCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  maxRiskLevel: RiskLevel;
}

/**
 * Access control manager.
 */
export class AccessManager {
  private rules: Map<string, AccessRule>;
  private accessLog: Array<{
    timestamp: number;
    userId: string;
    userRole: UserRole;
    actionType: ActionType;
    riskLevel: RiskLevel;
    allowed: boolean;
    reason: string;
  }>;

  constructor(rules?: AccessRule[]) {
    this.rules = new Map();
    this.accessLog = [];

    const ruleList = rules ?? DEFAULT_ACCESS_RULES;
    for (const rule of ruleList) {
      const key = `${rule.role}:${rule.actionType}`;
      this.rules.set(key, rule);
    }
  }

  /**
   * Check if a user can perform an action.
   */
  checkAccess(
    userId: string,
    userRole: UserRole,
    actionType: ActionType,
    riskLevel: RiskLevel
  ): AccessCheckResult {
    const key = `${userRole}:${actionType}`;
    const rule = this.rules.get(key);

    if (!rule) {
      const result: AccessCheckResult = {
        allowed: false,
        requiresApproval: false,
        reason: `No access rule defined for role ${userRole} and action ${actionType}`,
        maxRiskLevel: 'low',
      };

      this.logAccess(userId, userRole, actionType, riskLevel, false, result.reason);
      return result;
    }

    // Check if action is allowed for this role
    if (!rule.allowed) {
      const result: AccessCheckResult = {
        allowed: false,
        requiresApproval: false,
        reason: `Action ${actionType} is not permitted for role ${userRole}`,
        maxRiskLevel: rule.maxRiskLevel,
      };

      this.logAccess(userId, userRole, actionType, riskLevel, false, result.reason);
      return result;
    }

    // Check risk level limit
    if (RISK_ORDER[riskLevel] > RISK_ORDER[rule.maxRiskLevel]) {
      const result: AccessCheckResult = {
        allowed: false,
        requiresApproval: false,
        reason: `Risk level ${riskLevel} exceeds maximum ${rule.maxRiskLevel} for role ${userRole}`,
        maxRiskLevel: rule.maxRiskLevel,
      };

      this.logAccess(userId, userRole, actionType, riskLevel, false, result.reason);
      return result;
    }

    // Access granted
    const result: AccessCheckResult = {
      allowed: true,
      requiresApproval: rule.requiresApproval,
      reason: 'Access granted',
      maxRiskLevel: rule.maxRiskLevel,
    };

    this.logAccess(userId, userRole, actionType, riskLevel, true, result.reason);
    return result;
  }

  /**
   * Log access check for audit.
   */
  private logAccess(
    userId: string,
    userRole: UserRole,
    actionType: ActionType,
    riskLevel: RiskLevel,
    allowed: boolean,
    reason: string
  ): void {
    this.accessLog.push({
      timestamp: Date.now(),
      userId,
      userRole,
      actionType,
      riskLevel,
      allowed,
      reason,
    });
  }

  /**
   * Get access log.
   */
  getAccessLog(): Array<{
    timestamp: number;
    userId: string;
    userRole: UserRole;
    actionType: ActionType;
    riskLevel: RiskLevel;
    allowed: boolean;
    reason: string;
  }> {
    return [...this.accessLog];
  }

  /**
   * Get denied accesses.
   */
  getDeniedAccesses(): Array<{
    timestamp: number;
    userId: string;
    userRole: UserRole;
    actionType: ActionType;
    riskLevel: RiskLevel;
    reason: string;
  }> {
    return this.accessLog
      .filter((entry) => !entry.allowed)
      .map(({ allowed, ...rest }) => rest);
  }

  /**
   * Check if a role can approve requests.
   */
  canApprove(userRole: UserRole): boolean {
    return userRole === 'clinician' || userRole === 'admin';
  }

  /**
   * Check if a role can access PII recovery.
   */
  canRecoverPII(userRole: UserRole): boolean {
    return userRole === 'compliance' || userRole === 'admin';
  }

  /**
   * Get rule for a role and action.
   */
  getRule(userRole: UserRole, actionType: ActionType): AccessRule | null {
    const key = `${userRole}:${actionType}`;
    return this.rules.get(key) ?? null;
  }

  /**
   * Clear access log (for testing).
   */
  clearLog(): void {
    this.accessLog = [];
  }
}
