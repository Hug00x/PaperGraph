export const discoveryConfig = {
  provider: "openalex", version: "1", candidateCount: 30, displayCount: 10,
  queryCharacters: 2000, cacheTtlMs: 30 * 60 * 1000, fallbackTtlMs: 30000,
  embeddingCacheTtlMs: 24 * 60 * 60 * 1000, cacheEntries: 64, embeddingCacheEntries: 512,
  batchSize: 4, rerankTimeoutMs: 90000,
  weights: { semantic: 0.90, provider: 0.04, citation: 0.03, authors: 0.01, topics: 0.02 },
  semanticReasonThreshold: 0.50, highSemanticThreshold: 0.70,
} as const;
