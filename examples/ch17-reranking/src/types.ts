// Canonical types for re-ranking and retrieval evaluation.
// See Chapter 17, "Core Concepts".

export interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalResult {
  docId: string;
  score: number;
  text: string;
}

export interface RelevanceJudgment {
  queryId: string;
  query: string;
  relevantDocIds: string[];
}

export interface EvalMetrics {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcg: number;
}

export interface RerankerConfig {
  // Simulated latency per document in ms (cross-encoders are slow)
  latencyPerDocMs: number;
  // Quality boost factor for relevant documents (simulation parameter)
  relevanceBoost: number;
}

export interface LatencyMeasurement {
  rerankDepth: number;
  latencyMs: number;
  precisionAt5: number;
  ndcg: number;
}
