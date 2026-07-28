# Chapter 30 - Design: A Coding Agent

Demonstrates the design of a coding agent with sandboxed execution,
code validation, context management, and tool permission enforcement.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all thirteen steps with 45 assertions, exits non-zero if any fail.
Takes about one second.

## The key insights

1. **Syntax validation before execution.** Generated code must be parseable
   before it runs. A syntax error caught at validation costs nothing; a
   syntax error at runtime wastes a sandbox invocation.

2. **Destructive patterns blocked at multiple layers.** `rm -rf`, `DROP TABLE`,
   and similar commands are caught in code validation AND tool execution.
   Defense in depth means no single bypass compromises safety.

3. **Sandbox isolation prevents path escape.** The sandbox validates all
   paths before access. Parent directory traversal (`../`), system
   directories (`/etc/`), and home directory access (`~/`) are blocked.

4. **Context budget enforces prioritization.** With limited tokens, the
   agent must choose which files to include. High-relevance files come
   first; low-relevance files are truncated.

5. **Tool permissions are explicit.** Read-only agents cannot write files.
   Write-enabled agents cannot execute commands. Each permission level
   is a separate configuration choice.

## Layout

```
src/
  types.ts        Core types: AgentTool, SandboxConfig, CodeContext
  generator.ts    Code generation simulation
  validator.ts    Syntax and safety validation
  sandbox.ts      Sandboxed execution with resource limits
  context.ts      Codebase context management
  tools.ts        Tool definitions and permission enforcement
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Code generation with syntax validation |
| 2 | Destructive command detection (rm -rf, DROP TABLE) |
| 3 | Sandbox path escape prevention |
| 4 | Context budget enforcement and prioritization |
| 5 | Tool permission enforcement (read vs write vs execute) |
| 6 | Tool argument validation |
| 7 | Destructive command blocking in tool execution |
| 8 | Sandbox execution limits (timeout, memory) |
| 9 | Context relevance scoring |
| 10 | File summarization for token savings |
| 11 | Combined validation flow (generate -> validate -> execute) |
| 12 | Code block parsing from model responses |
| 13 | Token estimation |

## Defense layers

A coding agent has multiple opportunities to block dangerous operations:

```
1. Code generation  - Model prompted to avoid dangerous patterns
2. Syntax validation - Reject unparseable code
3. Safety validation - Block destructive patterns in code
4. Tool validation   - Check arguments against schema
5. Tool permissions  - Restrict available operations
6. Sandbox checks    - Validate paths before access
7. Sandbox execution - Enforce resource limits
```

Each layer catches what the previous layer missed. A complete bypass requires
defeating all seven.

## Sandbox boundaries

The sandbox restricts:

- **Paths**: Only workspace paths allowed. System directories blocked.
- **Commands**: Destructive commands blocked by pattern match.
- **Time**: Execution timeout prevents infinite loops.
- **Memory**: Memory limit prevents exhaustion.
- **Files**: File operation limit prevents disk exhaustion.

## Things worth breaking on purpose

- Remove the path validation and observe what traversal attacks become
  possible.

- Change the permission level to `['read', 'write', 'execute', 'system']`
  and observe all tools become available.

- Increase the context budget to 100,000 tokens and observe all files
  included without truncation.

- Add a new destructive pattern to the validator and verify it blocks.

- Create a code generator response that looks safe but contains a time
  bomb (e.g., code that deletes files after a delay).
