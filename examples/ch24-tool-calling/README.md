# Chapter 24 - Tool Calling and Tool Security

Demonstrates secure tool execution for a banking transfer scenario with
idempotency, approval workflows, injection resistance, and audit logging.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all five steps with 17 assertions, exits non-zero if any fail.
Takes about one second.

## The key insights

1. **Idempotency keys prevent duplicate execution.** Same key, same result,
   even if the model retries. Balance changes only once.

2. **Approval workflows gate high-stakes operations.** Transfers above
   $10,000 require human approval. The model can initiate but not complete.

3. **Schema validation rejects malformed calls.** Wrong types, missing
   fields, invalid enums - caught before any business logic runs.

4. **Input sanitization blocks injection attempts.** SQL injection, command
   injection, prompt injection - detected and blocked, logged for review.

5. **Every operation is audited.** Timestamp, actor, action, result.
   Enough detail for forensics, not so much that logs become a liability.

## Layout

```
src/
  types.ts        Core types: ToolDefinition, TransferRequest, AuditEntry
  bank.ts         Account balances, transfer execution
  idempotency.ts  Idempotency key tracking
  approval.ts     Approval workflow for large transfers
  audit.ts        Audit trail logging
  sanitizer.ts    Tool argument sanitization
  validator.ts    Schema validation
  executor.ts     Orchestrates all guards for safe execution
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Idempotency: same key returns same result, balance changes once |
| 2 | Approval gating: >$10k requires approval, <$10k executes immediately |
| 3 | Injection blocked: SQL, command, and prompt injection attempts rejected |
| 4 | Schema validation: invalid calls rejected before execution |
| 5 | Audit completeness: every operation logged with required fields |

## Execution order

When a tool call arrives, the executor processes it in this order:

```
1. Schema validation   - Reject malformed calls
2. Input sanitization  - Block or clean dangerous content
3. Idempotency check   - Return cached result if duplicate
4. Approval check      - Defer high-value operations
5. Business logic      - Execute the transfer
6. Audit logging       - Record everything
```

Each stage can reject the call. Rejections are logged with the reason.

## Approval workflow

Transfers over the threshold don't execute immediately:

```
Model requests transfer of $20,000
  -> Executor creates ApprovalRequest
  -> Returns {status: 'pending_approval', approvalId: '...'}
  -> Balance unchanged

Human reviews and approves
  -> Executor completes the transfer
  -> Balance updated
  -> Result stored in idempotency cache
```

If the model retries with the same idempotency key while pending, it gets
the pending result. After approval, it gets the completed result. The
idempotency key ensures consistency.

## Injection patterns blocked

The sanitizer blocks these patterns in string arguments:

- **SQL injection:** `'; DROP TABLE` or `OR 1=1`
- **Command injection:** `$(...)` or `` `...` `` or `; rm -rf`
- **Path traversal:** `../` sequences
- **Prompt injection:** `<system>`, `[INST]`, `ignore previous instructions`
- **Control characters:** null bytes, invisible Unicode

Blocked calls return an error and log an `injection_blocked` audit entry.

## Things worth breaking on purpose

- Lower the approval threshold to $1 and observe all transfers require
  approval.

- Send a transfer with the same idempotency key but different amounts and
  observe the original amount is returned (idempotency wins).

- Add a new injection pattern to the sanitizer and verify it blocks.

- Remove the `finally` block from a transfer and observe what happens when
  execution fails mid-operation (hint: audit trail becomes incomplete).
