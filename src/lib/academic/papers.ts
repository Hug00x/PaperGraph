import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingConfig, generateEmbedding, paperText, textHash } from "./embedding.ts";
import { abstractFromInvertedIndex, buildCitationRelations, citationProfile, resolveOpenAlexWork, type AcademicRelation } from "./openalex.ts";
import { getSimilarPapers, getSemanticSimilarityThreshold } from "./semantic-search.ts";
import { importedPdfMetadata } from "./pdf-metadata.ts";

export const paperColumns = "id,title,source,tags,abstract,openalex_id,doi,referenced_work_ids,academic_input_hash,embedding_model,embedding_input_hash";
export type PaperRow = {
  id: string; title: string; source: string | null; tags: string[];
  abstract: string | null; openalex_id: string | null; doi: string | null;
  referenced_work_ids: string[]; academic_input_hash: string | null;
  embedding_model: string | null; embedding_input_hash: string | null;
};

// Shared by the submission workflow and the CLI backfill. Reads never create embeddings.
export async function preparePaper(supabase: SupabaseClient, workspaceId: string, stored: PaperRow) {
  let paper = stored;
  const warnings: string[] = [];
  const input = { id: paper.id, title: paper.title, source: paper.source ?? "", tags: paper.tags ?? [] };
  const pdf = importedPdfMetadata(input.source);
  const isPdf = input.source.includes("papergraph-import-text:") || input.source.includes("\\includepdf");
  const metadataHash = textHash((isPdf ? "pdf-v2:" : "") + JSON.stringify(input));
  if (paper.academic_input_hash !== metadataHash) {
    try {
      let work: Awaited<ReturnType<typeof resolveOpenAlexWork>> = null;
      let lookupFailed = false;
      try {
        work = await resolveOpenAlexWork(input);
      } catch (error) {
        lookupFailed = true;
        console.warn("OpenAlex lookup failed", { articleId: paper.id, cause: error instanceof Error ? error.message : "Unknown error" });
        warnings.push("OpenAlex metadata unavailable; using saved title and abstract.");
      }
      const localMetadata = { abstract: pdf.abstract || paper.abstract, doi: pdf.doi || paper.doi };
      const metadata = work ? {
        openalex_id: work.id ?? null, openalex_title: work.title ?? work.display_name ?? null,
        doi: work.doi ?? localMetadata.doi,
        abstract: abstractFromInvertedIndex(work.abstract_inverted_index) || localMetadata.abstract,
        authors: (work.authorships ?? []).map(({ author }) => author),
        publication_year: work.publication_year ?? null, cited_by_count: work.cited_by_count ?? null,
        topics: work.topics ?? [], referenced_work_ids: work.referenced_works ?? [],
      } : localMetadata;
      // Compare-and-set prevents slow metadata requests overwriting a concurrent edit.
      let query = supabase.from("articles").update({ ...metadata, academic_input_hash: lookupFailed ? null : metadataHash })
        .eq("workspace_id", workspaceId).eq("id", paper.id).eq("title", paper.title)
        .eq("tags", `{${paper.tags.map((tag) => JSON.stringify(tag)).join(",")}}`);
      query = paper.source === null ? query.is("source", null) : query.eq("source", paper.source);
      query = paper.abstract === null ? query.is("abstract", null) : query.eq("abstract", paper.abstract);
      const { data, error } = await query.select(paperColumns).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Paper changed during metadata lookup; retry the scan");
      paper = data as PaperRow;
    } catch (error) {
      console.warn("Paper metadata update failed", { articleId: paper.id, cause: error instanceof Error ? error.message : "Unknown error" });
      warnings.push("Could not save paper metadata; retry the academic scan.");
    }
  }
  if (isPdf && !paper.abstract) {
    warnings.push("Abstract unavailable; semantic similarity uses only the title.");
  }
  const model = embeddingConfig().model;
  const hash = textHash(paperText(paper));
  if (paper.embedding_model !== model || paper.embedding_input_hash !== hash) {
    try {
      const embedding = await generateEmbedding(paperText(paper));
      let query = supabase.from("articles").update({ embedding, embedding_model: model, embedding_input_hash: hash })
        .eq("workspace_id", workspaceId).eq("id", paper.id).eq("title", paper.title);
      query = paper.abstract === null ? query.is("abstract", null) : query.eq("abstract", paper.abstract);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Paper changed during embedding generation; retry the scan");
    } catch (error) {
      console.warn("Paper embedding update failed", { articleId: paper.id, cause: error instanceof Error ? error.message : "Unknown error" });
      warnings.push(error instanceof Error ? error.message : "Embedding service unavailable");
    }
  }
  return { paper, warnings };
}

export async function refreshAcademicRelations(supabase: SupabaseClient, workspaceId: string, ids: string[], language: "en" | "pt") {
  const semanticThreshold = getSemanticSimilarityThreshold();
  const papers: PaperRow[] = [];
  const warnings = new Set<string>();
  // Bound database requests and Ollama memory consumption; never download vectors.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase.from("articles").select(paperColumns)
      .eq("workspace_id", workspaceId).in("id", ids.slice(offset, offset + 100));
    if (error) throw new Error(`Semantic search schema unavailable: ${error.message}`);
    for (const row of data ?? []) {
      const prepared = await preparePaper(supabase, workspaceId, row as PaperRow);
      papers.push(prepared.paper);
      prepared.warnings.forEach((warning) => warnings.add(warning));
    }
  }
  const profiles = papers.map((paper) => citationProfile({ ...paper, source: paper.source ?? "" }, paper));
  const citations = buildCitationRelations(profiles, language);
  const semantic: AcademicRelation[] = [];
  const seen = new Set<string>();
  const allowedIds = new Set(ids);
  let topScore: number | null = null;
  let candidates = 0;
  for (const paper of papers) {
    const neighbours = await getSimilarPapers(supabase, workspaceId, paper.id);
    for (const neighbour of neighbours) {
      if (!allowedIds.has(neighbour.paper.id) || !Number.isFinite(neighbour.similarity)) continue;
      candidates++;
      topScore = Math.max(topScore ?? -1, neighbour.similarity);
      // PostgreSQL ranks the candidates. A neighbour is not automatically a graph link.
      // Apply the minimum to the raw score, before display rounding; never fill a quota.
      if (neighbour.similarity < semanticThreshold) continue;
      const [from, to] = [paper.id, neighbour.paper.id].sort();
      const key = JSON.stringify([from, to]);
      if (seen.has(key)) continue;
      seen.add(key);
      semantic.push({ id: crypto.randomUUID(), fromArticleId: from, toArticleId: to,
        note: language === "en" ? `Semantic similarity: ${Math.round(neighbour.similarity * 100)}%.`
          : `Similaridade semântica: ${Math.round(neighbour.similarity * 100)}%.`,
        createdAt: "BGE-M3", relationType: "semantic" });
    }
  }
  return {
    relations: [...citations, ...semantic], warnings: [...warnings],
    diagnostics: { articleCount: papers.length, citationRelationCount: citations.length,
      doiArticleCount: papers.filter((paper) => paper.doi).length,
      openAlexArticleCount: papers.filter((paper) => paper.openalex_id).length,
      semanticCandidateCount: candidates, semanticRelationCount: semantic.length, semanticTopScore: topScore,
      semanticThreshold },
  };
}
