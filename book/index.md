# Building Production AI Systems

**Distributed Systems, Agentic AI, and LLM Infrastructure at Scale**

Most AI books teach you how to call a model API. This one teaches you
how to build the platform behind it: the gateway, the retrieval layer,
the agent runtime, the evaluation harness, and the operational
discipline that keeps all of it alive at 3 a.m.

It assumes you know how to write software. It does not assume you have
ever run an LLM system in production.

## Status

This book is written in the open, one chapter at a time. Chapters
appear here as they pass review. See
[OUTLINE.md](https://github.com/MandeepSinghthakur/production-ai-systems/blob/main/OUTLINE.md)
for the full table of contents and per-chapter status.

Every numeric claim in a chapter is asserted by a script in
`examples/`, and CI runs those scripts on every commit. If a chapter
says amplification reaches 2x under a retry storm, there is a test that
fails when it does not.

## Start here

- [Chapter 18 - The LLM Gateway](ch18-llm-gateway.md)
- [Chapter 19 - Multi-Provider Routing and Failover](ch19-multi-provider-routing.md)
