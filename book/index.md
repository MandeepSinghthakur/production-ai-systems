# Building Production AI Systems

A technical book on designing, building, and operating production AI systems.

## About This Book

This book teaches software engineers how to build production AI systems. Not demos. Not notebooks. Systems that serve real users, handle real money, and break at 3 AM.

**34 chapters** organized into eight parts:

1. **Distributed Systems Foundations** - What changes when a single request takes 40 seconds
2. **Data and Event Infrastructure** - Kafka, outbox patterns, observability
3. **LLM Fundamentals** - Transformers, tokenization, embeddings, streaming
4. **Retrieval** - Document ingestion, chunking, vector search, re-ranking
5. **The AI Platform** - Gateways, routing, memory, evaluation, security, cost control
6. **Agentic AI** - Tool calling, planning, MCP, multi-agent systems
7. **System Design** - Complete design walkthroughs with capacity estimates
8. **Staff Engineering** - Architecture reviews, incident management, technical strategy

## What Makes This Book Different

**Every claim is tested.** When this book says that retry storms amplify load by 2x, there is runnable code that demonstrates it. The examples are assertions, not illustrations. If the numbers in prose do not match the numbers in code, the build fails.

**Interview preparation is integrated.** Each chapter ends with interview questions and staff-level answers. By the time you finish a chapter, you can answer questions about its topic.

**Organized by what breaks.** Traditional books organize by technology. This book organizes by failure mode: what happens when your retrieval pipeline returns garbage, when your provider has an outage, when your costs exceed your budget.

## Running the Examples

Every chapter has runnable code. No API keys required. No Docker. Just Node.js 22.6+.

```bash
# Clone the repository
git clone https://github.com/MandeepSinghthakur/production-ai-systems
cd production-ai-systems

# Run any chapter's lab
node examples/ch18-llm-gateway/scripts/lab.mjs
```

Each lab prints assertions as it runs. The examples are the source of truth.

## Getting Started

- [Preface](preface.md) - Who this book is for
- [How to Read This Book](how-to-read.md) - Three reading paths
- [Chapter 1](ch01-distributed-systems.md) - Start reading

## Links

- [GitHub Repository](https://github.com/MandeepSinghthakur/production-ai-systems)
- [Report Issues](https://github.com/MandeepSinghthakur/production-ai-systems/issues)
