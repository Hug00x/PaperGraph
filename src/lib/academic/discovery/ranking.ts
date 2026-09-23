import { discoveryConfig as config } from "./config.ts";
import { normalizeDoi } from "./identity.ts";
import type { RecommendedPaper, RecommendationReason, ScientificPaper } from "./types.ts";

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== 1024 || b.length !== a.length) throw new Error("Invalid embedding dimensions");
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error("Invalid embedding");
    dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2;
  }
  if (!normA || !normB) throw new Error("Zero embedding");
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}
export function rankRecommendations(seed: ScientificPaper, papers: ScientificPaper[], similarities?: number[]): RecommendedPaper[] {
  // Provider score scales may differ by query. Ordinal rank avoids mixing raw scales.
  const providerOrder = [...papers].sort((a, b) => (b.providerScore ?? 0) - (a.providerScore ?? 0) || a.externalId.localeCompare(b.externalId));
  return papers.map((paper, i) => {
    const provider = 1 - providerOrder.indexOf(paper) / Math.max(1, papers.length - 1);
    const common = (a: string[], b: string[]) => new Set(a.filter((id) => id && b.includes(id))).size;
    const authors = common(seed.authors.map((a) => a.id), paper.authors.map((a) => a.id));
    const topics = common(seed.topics.map((t) => t.id), paper.topics.map((t) => t.id));
    const references = common(seed.references, paper.references);
    const citesSeed = paper.references.includes(seed.externalId);
    const seedCites = seed.references.includes(paper.externalId);
    const semantic = similarities?.[i];
    const reasons: RecommendationReason[] = [];
    if (semantic !== undefined && semantic >= config.semanticReasonThreshold) reasons.push({ type: semantic >= config.highSemanticThreshold ? "high-semantic" : "semantic" });
    if (citesSeed) reasons.push({ type: "cites-seed" });
    if (seedCites) reasons.push({ type: "seed-cites" });
    if (references) reasons.push({ type: "shared-references", count: references });
    if (authors) reasons.push({ type: "authors", count: authors });
    if (topics) reasons.push({ type: "topics", count: topics });
    if (!reasons.length) reasons.push({ type: "provider" });
    if (!paper.abstract) reasons.push({ type: "title-only" });
    const w = config.weights;
    const finalScore = semantic === undefined ? provider : w.semantic * Math.max(0, semantic) + w.provider * provider +
      w.citation * Number(citesSeed || seedCites) + w.authors * Math.min(1, authors) +
      w.topics * (topics / Math.max(1, new Set([...seed.topics, ...paper.topics].map((t) => t.id)).size));
    return { ...paper, semanticScore: semantic, finalScore, reasons };
  }).sort((a, b) => b.finalScore - a.finalScore || (b.providerScore ?? 0) - (a.providerScore ?? 0) ||
    (b.year ?? 0) - (a.year ?? 0) || (normalizeDoi(a.doi ?? "") + a.externalId).localeCompare(normalizeDoi(b.doi ?? "") + b.externalId));
}
