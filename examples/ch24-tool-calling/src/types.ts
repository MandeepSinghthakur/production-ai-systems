// Core types for tool calling and tool security.
// See Chapter 24, "Building Production AI Systems".

/**
 * Tool definition with JSON schema for arguments.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/**
 * Simplified JSON Schema subset for tool arguments.
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface PropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: Array<string | number>;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: PropertySchema;
}

/**
 * A tool call request from the model.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of validating a tool call.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: 'missing_required' | 'invalid_type' | 'invalid_value' | 'extra_property';
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalId?: string;
}

/**
 * Bank account representation.
 */
export interface BankAccount {
  id: string;
  name: string;
  balance: number;
  currency: string;
}

/**
 * Transfer request.
 */
export interface TransferRequest {
  fromAccount: string;
  toAccount: string;
  amount: number;
  currency: string;
  memo: string;
  idempotencyKey: string;
}

/**
 * Transfer result.
 */
export interface TransferResult {
  transferId: string;
  status: 'completed' | 'pending_approval' | 'rejected';
  fromAccount: string;
  toAccount: string;
  amount: number;
  currency: string;
  memo: string;
  idempotencyKey: string;
  createdAt: number;
  completedAt?: number;
  approvalId?: string;
  rejectionReason?: string;
}

/**
 * Approval request for high-value transfers.
 */
export interface ApprovalRequest {
  id: string;
  type: 'transfer';
  transferRequest: TransferRequest;
  requestedBy: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: number;
  reason?: string;
}

/**
 * Audit entry for tool operations.
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: AuditAction;
  toolName?: string;
  toolCallId?: string;
  idempotencyKey?: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure' | 'blocked' | 'pending';
  durationMs?: number;
}

export type AuditAction =
  | 'tool_call_received'
  | 'validation_failed'
  | 'injection_blocked'
  | 'transfer_initiated'
  | 'transfer_completed'
  | 'transfer_rejected'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'idempotency_hit';

/**
 * Sanitization result for tool arguments.
 */
export interface SanitizeResult {
  sanitized: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
  modifications: SanitizeModification[];
}

export interface SanitizeModification {
  path: string;
  type: 'stripped' | 'escaped' | 'truncated';
  original: string;
  modified: string;
}

/**
 * Actor context for audit trail.
 */
export interface ActorContext {
  userId: string;
  sessionId: string;
  ipAddress?: string;
}

/**
 * Threshold configuration for approval workflows.
 */
export interface ApprovalThresholds {
  transferAmount: number;
  currency: string;
}

/**
 * The transfer tool schema.
 */
export const TRANSFER_TOOL: ToolDefinition = {
  name: 'transfer_funds',
  description: 'Transfer funds between bank accounts',
  parameters: {
    type: 'object',
    properties: {
      from_account: {
        type: 'string',
        description: 'Source account ID',
        pattern: '^[a-zA-Z0-9_-]+$',
        maxLength: 64,
      },
      to_account: {
        type: 'string',
        description: 'Destination account ID',
        pattern: '^[a-zA-Z0-9_-]+$',
        maxLength: 64,
      },
      amount: {
        type: 'number',
        description: 'Amount to transfer in cents',
        minimum: 1,
        maximum: 100_000_000, // $1M cap
      },
      currency: {
        type: 'string',
        description: 'Currency code',
        enum: ['USD', 'EUR', 'GBP'],
      },
      memo: {
        type: 'string',
        description: 'Transfer memo',
        maxLength: 256,
      },
      idempotency_key: {
        type: 'string',
        description: 'Unique key for idempotent execution',
        pattern: '^[a-zA-Z0-9_-]+$',
        maxLength: 128,
      },
    },
    required: [
      'from_account',
      'to_account',
      'amount',
      'currency',
      'idempotency_key',
    ],
    additionalProperties: false,
  },
};

/**
 * The balance check tool schema.
 */
export const BALANCE_TOOL: ToolDefinition = {
  name: 'check_balance',
  description: 'Check the balance of a bank account',
  parameters: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        description: 'Account ID to check',
        pattern: '^[a-zA-Z0-9_-]+$',
        maxLength: 64,
      },
    },
    required: ['account_id'],
    additionalProperties: false,
  },
};
