// Sample evaluation dataset with relevance judgments.
// This simulates a document corpus and ground-truth relevance labels
// that would come from human annotation in a real system.

import type { Document, RelevanceJudgment } from './types.ts';

// Corpus: technical documentation about cloud infrastructure
export const documents: Document[] = [
  {
    id: 'doc1',
    text: 'Kubernetes deployments manage replica sets and ensure the ' +
      'desired number of pods are running. Use deployment strategies ' +
      'like rolling updates for zero-downtime releases.',
  },
  {
    id: 'doc2',
    text: 'Docker containers package applications with their ' +
      'dependencies. Containers share the host kernel but isolate ' +
      'processes, files, and network.',
  },
  {
    id: 'doc3',
    text: 'Load balancers distribute traffic across multiple servers. ' +
      'Layer 4 balancers route by IP and port. Layer 7 balancers ' +
      'inspect HTTP headers and can route by path or host.',
  },
  {
    id: 'doc4',
    text: 'Redis is an in-memory data store used for caching and ' +
      'session management. It supports data structures like strings, ' +
      'hashes, lists, and sorted sets.',
  },
  {
    id: 'doc5',
    text: 'Kubernetes pods are the smallest deployable units. A pod ' +
      'contains one or more containers that share networking and storage.',
  },
  {
    id: 'doc6',
    text: 'Horizontal pod autoscaling adjusts replica counts based on ' +
      'CPU utilization or custom metrics. Configure HPA with target ' +
      'thresholds and stabilization windows.',
  },
  {
    id: 'doc7',
    text: 'Container orchestration platforms manage container lifecycle, ' +
      'networking, and scaling. Kubernetes is the dominant platform ' +
      'but alternatives like Nomad exist.',
  },
  {
    id: 'doc8',
    text: 'PostgreSQL is a relational database with strong ACID ' +
      'guarantees. Use connection pooling for high-concurrency ' +
      'workloads to avoid exhausting connections.',
  },
  {
    id: 'doc9',
    text: 'Service mesh architectures use sidecar proxies to handle ' +
      'cross-cutting concerns like mTLS, retries, and observability ' +
      'without application code changes.',
  },
  {
    id: 'doc10',
    text: 'Kubernetes services expose pods to network traffic. ' +
      'ClusterIP services are internal. LoadBalancer services ' +
      'provision external cloud load balancers.',
  },
  {
    id: 'doc11',
    text: 'Docker images are built in layers. Each instruction in a ' +
      'Dockerfile creates a layer. Use multi-stage builds to reduce ' +
      'final image size.',
  },
  {
    id: 'doc12',
    text: 'Caching strategies include cache-aside, read-through, and ' +
      'write-behind. Choose based on consistency requirements and ' +
      'access patterns.',
  },
  {
    id: 'doc13',
    text: 'Kubernetes ingress controllers route external HTTP traffic ' +
      'to services. Configure routing rules with path-based or ' +
      'host-based matching.',
  },
  {
    id: 'doc14',
    text: 'Container registries store and distribute container images. ' +
      'Private registries add authentication and vulnerability scanning.',
  },
  {
    id: 'doc15',
    text: 'Kubernetes namespaces provide logical separation of resources. ' +
      'Use namespaces to isolate teams or environments within a cluster.',
  },
];

// Ground truth relevance judgments from "human annotators"
// Each query has a set of documents that are genuinely relevant
export const judgments: RelevanceJudgment[] = [
  {
    queryId: 'q1',
    query: 'How do I deploy applications on Kubernetes?',
    relevantDocIds: ['doc1', 'doc5', 'doc6', 'doc7', 'doc10'],
  },
  {
    queryId: 'q2',
    query: 'What is the difference between containers and pods?',
    relevantDocIds: ['doc2', 'doc5', 'doc7', 'doc11'],
  },
  {
    queryId: 'q3',
    query: 'How does load balancing work in Kubernetes?',
    relevantDocIds: ['doc3', 'doc10', 'doc13'],
  },
  {
    queryId: 'q4',
    query: 'Which caching solutions can I use?',
    relevantDocIds: ['doc4', 'doc12'],
  },
  {
    queryId: 'q5',
    query: 'How do I scale my application automatically?',
    relevantDocIds: ['doc1', 'doc6', 'doc3'],
  },
  {
    queryId: 'q6',
    query: 'How do containers isolate processes?',
    relevantDocIds: ['doc2', 'doc11', 'doc7'],
  },
  {
    queryId: 'q7',
    query: 'What is a service mesh used for?',
    relevantDocIds: ['doc9'],
  },
  {
    queryId: 'q8',
    query: 'How do I expose my Kubernetes service externally?',
    relevantDocIds: ['doc10', 'doc13', 'doc3'],
  },
];

// Simple seeded random for deterministic noise
let seed = 12345;
function seededRandom(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed % 1000) / 10000; // Returns 0 to 0.0999
}

/**
 * Reset the random seed for reproducible results.
 */
export function resetSeed(): void {
  seed = 12345;
}

/**
 * Simulate BM25-style retrieval. In a real system this would query
 * an actual search index. Here we use term overlap as a proxy.
 */
export function simulateBM25Retrieval(
  query: string,
  docs: Document[],
  topK: number
): { docId: string; score: number; text: string }[] {
  const queryTerms = tokenize(query);

  const scored = docs.map((doc, index) => {
    const docTerms = tokenize(doc.text);
    // Simple term frequency scoring
    let score = 0;
    for (const term of queryTerms) {
      const tf = docTerms.filter((t) => t === term).length;
      if (tf > 0) {
        // BM25-ish: diminishing returns for repeated terms
        score += Math.log(1 + tf) * (1 / queryTerms.length);
      }
    }
    // Add deterministic noise based on doc index for tie-breaking
    // This simulates imperfect retrieval while being reproducible
    score += (index * 0.001);
    return { docId: doc.id, score, text: doc.text };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
