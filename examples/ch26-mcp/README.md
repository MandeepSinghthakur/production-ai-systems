# Chapter 26 - The Model Context Protocol

Demonstrates MCP server implementation: capability negotiation, tool execution
with permission scopes, resource access control, sandboxing, and prompt
injection protection.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all eight steps with 30+ assertions, exits non-zero if any fail.
Takes about two seconds (includes a session expiration test).

## The key insight

MCP standardizes how AI applications connect to external tools and data.
But standardization without security is worse than no standardization -
it creates a documented attack surface. A production MCP server needs:

1. Capability negotiation to limit what clients can do
2. Permission scopes to enforce access control
3. Schema validation to reject malformed requests
4. Response scanning to block injection via tools
5. Sandboxing to contain runaway tool execution
6. Session management with expiration

Skip any layer and you create a hole an attacker will find.

## Layout

```
src/
  types.ts       Core types: ToolDefinition, ResourceDefinition, MCPSession
  permissions.ts Permission scope enforcement and session management
  tools.ts       Tool registration, validation, execution, injection scanning
  resources.ts   Resource providers for text, binary, and structured data
  sandbox.ts     Tool execution sandboxing with timeouts
  server.ts      MCP server implementation tying it all together
  client.ts      MCP client for testing server functionality
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | MCP server exposes resources with different types |
| 2 | Tool permissions enforced (read scope can't call admin tools) |
| 3 | Capability negotiation (client and server agree on features) |
| 4 | Injection via tool blocked (response scanning catches attacks) |
| 5 | Resource access controlled (scope limits what you can read) |
| 6 | Tool schema validation (malformed calls rejected) |
| 7 | Sandbox execution (timeouts, input validation) |
| 8 | Session management (expiration, scope checking) |

## Permission scopes

Scopes form a hierarchy:

| Scope | Level | Includes |
| --- | --- | --- |
| read | 1 | Read-only access |
| write | 2 | Read + write access |
| execute | 3 | Read + write + execute |
| admin | 4 | All permissions |

Higher scopes include lower ones. Admin can do everything; read can only read.

## Injection protection

Tool responses are scanned for prompt injection patterns:

- Direct overrides: "ignore previous instructions"
- Delimiter attacks: `<system>`, `[INST]`
- Role manipulation: "you are now a different assistant"

If detected, the tool call fails instead of returning the malicious content.

## Things worth breaking on purpose

- Remove the `scanToolResponses: true` config and observe that the injection
  test passes (the malicious content is returned to the client).

- Grant a client `admin` scope and observe that all tools become accessible.

- Set `maxExecutionMs: 10` in the sandbox and observe that even fast tools
  timeout.

- Remove schema validation and observe that invalid arguments reach handlers.

- Set session duration to 0 and observe that sessions expire immediately.

## Production considerations

This example simulates MCP behavior without network transport. In production:

1. Use proper JSON-RPC transport over stdio or SSE
2. Implement rate limiting per client
3. Add audit logging for all tool calls
4. Use real sandboxing (VM2, isolated-vm, or containers)
5. Sign capability negotiation to prevent replay
6. Rotate session tokens regularly
