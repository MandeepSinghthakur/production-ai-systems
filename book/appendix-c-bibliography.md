# Appendix C — Annotated Bibliography

> A curated list of the papers, books, and documentation that shaped this book,
> organized by topic and annotated with why each is worth your time.

---

This is not a comprehensive reading list. It is a selective one. Every entry
here either (a) introduced a concept this book depends on, (b) provides depth
beyond what the chapters cover, or (c) is the canonical source you should cite
when someone asks where a claim comes from.

Papers are listed with their original publication venue. Where a foundational
paper has been superseded by better exposition elsewhere, both are noted.

---

## Foundational Texts

These are the books that cover prerequisite material. If you struggled with
Part I, start here.

**Kleppmann, Martin. *Designing Data-Intensive Applications*. O'Reilly, 2017.**
The definitive guide to distributed systems fundamentals. Covers replication,
partitioning, consistency models, and stream processing with more rigor than
any book before or since. Essential reading before Part I. Referenced in
Ch 1-9.

**Beyer, Betsy, et al. *Site Reliability Engineering: How Google Runs
Production Systems*. O'Reilly, 2016.**
The original SRE book. Introduces error budgets, SLO-based alerting, and
the toil reduction framework. The incident management chapter (Ch 33) draws
heavily on these principles, but adapted for systems where the model provider
is outside your blast radius. Referenced in Ch 9, 18, 33.

**Reilly, Tanya. *The Staff Engineer's Path*. O'Reilly, 2022.**
The best treatment of what staff-level work actually looks like: architecture
reviews, technical strategy, influence without authority. Part VIII is a
direct application of Reilly's framework to AI systems. Referenced in
Ch 32-34.

**Fowler, Martin. *Patterns of Enterprise Application Integration*.
Addison-Wesley, 2003.**
Older than some readers, but the messaging patterns (pipes and filters,
content-based router, dead letter channel) remain the vocabulary for
event-driven architecture. Read before Ch 7-8.

**Newman, Sam. *Building Microservices*. 2nd ed. O'Reilly, 2021.**
Covers service decomposition, API design, and distributed transactions. The
saga pattern in Ch 8 originates here, though the book's treatment is broader.
Referenced in Ch 1-3, 7-8.

---

## Distributed Systems

Papers that define the protocols and algorithms underneath modern
infrastructure.

**Ongaro, Diego, and John Ousterhout. "In Search of an Understandable
Consensus Algorithm." USENIX ATC, 2014.**
The Raft paper. Consensus made comprehensible. If you run anything with
leader election (Kafka, Redis Sentinel, etcd), you are running Raft or
something descended from it. Required reading for Ch 1 and Ch 6.

**DeCandia, Giuseppe, et al. "Dynamo: Amazon's Highly Available Key-Value
Store." SOSP, 2007.**
Introduced consistent hashing, vector clocks, sloppy quorums, and hinted
handoff. The lineage runs directly to Cassandra, DynamoDB, and Riak. Read
for historical context on Ch 4's discussion of Redis Cluster.

**Kreps, Jay, Neha Narkhede, and Jun Rao. "Kafka: A Distributed Messaging
System for Log Processing." NetDB, 2011.**
The original Kafka paper. Short, clear, and still accurate on the core
design: append-only logs, consumer groups, partition-based parallelism.
Essential reading for Ch 6.

**Lakshman, Avinash, and Prashant Malik. "Cassandra: A Decentralized
Structured Storage System." LADIS, 2009.**
Explains the Dynamo-inspired replication model. Useful background for
understanding why wide-column stores scale writes differently than Postgres.
Context for Ch 5.

**Lamport, Leslie. "Time, Clocks, and the Ordering of Events in a
Distributed System." CACM, 1978.**
The paper that started distributed systems theory. Logical clocks and
happens-before are the foundation for understanding why distributed
transactions are hard. Background for Ch 1 and Ch 8.

**Bailis, Peter, et al. "Highly Available Transactions: Virtues and
Limitations." VLDB, 2013.**
Explains what ACID guarantees you can actually get in a distributed system
without coordination. Clarifies why the outbox pattern (Ch 8) exists.

---

## Machine Learning Infrastructure

The papers that define how modern LLMs work and how to run them.

**Vaswani, Ashish, et al. "Attention Is All You Need." NeurIPS, 2017.**
The transformer paper. Every LLM in production today descends from this
architecture. Ch 10 is a practitioner's gloss on this paper; read the
original for the math. Referenced in Ch 10-13.

**Devlin, Jacob, et al. "BERT: Pre-training of Deep Bidirectional
Transformers for Language Understanding." NAACL, 2019.**
Introduced masked language modeling and the encoder-only architecture that
powers most embedding models. Background for Ch 12.

**Brown, Tom, et al. "Language Models are Few-Shot Learners." NeurIPS, 2020.**
The GPT-3 paper. Established that scale produces emergent capabilities and
introduced in-context learning as a paradigm. Context for why frontier
models behave differently than mid-tier ones.

**Hoffmann, Jordan, et al. "Training Compute-Optimal Large Language Models."
arXiv, 2022.**
The Chinchilla paper. Demonstrates that most models are undertrained relative
to their size, and derives compute-optimal scaling laws. Explains why model
sizes are converging and training data is the bottleneck.

**Kaplan, Jared, et al. "Scaling Laws for Neural Language Models." arXiv,
2020.**
The first rigorous scaling laws paper. Loss scales predictably with compute,
data, and parameters. Essential for understanding capacity planning (Ch 23)
and why throwing more hardware at inference is often the answer.

**Pope, Reiner, et al. "Efficiently Scaling Transformer Inference." MLSys,
2023.**
Covers KV-cache optimization, batching strategies, and memory bandwidth
constraints. The production context for Ch 10's discussion of why inference
is memory-bound.

**Kwon, Woosuk, et al. "Efficient Memory Management for Large Language
Model Serving with PagedAttention." SOSP, 2023.**
Introduces vLLM's paged attention mechanism. Explains how modern serving
systems avoid the quadratic memory cost of attention. Deep background for
Ch 10.

---

## Retrieval and Search

Papers on the algorithms that power retrieval pipelines.

**Robertson, Stephen, and Hugo Zaragoza. "The Probabilistic Relevance
Framework: BM25 and Beyond." Foundations and Trends in Information
Retrieval, 2009.**
The canonical treatment of BM25. Still the strongest lexical baseline after
30 years. Required reading for Ch 15-16.

**Malkov, Yury, and Dmitry Yashunin. "Efficient and Robust Approximate
Nearest Neighbor Using Hierarchical Navigable Small World Graphs."
IEEE TPAMI, 2018.**
The HNSW paper. The algorithm behind most production vector search (FAISS,
Milvus, Qdrant, Weaviate). Essential for understanding the trade-offs in
Ch 16.

**Johnson, Jeff, Matthijs Douze, and Herve Jegou. "Billion-Scale Similarity
Search with GPUs." IEEE TBD, 2019.**
The FAISS paper. Covers inverted file indices, product quantization, and
GPU acceleration. Useful if you are building rather than buying vector
search.

**Khattab, Omar, and Matei Zaharia. "ColBERT: Efficient and Effective
Passage Search via Contextualized Late Interaction over BERT." SIGIR, 2020.**
Introduced late interaction for dense retrieval. The reranking architecture
in Ch 17 is a simplified version of this idea.

**Wang, Liang, et al. "Text Embeddings by Weakly-Supervised Contrastive
Pre-training." arXiv, 2022.**
The E5 paper. Describes the training procedure behind many modern embedding
models. Context for why embedding quality varies across domains (Ch 12).

**Nogueira, Rodrigo, and Kyunghyun Cho. "Passage Re-ranking with BERT."
arXiv, 2019.**
The paper that established neural reranking as a practical technique.
Background for Ch 17.

**Lewis, Patrick, et al. "Retrieval-Augmented Generation for Knowledge-
Intensive NLP Tasks." NeurIPS, 2020.**
The RAG paper. Coined the term and established the pattern. Part IV is an
extended treatment of how to make this work in production.

---

## AI Safety and Security

Papers on prompt injection, alignment, and adversarial attacks.

**Perez, Favio, and Ian Ribeiro. "Ignore This Title and HackAPrompt:
Exposing Systemic Vulnerabilities of LLMs Through a Global-Scale Prompt
Hacking Competition." arXiv, 2023.**
The largest-scale study of prompt injection attacks. Catalogs attack
patterns and success rates. Required reading for Ch 22.

**Greshake, Kai, et al. "Not What You've Signed Up For: Compromising
Real-World LLM-Integrated Applications with Indirect Prompt Injection."
arXiv, 2023.**
Defines indirect prompt injection (malicious instructions in retrieved
content) and demonstrates attacks on real systems. Essential for Ch 22
and Ch 24.

**OWASP. "OWASP Top 10 for Large Language Model Applications." 2023.**
The standard reference for LLM security risks. Covers prompt injection,
data leakage, insecure output handling, and supply chain vulnerabilities.
Referenced throughout Part V.

**Bai, Yuntao, et al. "Constitutional AI: Harmlessness from AI Feedback."
arXiv, 2022.**
Describes the RLAIF approach to alignment. Background for understanding
why frontier models refuse certain requests and how guardrails work.

**Zou, Andy, et al. "Universal and Transferable Adversarial Attacks on
Aligned Language Models." arXiv, 2023.**
Demonstrates automated jailbreak generation via gradient-based search.
Shows that alignment can be brittle. Context for defense-in-depth
arguments in Ch 22.

---

## Production ML

Papers and reports on operating ML systems at scale.

**Sculley, D., et al. "Hidden Technical Debt in Machine Learning Systems."
NeurIPS, 2015.**
The "ML is the tiny box in the middle" paper. Lists the operational
complexity that surrounds production ML: configuration, data dependencies,
feedback loops, monitoring. Required reading before Part V.

**Lakshmanan, Valliappa, Sara Robinson, and Michael Munn. *Machine Learning
Design Patterns*. O'Reilly, 2020.**
Catalog of reusable patterns for ML systems: feature stores, model
versioning, data validation. The gateway pattern (Ch 18) and the evaluation
pipeline pattern (Ch 21) draw from this vocabulary.

**Polyzotis, Neoklis, et al. "Data Lifecycle Challenges in Production
Machine Learning." SIGMOD Record, 2018.**
Focuses on data quality, schema drift, and validation. Explains why
data pipelines (Ch 14) require more care than application code.

**Paleyes, Andrei, Raoul-Gabriel Urma, and Neil Lawrence. "Challenges in
Deploying Machine Learning: A Survey of Case Studies." NeurIPS, 2022.**
A meta-analysis of deployment failures. Useful for calibrating expectations
about what goes wrong and how often.

---

## Observability and Operations

References for metrics, tracing, and incident response.

**OpenTelemetry Project. "OpenTelemetry Specification." CNCF, ongoing.**
The authoritative source for OTLP, semantic conventions, and SDK behavior.
Ch 9's implementation follows this specification. Keep a bookmark; it
updates frequently.

**Majors, Charity, Liz Fong-Jones, and George Miranda. *Observability
Engineering*. O'Reilly, 2022.**
The best treatment of observability as a discipline (as opposed to "logs,
metrics, and traces"). Defines high-cardinality telemetry and explains
why traditional monitoring fails for distributed systems. Background for
Ch 9.

**Sridharan, Cindy. *Distributed Systems Observability*. O'Reilly, 2018.**
Shorter and more tactical than Majors et al. Good introduction to the
three pillars and when to use each.

**Allspaw, John, and Jesse Robbins. *Web Operations*. O'Reilly, 2010.**
Older but foundational. Introduces blameless postmortems, graceful
degradation, and operational maturity. Background for Ch 33.

---

## Agentic Systems

Papers on tool use, planning, and multi-agent orchestration.

**Yao, Shunyu, et al. "ReAct: Synergizing Reasoning and Acting in Language
Models." ICLR, 2023.**
Introduced the ReAct pattern: interleaving reasoning traces with tool
calls. The foundation for Ch 25's planning architecture.

**Schick, Timo, et al. "Toolformer: Language Models Can Teach Themselves
to Use Tools." arXiv, 2023.**
Demonstrates that models can learn to call external tools via self-
supervision. Context for why tool calling (Ch 24) works as well as it does.

**Anthropic. "Model Context Protocol Specification." 2024.**
The MCP spec. Defines the JSON-RPC interface for tool discovery and
invocation. Ch 26 is an implementation guide; this is the reference.

**Park, Joon Sung, et al. "Generative Agents: Interactive Simulacra of
Human Behavior." USENIX, 2023.**
The Stanford "small town" paper. Demonstrates long-horizon agent behavior
with memory and reflection. Background for Ch 27's multi-agent discussion.

**Wu, Qingyun, et al. "AutoGen: Enabling Next-Gen LLM Applications via
Multi-Agent Conversation." arXiv, 2023.**
Describes the multi-agent conversation framework. Context for orchestration
patterns in Ch 27.

---

## System Design References

Resources for the design walkthrough chapters.

**Xu, Alex. *System Design Interview: An Insider's Guide*. Vol. 1 and 2.
Byte by Byte, 2020 and 2022.**
The standard interview prep resource. The design chapters (Part VII)
follow a similar structure but are specific to AI workloads.

**Nygard, Michael. *Release It!* 2nd ed. Pragmatic Bookshelf, 2018.**
Covers stability patterns (circuit breakers, bulkheads, timeouts) with
production war stories. The gateway's fail-open/fail-closed decisions
(Ch 18) draw from this vocabulary.

**Burns, Brendan. *Designing Distributed Systems*. O'Reilly, 2018.**
Patterns for distributed systems design using containers. The sidecar
and ambassador patterns appear in Ch 28-31.

---

## Tools and Frameworks

Documentation and comparisons for infrastructure you will actually use.

**Redis. "Redis Cluster Specification." redis.io.**
The authoritative source for hash slots, resharding, and failover. Read
before attempting anything in Ch 4 that involves more than one node.

**Apache Kafka. "Kafka Design Documentation." kafka.apache.org.**
The official design doc. Covers log compaction, exactly-once semantics,
and transaction semantics. Reference for Ch 6.

**PostgreSQL. "PostgreSQL Documentation." postgresql.org.**
Specifically the chapters on MVCC, indexing, and EXPLAIN output. Ch 5
assumes you can read an EXPLAIN plan; this teaches you.

**FAISS Wiki. "Guidelines to Choose an Index." GitHub.**
Practical guidance on when to use IVF vs HNSW vs brute force. Useful
when implementing Ch 16's hybrid search.

---

## Further Exploration

These are beyond the scope of the book but worth knowing exist.

**Rae, Jack, et al. "Scaling Language Models: Methods, Analysis, and
Insights from Training Gopher." arXiv, 2022.**
Exhaustive analysis of scaling behavior across capabilities. If you want
to understand why some tasks improve predictably with scale and others do
not, start here.

**Wei, Jason, et al. "Chain-of-Thought Prompting Elicits Reasoning in
Large Language Models." NeurIPS, 2022.**
Established chain-of-thought as a prompting technique. Background for
the reasoning traces in Ch 25.

**Bubeck, Sebastien, et al. "Sparks of Artificial General Intelligence:
Early Experiments with GPT-4." arXiv, 2023.**
An extensive capability evaluation of a frontier model. Useful for
calibrating expectations about what models can and cannot do.

**Raffel, Colin, et al. "Exploring the Limits of Transfer Learning with
a Unified Text-to-Text Transformer." JMLR, 2020.**
The T5 paper. Introduced the text-to-text framing that most modern models
use. Background for understanding encoder-decoder vs decoder-only tradeoffs.

---

## How to Use This Bibliography

For each part of the book:

| Part | Start With |
| --- | --- |
| I (Distributed Systems) | Kleppmann, then Ongaro (Raft), then Kreps (Kafka) |
| II (Events) | Fowler, then the Kafka design docs |
| III (LLM Fundamentals) | Vaswani, then Kaplan (scaling laws) |
| IV (Retrieval) | Robertson (BM25), Malkov (HNSW), Lewis (RAG) |
| V (AI Platform) | Sculley (ML debt), OWASP Top 10, OpenTelemetry spec |
| VI (Agentic) | Yao (ReAct), Schick (Toolformer), MCP spec |
| VII (System Design) | Xu (system design), Nygard (stability patterns) |
| VIII (Staff Engineering) | Reilly, then the SRE book's postmortem chapter |

Papers age. Check publication dates before citing. Where this bibliography
lists an arXiv preprint, there is often a peer-reviewed version with
corrections; prefer the latter.
