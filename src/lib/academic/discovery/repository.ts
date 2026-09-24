import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { importedPdfMetadata } from "../pdf-metadata.ts";
import { DiscoveryError } from "../openalex-client.ts";
import { articleIdentity, discoveredMetadata, openAlexId, samePaper, normalizeDoi, recommendedArticleSource } from "./identity.ts";
import { openAlexDiscovery, normalizeOpenAlexWork } from "./openalex-provider.ts";
import type { ScientificPaper } from "./types.ts";
import type { WorkspaceArticle } from "../../workspace-data.ts";

export type DiscoveryRow = { id: string; title: string; source: string | null; tags: string[]; abstract: string | null;
  doi: string | null; openalex_id: string | null; openalex_title: string | null; authors: unknown;
  publication_year: number | null; topics: unknown; referenced_work_ids: string[];
  embedding: unknown; embedding_model: string | null; embedding_input_hash: string | null };
export const seedColumns = "id,title,source,tags,abstract,doi,openalex_id,openalex_title,authors,publication_year,topics,referenced_work_ids,embedding,embedding_model,embedding_input_hash";
export const identityColumns = "id,title,source,tags,doi,openalex_id,publication_year";
export async function scientificSeed(row: DiscoveryRow, signal?: AbortSignal): Promise<ScientificPaper> {
  const imported = discoveredMetadata(row.source ?? "");
  if (imported) return imported;
  const pdf = importedPdfMetadata(row.source ?? "");
  const identity = articleIdentity(row);
  // Resolve by scientific ID, never search with a custom node label or private source text.
  if ((!row.openalex_title || !row.abstract) && (identity.externalId || identity.doi)) {
    try {
      const found = await openAlexDiscovery.lookup(identity.externalId || identity.doi!, signal);
      if (found) return { ...found, abstract: found.abstract || pdf.abstract || row.abstract || "" };
    } catch (error) { signal?.throwIfAborted(); if (!row.openalex_title && !pdf.title) throw error; }
  }
  const title = row.openalex_title || pdf.title || (row.abstract?.trim() ? row.title : "");
  if (!title) throw new DiscoveryError("insufficient-metadata");
  if (!row.openalex_title && !pdf.title && !row.abstract?.trim()) throw new DiscoveryError("insufficient-metadata");
  if (!row.openalex_title && !pdf.title) {
    return { source: "openalex", externalId: "", title, abstract: row.abstract!.trim(), doi: identity.doi || null,
      year: row.publication_year, authors: [], topics: [], references: [], venue: "", url: "", citationCount: 0, type: "" };
  }
  const metadata = normalizeOpenAlexWork({ id: row.openalex_id || "W0", title, doi: identity.doi,
    publication_year: row.publication_year, authorships: Array.isArray(row.authors) ? row.authors.map((author: unknown) => ({ author })) : [],
    topics: row.topics, referenced_works: row.referenced_work_ids });
  if (!metadata) throw new DiscoveryError("insufficient-metadata");
  return { ...metadata, externalId: openAlexId(row.openalex_id) || "", abstract: pdf.abstract || row.abstract || "" };
}
export async function workspaceIdentities(supabase: SupabaseClient, workspaceId: string) {
  const rows: Array<Parameters<typeof articleIdentity>[0] & { id: string }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("articles").select(identityColumns).eq("workspace_id", workspaceId).order("id").range(offset, offset + 499);
    if (error) throw new DiscoveryError("workspace-unavailable");
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export function stableRecommendationId(workspaceId: string, paper: ScientificPaper) {
  const hex = createHash("sha256").update(`${workspaceId}:${paper.doi ? normalizeDoi(paper.doi) : paper.externalId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function prepareRecommendedArticle(workspaceId: string, paper: ScientificPaper, existing: Array<Parameters<typeof articleIdentity>[0] & { id: string }>) {
  const duplicate = existing.find((article) => samePaper(paper, articleIdentity(article)));
  if (duplicate) return { existingId: duplicate.id, article: null };
  const article: WorkspaceArticle = { id: stableRecommendationId(workspaceId, paper), title: paper.title,
    abstract: paper.abstract,
    author: paper.authors.map((author) => author.name).slice(0, 3).join(", ") || "PaperGraph",
    status: "Published", updatedAt: "agora", tags: ["OpenAlex", ...(paper.doi ? [normalizeDoi(paper.doi)] : [])],
    source: recommendedArticleSource(paper) };
  return { existingId: null, article };
}
