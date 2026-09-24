export type ScientificIdentity = { doi?: string | null; externalId?: string | null; title: string; year?: number | null };
export type ScientificPaper = ScientificIdentity & {
  externalId: string; source: "openalex"; abstract: string; authors: { id: string; name: string }[];
  topics: { id: string; name: string }[]; references: string[]; venue: string; url: string;
  pdfUrl?: string; citationCount: number; type: string; providerScore?: number;
};
export type RecommendationReason = { type: "semantic" | "high-semantic" | "cites-seed" | "seed-cites" | "shared-references" | "authors" | "topics" | "provider" | "title-only"; count?: number };
export type RecommendedPaper = ScientificPaper & { semanticScore?: number; finalScore: number; reasons: RecommendationReason[] };
export type RecommendationQuery = { title: string; abstract: string };
export interface PaperDiscoveryProvider {
  findRelatedPaperCandidates(query: RecommendationQuery, signal?: AbortSignal): Promise<ScientificPaper[]>;
}
export type RecommendationResult = {
  papers: RecommendedPaper[]; reranking: "local" | "unavailable"; cached: boolean;
};
