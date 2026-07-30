# Preface

## Who This Book Is For

This book is for software engineers building production AI systems. Not researchers writing papers. Not data scientists training models. Engineers who deploy systems that serve real users, handle real money, and break at 3 AM.

You should already know how to write code, debug distributed systems, and operate production services. This book assumes you can read TypeScript, understand HTTP, and have opinions about databases. It does not assume you have built AI systems before.

If you are a senior engineer moving into AI infrastructure, this book is for you. If you are a staff engineer responsible for your company's AI platform, this book is for you. If you are preparing for system design interviews at AI-focused companies, this book is for you.

If you want to understand how transformers work mathematically, read the original papers. If you want to fine-tune models, read Hugging Face tutorials. If you want to build reliable systems that use AI as a component, keep reading.

## Why This Book Exists

Most AI books teach you how to call APIs. This book teaches you what breaks when you do.

The gap between a working demo and a production system is enormous. A chatbot that works in a notebook fails when ten users hit it simultaneously. A retrieval system that finds relevant documents in testing returns garbage when the corpus grows. A cost estimate based on development usage is wrong by 10x in production.

This book exists because nobody told me these things when I started building AI systems. I learned them by breaking things, by reading incident reports, and by talking to engineers who had broken the same things before me. This book is the guide I wish I had.

## How This Book Is Different

Three things distinguish this book from others on the market.

**First, every claim is tested.** When this book says that retry storms amplify load by 2x, there is a runnable example that demonstrates it. When it says that chunking at 512 tokens produces different recall than chunking at 256 tokens, there is code that measures both. The examples are not illustrations—they are assertions. If the numbers in the prose do not match the numbers in the code, the build fails.

**Second, interview preparation is integrated, not appended.** Each chapter ends with interview questions and staff-level answers. The questions test the same concepts the chapter teaches. You do not need to read the whole book and then start a separate interview prep process. By the time you finish a chapter, you can answer questions about its topic.

**Third, the book is organized by what breaks, not by what exists.** Traditional books organize by technology: a chapter on vector databases, a chapter on embeddings, a chapter on agents. This book organizes by failure mode: what happens when your retrieval pipeline returns garbage, what happens when your LLM provider has an outage, what happens when your costs exceed your budget. The structure reflects how production engineers actually think about systems.

## How to Read This Book

The book has eight parts. You do not need to read them in order.

**Parts I and II** cover distributed systems and event infrastructure. If you already operate production systems at scale, skim these. They frame classic concepts in the context of AI workloads—40-second request latencies, token-based capacity, streaming responses—but the fundamentals are the same.

**Part III** covers LLM fundamentals: how transformers serve requests, how tokenization works, how embeddings represent meaning. Read this if you want to understand why AI systems behave the way they do. Skip it if you just want to use them.

**Part IV** covers retrieval: document ingestion, chunking, vector search, re-ranking. Read this if you are building RAG systems. The chapters build on each other, so read them in order.

**Part V** is the core of the book. Gateways, routing, memory, evaluation, security, cost control. Every production AI system needs these components. Read this part completely.

**Part VI** covers agentic AI: tool calling, planning, multi-agent systems. Read this if you are building agents. The security implications are significant—do not skip the sections on prompt injection.

**Part VII** contains system design walkthroughs. Each chapter is a complete design exercise: requirements, capacity estimates, architecture, trade-offs. Use these to prepare for interviews or as templates for real designs.

**Part VIII** covers staff engineering: architecture reviews, incident management, technical strategy. Read this if you are responsible for technical direction, not just implementation.

## Running the Examples

Every chapter has runnable code in the `examples/` directory. The examples require Node.js 22.6 or later and nothing else—no Docker, no API keys, no package installation. Run them like this:

```bash
node examples/ch18-llm-gateway/scripts/lab.mjs
```

Each lab prints assertions as it runs. If something fails, the lab tells you what was expected and what was observed. The labs are the source of truth for the book's claims.

## Acknowledgments

This book was written in the open, with code committed before prose. The examples came first; the explanations followed. This approach caught two significant errors before publication:

The original chapter on retrieval claimed that canonicalizing money amounts improved recall. The measurement showed it did not—BM25 treats the canonical token as one term among many, so a distractor sharing substrings can still outrank the correct document. The lesson changed from "canonicalize your data" to "use filters for constraints."

The original chapter on gateways claimed that retry storms amplify load by 3x. The measurement showed 2x. More importantly, it revealed that brownouts produce no storm at all unless the gateway has an upstream timeout—the timeout is what converts a latency problem into a load problem.

Neither error would have been caught by reading the code. Measurement found them.

## A Note on AI Assistance

This book was written with AI assistance. Claude helped with research, editing, and code review. Every claim was verified by running the examples. Every number comes from measurements, not from model outputs.

The irony is not lost on me: a book about building reliable AI systems, written with help from an AI system. The experience reinforced the book's central theme. AI is a powerful tool. It is also a tool that can be confidently wrong. The examples and assertions exist because trust must be verified.

## Feedback

If you find errors, please report them. If you build something using concepts from this book, I would like to hear about it. If you are preparing for an interview and the questions helped, let me know.

The book's repository is public. Issues and pull requests are welcome.
