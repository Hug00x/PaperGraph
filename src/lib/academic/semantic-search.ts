import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingConfig } from "./embedding.ts";

// Initial BGE-M3 graph policy, checked against related/unrelated workspace examples.
// This is a cosine score cutoff, not a probability or a Litmaps setting.
export const DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD = 0.5;

export function getSemanticSimilarityThreshold() {
  const configured = process.env.SEMANTIC_SIMILARITY_THRESHOLD?.trim();
  if (!configured) return DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD;
  const threshold = Number(configured);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("SEMANTIC_SIMILARITY_THRESHOLD must be a number between 0 and 1");
  }
  return threshold;
}

export type SimilarPaper = {
  paper: { id: string; title: string; abstract: string | null; doi: string | null; openalex_id: string | null };
  similarity: number;
};

export async function getSimilarPapers(supabase: SupabaseClient, workspaceId: string, paperId: string, limit = 3): Promise<SimilarPaper[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid similarity limit (1–100)");
  const { data, error } = await supabase.rpc("get_similar_papers", {
    p_workspace_id: workspaceId, p_article_id: paperId, p_limit: limit,
    p_model: embeddingConfig().model,
  });
  if (error) throw new Error(`Semantic search failed: ${error.message}`);
  return data ?? [];
}
