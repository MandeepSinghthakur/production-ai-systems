# How to Read This Book

## Three Reading Paths

This book supports three ways of reading, depending on your goals and time.

### Path 1: The Full Journey (2-3 weeks)

Read front to back. Each part builds on the previous one. By the end, you will understand how to design, build, and operate production AI systems.

**Week 1**: Parts I-III (Chapters 1-13)
- Distributed systems foundations
- Data and event infrastructure
- LLM fundamentals

**Week 2**: Parts IV-VI (Chapters 14-27)
- Retrieval and RAG
- The AI platform layer
- Agentic AI

**Week 3**: Parts VII-VIII (Chapters 28-34)
- System design walkthroughs
- Staff engineering skills

### Path 2: Interview Prep (1 week)

Focus on the chapters most likely to appear in system design interviews.

**Days 1-2**: Core platform
- Chapter 18: The LLM Gateway
- Chapter 19: Multi-Provider Routing
- Chapter 23: Cost Control

**Days 3-4**: Retrieval
- Chapter 14: Document Ingestion
- Chapter 16: Vector Search
- Chapter 17: Re-ranking

**Days 5-6**: System design
- Chapter 28: Conversational Assistant
- Chapter 30: Coding Agent
- Chapter 31: Multi-Tenant Platform

**Day 7**: Review interview questions from each chapter

### Path 3: Reference (Ongoing)

Use the book as a reference when building specific components.

| Building... | Read... |
|-------------|---------|
| RAG pipeline | Chapters 14-17 |
| LLM gateway | Chapters 18-19 |
| Agent system | Chapters 24-27 |
| Cost controls | Chapter 23 |
| Security layer | Chapter 22 |
| Evaluation pipeline | Chapter 21 |

## Running the Examples

Every chapter has runnable code. No API keys required. No Docker. Just Node.js 22.6+.

```bash
# Clone the repository
git clone https://github.com/USERNAME/production-ai-systems
cd production-ai-systems

# Run any chapter's lab
node examples/ch18-llm-gateway/scripts/lab.mjs
```

Each lab prints assertions as it runs:

```
Step 1 - gateway routes requests
  [PASS] request routed to provider
         expected true, observed true

...

13/13 checks passed
```

If an assertion fails, the lab shows what was expected and what was observed. The examples are the source of truth—if the prose says one thing and the code says another, trust the code.

## Chapter Structure

Every chapter follows the same structure:

1. **Learning Objectives** - What you will be able to do after reading
2. **The Production Story** - A scenario illustrating why this matters
3. **Why This Exists** - Historical context and motivation
4. **Core Concepts** - Definitions you need to know
5. **Internal Architecture** - How the system works (with diagrams)
6. **Production Design** - Concrete guidance for real systems
7. **Failure Scenarios** - What breaks and how to fix it
8. **Scaling Strategy** - How the approach changes at scale
9. **Trade-offs** - Decisions and their costs
10. **Code Walkthrough** - Annotated examples
11. **Hands-On Lab** - Instructions for running the code
12. **Interview Questions** - Questions you might be asked
13. **Staff-Level Answers** - How to answer at staff level
14. **Exercises** - Practice problems
15. **Further Reading** - Where to learn more

You can read sections out of order. If you just want interview prep, skip to sections 12-13. If you want to understand the theory, focus on sections 3-5. If you want to build something, start with sections 6 and 10-11.

## Conventions

**Code blocks** contain runnable TypeScript. File paths appear in comments:

```typescript
// examples/ch18-llm-gateway/src/gateway.ts
export class Gateway {
  async route(request: Request): Promise<Response> {
    // ...
  }
}
```

**Diagrams** use Mermaid syntax and render in the web version.

**Capability tiers** replace specific model names:
- `frontier` = most capable models (highest cost, best quality)
- `mid` = balanced models (moderate cost and quality)
- `small` = efficient models (lowest cost, fastest)

This avoids the book becoming outdated when model names change.

**Constructed scenarios** use "Consider a..." phrasing:
- "Consider a fintech company building fraud detection..."
- "Consider a healthcare startup deploying a patient assistant..."

These are teaching examples, not case studies.

## Prerequisites

This book assumes you can:

- Read TypeScript (or JavaScript with type annotations)
- Understand HTTP, REST, and basic networking
- Debug distributed systems (logs, traces, metrics)
- Operate production services (deployment, monitoring, on-call)

It does not assume you have:

- Built AI systems before
- Trained machine learning models
- Used specific AI frameworks or libraries

## Getting Help

If you find errors, open an issue on the repository. If something is unclear, check if the example code clarifies it—the labs often demonstrate edge cases that the prose only mentions.

The repository accepts pull requests for fixes. Significant changes should be discussed in an issue first.
