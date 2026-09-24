import type { ScientificIdentity, ScientificPaper } from "./types.ts";
import { importedPdfMetadata } from "../pdf-metadata.ts";

export function normalizeDoi(value: string) {
  return value.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[.,;:]+$/, "").toLowerCase();
}
export function normalizeTitle(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function openAlexId(value: string | null | undefined) {
  const match = value?.match(/^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i);
  return match ? `https://openalex.org/${match[1].toUpperCase()}` : null;
}
export function samePaper(a: ScientificIdentity, b: ScientificIdentity) {
  if (a.doi && b.doi && normalizeDoi(a.doi) === normalizeDoi(b.doi)) return true;
  if (openAlexId(a.externalId) && openAlexId(a.externalId) === openAlexId(b.externalId)) return true;
  // Do not merge distinct DOI records solely because a short title happens to match.
  if (a.doi && b.doi) return false;
  const title = normalizeTitle(a.title);
  return title.length >= 12 && title === normalizeTitle(b.title) && (!a.year || !b.year || a.year === b.year);
}
export function uniqueNewPapers<T extends ScientificIdentity>(papers: T[], excluded: ScientificIdentity[]) {
  const kept: T[] = [];
  for (const paper of papers) if (![...excluded, ...kept].some((other) => samePaper(paper, other))) kept.push(paper);
  return kept;
}
export function safePublicationUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; }
  catch { return ""; }
}
const marker = /^% papergraph-discovery:(\S+)$/m;
export function discoveredMetadata(source: string): ScientificPaper | null {
  try {
    const raw: unknown = JSON.parse(decodeURIComponent(source.match(marker)?.[1] ?? ""));
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<ScientificPaper>;
    if (value.source !== "openalex" || !openAlexId(value.externalId) || typeof value.title !== "string" ||
        typeof value.abstract !== "string" || !Array.isArray(value.authors) || !Array.isArray(value.topics) || !Array.isArray(value.references)) return null;
    if (value.title.length > 1000 || value.abstract.length > 16000 ||
        !value.authors.every((a) => a && typeof a.name === "string" && typeof a.id === "string") ||
        !value.topics.every((t) => t && typeof t.id === "string" && typeof t.name === "string") ||
        !value.references.every((r) => typeof r === "string")) return null;
    return { ...value, doi: value.doi ? normalizeDoi(value.doi) : null,
      pdfUrl: safePublicationUrl(value.pdfUrl), url: safePublicationUrl(value.url) } as ScientificPaper;
  } catch { return null; }
}
export function articleIdentity(article: { title: string; source?: string | null; tags?: string[]; doi?: string | null; openalex_id?: string | null; publication_year?: number | null }): ScientificIdentity {
  const imported = discoveredMetadata(article.source ?? "");
  const pdf = importedPdfMetadata(article.source ?? "");
  return { title: imported?.title || pdf.title || article.title,
    doi: article.doi || imported?.doi || pdf.doi || article.tags?.find((tag) => /^10\.\d{4,9}\//.test(normalizeDoi(tag))),
    externalId: article.openalex_id || imported?.externalId, year: article.publication_year || imported?.year };
}
export function recommendedArticleSource(paper: ScientificPaper) {
  // Store bibliographic metadata without manufacturing an article body.
  const metadata: ScientificPaper = { source: "openalex", externalId: paper.externalId, doi: paper.doi,
    title: paper.title, abstract: paper.abstract, authors: paper.authors, year: paper.year,
    venue: paper.venue, url: safePublicationUrl(paper.url), pdfUrl: safePublicationUrl(paper.pdfUrl),
    topics: paper.topics, references: paper.references, citationCount: paper.citationCount, type: paper.type };
  return `% papergraph-discovery:${encodeURIComponent(JSON.stringify(metadata))}`;
}
