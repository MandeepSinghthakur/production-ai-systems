# Appendix B — Cheat Sheets

> Quick reference cards for each part of the book. Print these, pin them
> to your monitor, or keep them in a browser tab during incident response.

---

## Cheat Sheet 1: Distributed Systems (Part I)

### Load Balancing Algorithms

| Algorithm | How it works | Best for | Avoid when |
| --- | --- | --- | --- |
| Round-robin | Sequence through backends | Uniform request duration | LLM workloads (duration varies 100x) |
| Weighted round-robin | Sequence with backend weights | Different backend capacities | Duration variance still breaks it |
| Least-connections | Pick backend with fewest active connections | Variable duration (LLM default) | Backends have different capacity |
| Weighted least-connections | Least-connections adjusted by weight | Variable duration + capacity differences | You need power-of-two-choices scale |
| Power-of-two-choices | Pick two random, choose better | Very high concurrency | Low traffic volumes |

**Rule of thumb:** Use least-connections for LLM workloads unless you have a specific reason not to.

### Redis Data Structures and Use Cases

| Structure | Commands | LLM use case | Memory cost |
| --- | --- | --- | --- |
| String | `GET`, `SET`, `INCR` | Cached responses, counters | Value + 50 bytes overhead |
| Hash | `HGET`, `HSET`, `HGETALL` | Response + metadata (tokens, timestamps) | More efficient than separate keys |
| Sorted Set | `ZADD`, `ZRANGEBYSCORE`, `ZCARD` | Sliding window rate limiting | 8 bytes per member + value |
| List | `LPUSH`, `RPOP`, `LRANGE` | Recent conversation history | 8 bytes per element |
| Set | `SADD`, `SMEMBERS`, `SISMEMBER` | Deduplication, seen message IDs | 8 bytes per member |

**Memory formula:**
```
memory_bytes = entries * (avg_value_bytes + 50) * 1.15
```
The 1.15 accounts for hash table overhead and fragmentation.

### Postgres Scaling Patterns

| Pattern | What it solves | Implementation | Watch out for |
| --- | --- | --- | --- |
| Read replicas | Read throughput | Streaming replication | Replication lag (seconds) |
| Connection pooling | Connection exhaustion | PgBouncer, Pgpool-II | Transaction mode vs session mode |
| Partitioning | Large table scans | Range/list partitioning | Cross-partition queries |
| Vertical scaling | Everything (temporarily) | Bigger instance | Cost, single point of failure |
| Horizontal sharding | Write throughput | Citus, application-level | Distributed joins |

### Connection Pooling Settings

| Setting | PgBouncer default | LLM workload recommendation | Why |
| --- | --- | --- | --- |
| `pool_mode` | session | transaction | LLM requests hold connections for seconds |
| `max_client_conn` | 100 | 1000+ | Many concurrent LLM requests |
| `default_pool_size` | 20 | 20-50 | Match Postgres `max_connections` |
| `reserve_pool_size` | 0 | 5 | Burst capacity |
| `server_idle_timeout` | 600 | 60 | Reclaim idle connections faster |

---

## Cheat Sheet 2: Event Infrastructure (Part II)

### Kafka Configuration for LLM Workloads

| Setting | Default | LLM recommendation | Why |
| --- | --- | --- | --- |
| `session.timeout.ms` | 10,000 | 120,000-180,000 | 2-3x max processing time |
| `heartbeat.interval.ms` | 3,000 | 10,000-20,000 | 1/6 of session timeout |
| `max.poll.interval.ms` | 300,000 | 600,000 | Exceeds longest possible batch |
| `max.poll.records` | 500 | 1-10 | Each record takes 10-60 seconds |
| `enable.idempotence` | false | true | Prevent duplicate messages |

**Partition count formula:**
```
partitions = peak_throughput_per_min / processing_rate_per_consumer
```
Round up to 12-24 for growth headroom.

### Outbox Pattern SQL Template

```sql
-- Transaction: domain data + outbox entry atomically
BEGIN;

INSERT INTO orders (id, customer_id, total, status)
VALUES ($1, $2, $3, 'pending');

INSERT INTO outbox (
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  created_at
) VALUES (
  gen_random_uuid(),
  'order',
  $1,
  'order_created',
  $4::jsonb,
  now()
);

COMMIT;

-- Publisher query (run separately)
SELECT id, aggregate_type, aggregate_id, event_type, payload
FROM outbox
WHERE published_at IS NULL
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

### Saga Compensation Checklist

Before implementing a saga:

- [ ] Each step has a compensating action defined
- [ ] Compensations are idempotent (safe to retry)
- [ ] Compensation order is documented (reverse of execution)
- [ ] Timeout behavior is specified for each step
- [ ] Saga state is persisted (survives restarts)
- [ ] "Unknown outcome" handling is defined (timeout != failure)
- [ ] Compensation failures trigger alerts, not silent drops

### OpenTelemetry Instrumentation Snippets

**Tracing a request:**
```typescript
const span = tracer.startSpan('llm.request', {
  attributes: {
    'llm.provider': provider,
    'llm.model': model,
    'llm.input_tokens': inputTokens,
  },
});
try {
  const result = await callLLM(request);
  span.setAttribute('llm.output_tokens', result.usage.outputTokens);
  span.setStatus({ code: SpanStatusCode.OK });
  return result;
} catch (error) {
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  throw error;
} finally {
  span.end();
}
```

**Key LLM metrics:**
```typescript
const ttftHistogram = meter.createHistogram('llm.time_to_first_token');
const totalDurationHistogram = meter.createHistogram('llm.total_duration');
const tokenCounter = meter.createCounter('llm.tokens');
const errorCounter = meter.createCounter('llm.errors');
```

---

## Cheat Sheet 3: LLM Fundamentals (Part III)

### Token Estimation Formulas

| Content type | Tokens per word | Tokens per character | Use |
| --- | --- | --- | --- |
| English prose | 1.3 | 0.25 | General text |
| Code | 1.8 | 0.35 | Source files |
| JSON | 2.5 | 0.40 | Structured data |
| Numbers/IDs | 3.0+ | 0.50+ | Order IDs, phone numbers |
| CJK text | N/A | 1.5 per character | Chinese, Japanese, Korean |

**Quick estimates:**
```
tokens ≈ characters / 4    # English prose
tokens ≈ characters / 3    # Mixed content
tokens ≈ words * 1.3       # Word-based estimate
```

**Hybrid sampling (3-8% error):**
```typescript
function estimateTokens(text: string, sampleSize = 500): number {
  const samples = [
    text.slice(0, sampleSize),                    // head
    text.slice(text.length / 2, text.length / 2 + sampleSize),  // middle
    text.slice(-sampleSize),                      // tail
  ];
  const sampleTokens = samples.map(s => exactTokenCount(s));
  const ratio = sampleTokens.reduce((a, b) => a + b) / (sampleSize * 3);
  return Math.ceil(text.length * ratio);
}
```

### Context Window Calculations

**Token budget allocation:**
```
available_input = context_limit
                - system_prompt_tokens
                - reserved_for_output
                - safety_buffer

Example (8,192 token window):
  System prompt:     500 tokens
  Output reserve:  2,000 tokens (25%)
  Safety buffer:      50 tokens
  Available input: 5,642 tokens
```

**Sliding window for conversations:**
```typescript
function fitConversation(messages: Message[], budget: number): Message[] {
  const result: Message[] = [];
  let used = 0;

  // Always include system message
  const system = messages.filter(m => m.role === 'system');
  used += system.reduce((sum, m) => sum + m.tokens, 0);

  // Add messages from most recent, backwards
  const conversation = messages.filter(m => m.role !== 'system').reverse();
  for (const msg of conversation) {
    if (used + msg.tokens > budget) break;
    result.unshift(msg);
    used += msg.tokens;
  }

  return [...system, ...result];
}
```

### TTFT vs TPS Optimization

| Metric | Definition | Optimize for | Trade-off |
| --- | --- | --- | --- |
| TTFT | Time to first token | Interactive UX | May sacrifice throughput |
| TPS | Tokens per second | Batch processing | Higher latency acceptable |

**TTFT optimization:**
- Use streaming responses (SSE)
- Reduce prompt size
- Use smaller/faster models for first response
- Pre-warm connections

**TPS optimization:**
- Batch requests where possible
- Use larger context windows efficiently
- Parallelize independent requests
- Accept buffered (non-streaming) responses

### Embedding Dimension Tradeoffs

| Dimensions | Storage (per vector) | Search speed | Quality | Use case |
| --- | --- | --- | --- | --- |
| 256 | 1 KB | Fastest | Lower | High-volume, cost-sensitive |
| 512 | 2 KB | Fast | Good | Balanced |
| 768 | 3 KB | Moderate | Better | General purpose |
| 1536 | 6 KB | Slower | Best | Accuracy-critical |
| 3072 | 12 KB | Slowest | Marginal gain | Overkill for most |

**Storage formula:**
```
storage_bytes = num_vectors * dimensions * 4
              + index_overhead (20-40%)

Example: 1M vectors @ 1536 dimensions
  Raw: 1,000,000 * 1,536 * 4 = 6.1 GB
  With index: ~8-9 GB
```

---

## Cheat Sheet 4: Retrieval (Part IV)

### Chunking Strategy Decision Tree

```
START
  │
  ├─ Is content structured (code, JSON, markdown)?
  │   ├─ Yes → Use semantic chunking (split on structure)
  │   └─ No ↓
  │
  ├─ Is content long-form prose?
  │   ├─ Yes → Use sliding window with overlap
  │   │         Size: 512-1024 tokens, Overlap: 10-20%
  │   └─ No ↓
  │
  ├─ Is content short (tweets, chat messages)?
  │   ├─ Yes → Use whole-document embedding
  │   └─ No ↓
  │
  ├─ Is retrieval latency critical?
  │   ├─ Yes → Smaller chunks (256-512 tokens)
  │   └─ No → Larger chunks (1024-2048 tokens)
  │
  └─ Default: 512 tokens with 50-token overlap
```

**Chunking parameters:**
```typescript
const CHUNK_CONFIG = {
  prose: { size: 512, overlap: 50 },
  code: { size: 256, overlap: 0, splitOn: 'function' },
  markdown: { size: 1024, overlap: 100, splitOn: 'heading' },
  chat: { size: 'whole_message', overlap: 0 },
};
```

### BM25 vs Vector Search Comparison

| Aspect | BM25 | Vector search | Hybrid |
| --- | --- | --- | --- |
| Matches | Exact keywords | Semantic meaning | Both |
| Speed | Very fast | Moderate | Slower |
| Index size | Small | Large (embeddings) | Both |
| Good for | Known terms, IDs, codes | Concepts, paraphrases | Production systems |
| Bad for | Synonyms, typos | Exact matches, rare terms | Simple use cases |
| Latency p50 | 1-5 ms | 10-50 ms | 20-80 ms |

**When to use which:**
- **BM25 only:** Legal search, code search, exact term matching
- **Vector only:** Conversational search, FAQ matching, semantic similarity
- **Hybrid:** Most production RAG systems, e-commerce, support

### Hybrid Search Weight Tuning

```typescript
// Reciprocal Rank Fusion (RRF)
function rrf(bm25Ranks: number[], vectorRanks: number[], k = 60): number[] {
  return bm25Ranks.map((_, i) => {
    const bm25Score = 1 / (k + bm25Ranks[i]);
    const vectorScore = 1 / (k + vectorRanks[i]);
    return bm25Score + vectorScore;
  });
}

// Weighted combination
function weightedHybrid(
  bm25Score: number,
  vectorScore: number,
  alpha = 0.5  // 0 = BM25 only, 1 = vector only
): number {
  return (1 - alpha) * bm25Score + alpha * vectorScore;
}
```

**Tuning guidelines:**
| Content type | Alpha (vector weight) | Why |
| --- | --- | --- |
| Technical docs | 0.3-0.4 | Exact terms matter |
| Support articles | 0.5-0.6 | Balanced |
| Conversational | 0.7-0.8 | Semantic matching dominates |
| Code | 0.2-0.3 | Identifier matching critical |

### Re-ranking Model Selection

| Model type | Latency | Quality | Cost | Use when |
| --- | --- | --- | --- | --- |
| No re-ranking | 0 ms | Baseline | Free | Latency-critical, simple queries |
| Cross-encoder (small) | 50-100 ms | Good | Low | Balanced performance |
| Cross-encoder (large) | 200-500 ms | Better | Medium | Accuracy matters |
| LLM re-ranker | 1-5 s | Best | High | Complex relevance, small candidate sets |

**Re-ranking pipeline:**
```
Query → Retriever (top 100) → Re-ranker (top 10) → LLM (top 3-5)
         ~50 ms                ~100 ms              ~2000 ms
```

---

## Cheat Sheet 5: AI Platform (Part V)

### Gateway Configuration Template

```yaml
gateway:
  # Ingress
  auth:
    type: api_key  # or jwt, oauth2
    header: X-API-Key

  # Timeouts
  upstream_timeout_ms: 120000  # 2 minutes for LLM
  idle_timeout_ms: 15000       # Heartbeat interval

  # Connection pooling
  max_connections_per_provider: 200
  connection_queue_size: 1000

  # Rate limiting (per tenant)
  rate_limit:
    type: token_budget  # not request_count
    window_ms: 60000
    default_budget: 100000  # tokens per minute

  # Circuit breaker
  breaker:
    enabled: true
    slow_call_threshold_ms: 20000
    slow_call_rate_threshold: 0.5
    min_samples: 20
    open_duration_ms: 30000

  # Retry policy
  retry:
    max_attempts: 2
    budget_ratio: 0.1  # max 10% of traffic is retries
    backoff: exponential_jitter
    retry_on: [429, 500, 502, 503, 504]
    never_after_first_byte: true
```

### Routing Strategy Comparison

| Strategy | How it works | Best for | Avoid when |
| --- | --- | --- | --- |
| Single provider | All traffic to one | Simplest, newest features | Need redundancy |
| Active-passive failover | Secondary on primary failure | Basic redundancy | Secondary untested |
| Active-active (weighted) | Split traffic by weights | Load distribution | Quality differs |
| Capability-based | Route by tier/task | Cost optimization | Simple use cases |
| Sticky routing | Pin conversations to provider | Multi-turn, caching | Single-turn workloads |
| Hedged requests | Send to 2, take first | Latency-critical | Cost-sensitive |
| Cascade (small first) | Escalate on low confidence | Cost + quality | No confidence signal |

**Routing decision order:**
```
1. Eligibility (hard filter)  → Residency, policy, capability tier
2. Health (hard filter)       → Circuit breaker state
3. Stickiness (override)      → Session affinity if healthy
4. Ranking (soft preference)  → Cost, then latency
```

### Memory Budget Calculator

```typescript
function calculateMemoryBudget(
  contextLimit: number,
  config: {
    systemPromptTokens: number;
    maxOutputTokens: number;
    historyTurns: number;
    avgTurnTokens: number;
  }
): MemoryBudget {
  const systemPrompt = config.systemPromptTokens;
  const outputReserve = config.maxOutputTokens;
  const safetyBuffer = 50;

  const available = contextLimit - systemPrompt - outputReserve - safetyBuffer;
  const historyBudget = config.historyTurns * config.avgTurnTokens;
  const currentMessageBudget = available - historyBudget;

  return {
    contextLimit,
    systemPrompt,
    historyBudget: Math.min(historyBudget, available * 0.6),
    currentMessage: Math.max(currentMessageBudget, available * 0.4),
    outputReserve,
    safetyBuffer,
  };
}
```

### Evaluation Metric Formulas

**Pass rate:**
```
pass_rate = count(score >= threshold) / total_examples
```

**LLM-as-Judge correlation (Pearson):**
```
r = Σ(judge - μ_judge)(human - μ_human) /
    √[Σ(judge - μ_judge)² * Σ(human - μ_human)²]

Threshold: r > 0.7 to trust the judge
```

**Regression detection (paired t-test):**
```
t = mean(candidate - baseline) / (std(differences) / √n)
p_value = 2 * (1 - t_cdf(|t|, df=n-1))

Regression if: delta < -threshold AND p_value < 0.05
```

**Wilson confidence interval (for pass rate):**
```
center = (successes + z²/2) / (n + z²)
margin = z * √(successes * failures / n + z²/4) / (n + z²)
interval = [center - margin, center + margin]
```

### Security Checklist

Before deploying an LLM feature:

**Input handling:**
- [ ] Prompt injection patterns blocked (XML tags, "ignore previous")
- [ ] Invisible Unicode characters stripped
- [ ] Input length limits enforced
- [ ] SQL/command injection patterns blocked in tool arguments

**Output handling:**
- [ ] PII detection before logging
- [ ] Content filtering for harmful outputs
- [ ] Structured output validation (JSON schema)
- [ ] Hallucination detection for factual claims

**Access control:**
- [ ] Per-tenant authentication
- [ ] API key rotation mechanism
- [ ] Rate limiting per tenant
- [ ] Budget caps (soft for internal, hard for external)

**Audit:**
- [ ] All requests logged with tenant, timestamp, tokens
- [ ] Tool calls logged with arguments (sanitized)
- [ ] Injection attempts logged and alerted

### Cost Estimation Formula

```typescript
function estimateMonthlyCost(
  requestsPerDay: number,
  avgInputTokens: number,
  avgOutputTokens: number,
  tier: 'frontier' | 'mid' | 'small'
): number {
  const pricing = {
    frontier: { input: 0.015, output: 0.060 },  // per 1K tokens
    mid:      { input: 0.003, output: 0.015 },
    small:    { input: 0.0001, output: 0.0002 },
  };

  const daily = requestsPerDay * (
    (avgInputTokens / 1000) * pricing[tier].input +
    (avgOutputTokens / 1000) * pricing[tier].output
  );

  return daily * 30;
}

// Example: 10,000 requests/day, 500 input, 200 output, mid tier
// = 10000 * (0.5 * 0.003 + 0.2 * 0.015) * 30
// = 10000 * 0.0045 * 30 = $1,350/month
```

---

## Cheat Sheet 6: Agentic AI (Part VI)

### Tool Definition Template

```typescript
const TOOL_DEFINITION: ToolDefinition = {
  name: 'tool_name_snake_case',
  description: 'One sentence: what this tool does and when to use it.',
  parameters: {
    type: 'object',
    properties: {
      required_param: {
        type: 'string',
        description: 'What this parameter represents',
        pattern: '^[a-zA-Z0-9_-]+$',  // Constrain format
        maxLength: 64,
      },
      optional_param: {
        type: 'number',
        description: 'What this controls',
        minimum: 0,
        maximum: 1000,
      },
      enum_param: {
        type: 'string',
        enum: ['option_a', 'option_b', 'option_c'],
        description: 'Which variant to use',
      },
      idempotency_key: {
        type: 'string',
        description: 'Unique key for this operation',
        pattern: '^[a-zA-Z0-9_-]+$',
      },
    },
    required: ['required_param', 'idempotency_key'],
    additionalProperties: false,  // Block unexpected fields
  },
};
```

### ReAct Loop Pseudocode

```
function react_loop(query, tools, max_iterations=10):
    context = [system_prompt, user_query]

    for i in range(max_iterations):
        # REASON: Model decides what to do
        response = llm.complete(context)

        if response.is_final_answer:
            return response.content

        if response.tool_call:
            # VALIDATE
            if not validate_schema(response.tool_call):
                context.append(error("Invalid tool call"))
                continue

            # SANITIZE
            sanitized = sanitize_arguments(response.tool_call)
            if sanitized.blocked:
                context.append(error("Request blocked"))
                continue

            # IDEMPOTENCY
            cached = idempotency_check(sanitized.key)
            if cached:
                context.append(tool_result(cached))
                continue

            # APPROVAL (for high-stakes)
            if requires_approval(sanitized):
                pending = create_approval_request(sanitized)
                context.append(pending_result(pending))
                continue

            # ACT: Execute the tool
            result = execute_tool(sanitized)
            cache_result(sanitized.key, result)

            # OBSERVE: Add result to context
            context.append(tool_result(result))
        else:
            # No tool call and no final answer - prompt for action
            context.append(system("Please provide a final answer or use a tool."))

    return error("Max iterations reached")
```

### MCP Server Skeleton

```typescript
// Minimal MCP server structure
import { Server } from '@modelcontextprotocol/sdk/server';

const server = new Server({
  name: 'my-mcp-server',
  version: '1.0.0',
});

// Define tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'my_tool',
      description: 'What this tool does',
      inputSchema: {
        type: 'object',
        properties: {
          param: { type: 'string', description: 'Parameter description' },
        },
        required: ['param'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'my_tool') {
    // Validate, sanitize, execute
    const result = await executeMyTool(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
server.connect(transport);
```

### Multi-Agent Patterns Comparison

| Pattern | Structure | Communication | Best for | Complexity |
| --- | --- | --- | --- | --- |
| Sequential | A → B → C | Pipeline | Workflow automation | Low |
| Hierarchical | Manager → Workers | Top-down | Task decomposition | Medium |
| Collaborative | Peer-to-peer | Broadcast | Brainstorming, review | High |
| Competitive | Independent → Judge | Results only | Diverse solutions | Medium |

**Sequential pipeline:**
```
User → Planner → Researcher → Writer → Reviewer → User
        ↓            ↓           ↓          ↓
    (outline)    (sources)    (draft)   (feedback)
```

**Hierarchical delegation:**
```
        Manager
       /   |   \
    Agent Agent Agent
      ↓     ↓     ↓
   (task) (task) (task)
      ↓     ↓     ↓
        Manager (aggregates)
```

---

## Cheat Sheet 7: System Design (Part VII)

### Capacity Planning Worksheet

```
┌─────────────────────────────────────────────────────────────┐
│ CAPACITY PLANNING WORKSHEET                                 │
├─────────────────────────────────────────────────────────────┤
│ 1. TRAFFIC ESTIMATES                                        │
│    Daily active users:        ____________                  │
│    Requests per user/day:     ____________                  │
│    Peak multiplier:           ____________ (typically 3-5x) │
│    → Peak QPS: DAU * req/user / 86400 * peak_mult           │
│                                                             │
│ 2. LATENCY REQUIREMENTS                                     │
│    p50 target:                ____________ ms               │
│    p99 target:                ____________ ms               │
│    TTFT target (streaming):   ____________ ms               │
│                                                             │
│ 3. TOKEN CONSUMPTION                                        │
│    Avg input tokens/request:  ____________                  │
│    Avg output tokens/request: ____________                  │
│    Monthly token budget:      ____________                  │
│    → Monthly cost: tokens * price_per_1K / 1000             │
│                                                             │
│ 4. CONCURRENCY (Little's Law)                               │
│    Arrival rate (QPS):        ____________                  │
│    Avg duration (seconds):    ____________                  │
│    → Concurrent connections: arrival_rate * duration        │
│                                                             │
│ 5. STORAGE                                                  │
│    Vectors (embedding store): ____________ vectors          │
│    Dimensions:                ____________                  │
│    → Vector storage: vectors * dims * 4 bytes * 1.3         │
│                                                             │
│    Conversations (history):   ____________ active           │
│    Avg conversation tokens:   ____________                  │
│    → History storage: conversations * tokens * 4 bytes      │
│                                                             │
│ 6. REDUNDANCY                                               │
│    Primary provider:          ____________                  │
│    Secondary provider:        ____________                  │
│    Failover tested:           [ ] Yes  [ ] No               │
│    Secondary quota sized for: ____________ % of traffic     │
└─────────────────────────────────────────────────────────────┘
```

### Interview Question Framework

**1. Clarify requirements (5 min):**
- What is the primary use case?
- What are the scale requirements (users, requests, data)?
- What are the latency requirements?
- What are the cost constraints?
- What compliance requirements exist?

**2. High-level design (10 min):**
- Draw the major components
- Identify the LLM touchpoints
- Show data flow
- Identify external dependencies

**3. Deep dive (15 min):**
- Pick the most interesting component
- Discuss scaling strategy
- Discuss failure modes
- Discuss trade-offs made

**4. Common AI system questions:**
- "How do you handle prompt injection?"
- "How do you control costs?"
- "What happens when the provider is slow?"
- "How do you evaluate quality?"
- "How do you handle multi-turn conversations?"

### Architecture Diagram Template

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │   Web   │  │ Mobile  │  │   API   │                      │
│  └────┬────┘  └────┬────┘  └────┬────┘                      │
│       │            │            │                            │
│       └────────────┼────────────┘                            │
│                    ▼                                         │
├──────────────────────────────────────────────────────────────┤
│                    GATEWAY LAYER                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  LLM Gateway                                          │   │
│  │  - Auth/tenant resolution                             │   │
│  │  - Rate limiting (token-based)                        │   │
│  │  - Policy enforcement                                 │   │
│  │  - Routing/failover                                   │   │
│  │  - Usage accounting                                   │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │                                  │
├──────────────────────────────────────────────────────────────┤
│                    APPLICATION LAYER                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐               │
│  │  Memory   │  │ Retrieval │  │   Tools   │               │
│  │  Service  │  │  Service  │  │  Service  │               │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘               │
│        │              │              │                       │
├──────────────────────────────────────────────────────────────┤
│                    DATA LAYER                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ Postgres │  │  Redis  │  │ Vector  │  │  Kafka  │        │
│  │ (state)  │  │ (cache) │  │   DB    │  │ (events)│        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                    EXTERNAL PROVIDERS                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │Provider │  │Provider │  │Provider │  (via Gateway)       │
│  │    A    │  │    B    │  │    C    │                      │
│  └─────────┘  └─────────┘  └─────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Cheat Sheet 8: Staff Engineering (Part VIII)

### RFC Template

```markdown
# RFC-NNN: Title

**Status:** Draft | Review | Approved | Rejected | Superseded
**Author:** name
**Created:** YYYY-MM-DD
**Reviewers:** platform-eng, security, cost-owner

## Context

Why are we doing this now? What problem does this solve?
(2-3 paragraphs)

## Decision

What specifically are we proposing?
(Detailed description with diagrams if needed)

## Consequences

What follows from this decision?
- Positive: ...
- Negative: ...
- Neutral: ...

## Alternatives Considered

### Alternative 1: [Name]
**Description:** What this alternative is
**Trade-offs:**
| Aspect | Pro | Con |
| --- | --- | --- |
| Cost | ... | ... |
| Latency | ... | ... |
| Complexity | ... | ... |

### Alternative 2: [Name]
(Same structure)

## AI Checklist

| Category | Question | Answer |
| --- | --- | --- |
| Latency | What is the p99 target? | |
| Latency | What is the TTFT target? | |
| Cost | What is the monthly token budget? | |
| Cost | Which model tier is required? | |
| Security | How is prompt injection mitigated? | |
| Security | Does this handle PII? How? | |
| Reliability | What is the fallback strategy? | |
| Reliability | What is the timeout policy? | |
| Scalability | What is the peak QPS? | |
| Scalability | Can requests be batched? | |

## Implementation Plan

1. Phase 1: ...
2. Phase 2: ...
3. Rollout: ...
```

### Incident Severity Matrix

| Severity | Impact | Response | Examples |
| --- | --- | --- | --- |
| **SEV1** | >50% users, critical system | All-hands, immediate | Gateway down, prompt injection exploit |
| **SEV2** | 10-50% users OR major system | Immediate response | Model accuracy drop, cost spike |
| **SEV3** | <10% users OR minor system | Next business day | Single tenant issue, minor feature bug |
| **SEV4** | Minimal impact | Backlog | Cosmetic issue, performance degradation |

**Escalation triggers:**
- No progress after 30 minutes → Page next tier
- Customer escalation → Bump severity
- Security implication → Involve security team immediately
- Cost impact >$10K → Involve finance

### Postmortem Template

```markdown
# Incident Postmortem: [Title]

**Date:** YYYY-MM-DD
**Severity:** SEV[1-4]
**Duration:** X hours Y minutes
**Authors:** incident-commander, primary-responder

## Summary

One paragraph: what happened, what was the impact, how was it resolved.

## Timeline

| Time (UTC) | Event |
| --- | --- |
| HH:MM | Incident started (even if detected later) |
| HH:MM | Alert fired / incident detected |
| HH:MM | Acknowledged by [name] |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Incident closed |

## Impact

- Users affected: N
- Revenue impact: $X
- Requests failed: N
- Data affected: None / Describe

## Root Cause

What was the underlying cause? (Not "the deploy broke" but "the deploy
contained a regression because the test suite did not cover X")

## Contributing Factors

What made this worse or harder to diagnose?
- Factor 1
- Factor 2

## What Went Well

- Quick detection (MTTD: X minutes)
- Runbook was accurate
- Fallback worked

## What Went Wrong

- MTTR was too long
- Runbook was out of date
- No fallback existed

## Action Items

| Item | Owner | Priority | Due Date | Status |
| --- | --- | --- | --- | --- |
| Add test for X | @engineer | P1 | YYYY-MM-DD | Open |
| Update runbook | @oncall | P2 | YYYY-MM-DD | Open |
| Add alert for Y | @platform | P2 | YYYY-MM-DD | Open |

## Lessons Learned

What should the organization learn from this incident?
```

### Technical Strategy Canvas

```
┌─────────────────────────────────────────────────────────────┐
│                 TECHNICAL STRATEGY CANVAS                   │
├─────────────────────────────────────────────────────────────┤
│ CURRENT STATE                    │ DESIRED STATE            │
│ - Where are we today?            │ - Where do we want to be?│
│ - What are our capabilities?     │ - What capabilities need?│
│ - What are our pain points?      │ - What does success look │
│ - What is our tech debt?         │   like in 12 months?     │
├─────────────────────────────────────────────────────────────┤
│ GAPS                             │ CONSTRAINTS              │
│ - What's missing?                │ - Budget                 │
│ - What skills do we lack?        │ - Timeline               │
│ - What infrastructure needed?    │ - Team size              │
│ - What tooling gaps exist?       │ - Existing commitments   │
├─────────────────────────────────────────────────────────────┤
│ INITIATIVES (prioritized)        │ METRICS                  │
│ 1. [Highest impact]              │ - How do we measure      │
│ 2. [Second priority]             │   success?               │
│ 3. [Third priority]              │ - Leading indicators     │
│ ...                              │ - Lagging indicators     │
├─────────────────────────────────────────────────────────────┤
│ DEPENDENCIES                     │ RISKS                    │
│ - What do we need from others?   │ - What could go wrong?   │
│ - What are others waiting for?   │ - Mitigation strategies  │
│ - Cross-team coordination        │ - Fallback plans         │
├─────────────────────────────────────────────────────────────┤
│ COMMUNICATION PLAN               │                          │
│ - Who needs to know?             │                          │
│ - How will we share progress?    │                          │
│ - Decision escalation path       │                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Reference: Common Formulas

```
# Concurrency (Little's Law)
concurrent_requests = arrival_rate_per_second * avg_duration_seconds

# Token cost
monthly_cost = daily_requests * 30 * (input_tokens * input_price + output_tokens * output_price) / 1000

# Redis memory
memory_gb = entries * (avg_value_bytes + 50) * 1.15 / 1e9

# Vector storage
storage_gb = num_vectors * dimensions * 4 * 1.3 / 1e9

# Kafka partitions
partitions = peak_requests_per_minute / processing_rate_per_consumer

# Session timeout
session_timeout_ms = max_processing_time_ms * 2.5

# Retry budget
max_retry_rate = 0.1 * total_request_rate

# Eval pass rate confidence (Wilson)
# Use with z=1.96 for 95% confidence
# See Cheat Sheet 5 for full formula
```
