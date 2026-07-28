// Data retention policy enforcement.
// See Chapter 29, "Building Production AI Systems".

import type { ActionType, RetentionPolicy } from './types.ts';

/**
 * Default retention policies by action type.
 * Values in days - these would be configured based on regulatory requirements.
 */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  {
    actionType: 'query',
    retentionDays: 30,
    requiresExplicitDeletion: false,
  },
  {
    actionType: 'recommendation',
    retentionDays: 365,
    requiresExplicitDeletion: false,
  },
  {
    actionType: 'prescription',
    retentionDays: 2555, // ~7 years for HIPAA
    requiresExplicitDeletion: true,
  },
  {
    actionType: 'diagnosis',
    retentionDays: 2555, // ~7 years for HIPAA
    requiresExplicitDeletion: true,
  },
  {
    actionType: 'referral',
    retentionDays: 365,
    requiresExplicitDeletion: false,
  },
];

/**
 * Retention policy manager.
 */
export class RetentionManager {
  private policies: Map<ActionType, RetentionPolicy>;
  private deletionLog: Array<{
    entryId: string;
    actionType: ActionType;
    deletedAt: number;
    reason: string;
  }>;

  constructor(policies?: RetentionPolicy[]) {
    this.policies = new Map();
    this.deletionLog = [];

    const policyList = policies ?? DEFAULT_RETENTION_POLICIES;
    for (const policy of policyList) {
      this.policies.set(policy.actionType, policy);
    }
  }

  /**
   * Get retention days for an action type.
   */
  getRetentionDays(actionType: ActionType): number {
    const policy = this.policies.get(actionType);
    return policy?.retentionDays ?? 30; // Default 30 days if not specified
  }

  /**
   * Check if action type requires explicit deletion approval.
   */
  requiresExplicitDeletion(actionType: ActionType): boolean {
    const policy = this.policies.get(actionType);
    return policy?.requiresExplicitDeletion ?? false;
  }

  /**
   * Calculate expiration timestamp.
   */
  calculateExpiration(actionType: ActionType, createdAt: number): number {
    const retentionDays = this.getRetentionDays(actionType);
    return createdAt + retentionDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Check if an entry should be deleted based on retention policy.
   */
  shouldDelete(
    actionType: ActionType,
    createdAt: number,
    currentTime: number
  ): boolean {
    const expiresAt = this.calculateExpiration(actionType, createdAt);
    return currentTime >= expiresAt;
  }

  /**
   * Log a deletion for audit purposes.
   */
  logDeletion(
    entryId: string,
    actionType: ActionType,
    reason: string
  ): void {
    this.deletionLog.push({
      entryId,
      actionType,
      deletedAt: Date.now(),
      reason,
    });
  }

  /**
   * Get deletion log.
   */
  getDeletionLog(): Array<{
    entryId: string;
    actionType: ActionType;
    deletedAt: number;
    reason: string;
  }> {
    return [...this.deletionLog];
  }

  /**
   * Validate retention policy compliance.
   */
  validatePolicy(actionType: ActionType): {
    valid: boolean;
    minDays: number;
    currentDays: number;
    regulation: string;
  } {
    const policy = this.policies.get(actionType);
    const currentDays = policy?.retentionDays ?? 30;

    // Minimum retention requirements by action type
    // These would be based on actual regulations (HIPAA, GDPR, etc.)
    const minRequirements: Record<ActionType, { minDays: number; regulation: string }> = {
      query: { minDays: 7, regulation: 'Internal policy' },
      recommendation: { minDays: 90, regulation: 'Internal policy' },
      prescription: { minDays: 2555, regulation: 'HIPAA - 7 years' },
      diagnosis: { minDays: 2555, regulation: 'HIPAA - 7 years' },
      referral: { minDays: 365, regulation: 'HIPAA - 1 year minimum' },
    };

    const requirement = minRequirements[actionType];
    return {
      valid: currentDays >= requirement.minDays,
      minDays: requirement.minDays,
      currentDays,
      regulation: requirement.regulation,
    };
  }

  /**
   * Get policy for an action type.
   */
  getPolicy(actionType: ActionType): RetentionPolicy | null {
    return this.policies.get(actionType) ?? null;
  }

  /**
   * Update policy (requires compliance approval in production).
   */
  updatePolicy(
    actionType: ActionType,
    retentionDays: number,
    requiresExplicitDeletion: boolean
  ): { success: boolean; error: string | null } {
    const validation = this.validatePolicyChange(actionType, retentionDays);

    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Validation failed' };
    }

    this.policies.set(actionType, {
      actionType,
      retentionDays,
      requiresExplicitDeletion,
    });

    return { success: true, error: null };
  }

  /**
   * Validate a proposed policy change.
   */
  private validatePolicyChange(
    actionType: ActionType,
    proposedDays: number
  ): { valid: boolean; error: string | null } {
    const validation = this.validatePolicy(actionType);

    // Check against current policy minimum days
    const minDays = validation.minDays;

    if (proposedDays < minDays) {
      return {
        valid: false,
        error: `Retention period ${proposedDays} days is below minimum ${minDays} days required by ${validation.regulation}`,
      };
    }

    return { valid: true, error: null };
  }

  /**
   * Clear deletion log (for testing).
   */
  clearLog(): void {
    this.deletionLog = [];
  }
}
