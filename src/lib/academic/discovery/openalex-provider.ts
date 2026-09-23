import { abstractFromInvertedIndex } from "../openalex.ts";
import { DiscoveryError, openAlexClient } from "../openalex-client.ts";
import { discoveryConfig as config } from "./config.ts";
import { normalizeDoi, openAlexId, safePublicationUrl } from "./identity.ts";
import type { PaperDiscoveryProvider, RecommendationQuery, ScientificPaper } from "./types.ts";

const fields = "id,doi,title,abstract_inverted_index,publication_year,authorships,primary_location,cited_by_count,type,topics,referenced_works";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, length = 1000) => typeof value === "string" ? value.trim().slice(0, length) : "";
const list = (value: unknown) => Array.isArray(value) ? value.slice(0, 1000) as unknown[] : [];
export function normalizeOpenAlexWork(raw: unknown): ScientificPaper | null {
  const work = record(raw), externalId = openAlexId(text(work.id)), title = text(work.title || work.display_name);
  if (!externalId || title.length < 3) return null;
  const location = record(work.primary_location);
  const doi = normalizeDoi(text(work.doi));
  const year = typeof work.publication_year === "number" && Number.isInteger(work.publication_year) ? work.publication_year : null;
  return { source: "openalex", externalId, title, abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    doi: /^10\.\d{4,9}\//.test(doi) ? doi : null, year,
    authors: list(work.authorships).map((item) => record(record(item).author)).map((a) => ({ id: /^https:\/\/openalex.org\/A\d+$/.test(text(a.id)) ? text(a.id) : "", name: text(a.display_name, 200) })).filter((a) => a.name),
    topics: list(work.topics).map(record).map((t) => ({ id: text(t.id), name: text(t.display_name, 200) })).filter((t) => /^https:\/\/openalex.org\/T\d+$/.test(t.id)),
    references: list(work.referenced_works).map((id) => openAlexId(text(id))).filter((id): id is string => Boolean(id)),
    venue: text(record(location.source).display_name, 400), url: safePublicationUrl(location.landing_page_url) || (doi ? `https://doi.org/${doi}` : externalId),
    type: text(work.type, 100), citationCount: typeof work.cited_by_count === "number" ? Math.max(0, work.cited_by_count) : 0,
    providerScore: typeof work.relevance_score === "number" && Number.isFinite(work.relevance_score) ? work.relevance_score : undefined };
}
export function buildSemanticQuery(input: RecommendationQuery) {
  if (input.title.trim().length < 12 || /^(?:untitled|sem t[ií]tulo|nota de investiga)/i.test(input.title) || /\.pdf$/i.test(input.title)) throw new DiscoveryError("insufficient-metadata");
  return Array.from(`${input.title.trim()}\n\n${input.abstract.trim()}`.trim()).slice(0, config.queryCharacters).join("");
}
export class OpenAlexDiscoveryProvider implements PaperDiscoveryProvider {
  async lookup(idOrDoi: string, signal?: AbortSignal) {
    const id = openAlexId(idOrDoi);
    const doi = normalizeDoi(idOrDoi);
    if (!id && !/^10\.\d{4,9}\//.test(doi)) throw new DiscoveryError("invalid-request");
    const identifier = id ? id.split("/").at(-1)! : `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`;
    const response = await openAlexClient.fetch(`https://api.openalex.org/works/${identifier}?select=${fields}`, { signal });
    if (response.status === 404) return null;
    return normalizeOpenAlexWork(await response.json());
  }
  async findRelatedPaperCandidates(input: RecommendationQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ "search.semantic": buildSemanticQuery(input), "per-page": String(config.candidateCount), select: `${fields},relevance_score` });
    const response = await openAlexClient.fetch(`https://api.openalex.org/works?${params}`, { signal, semantic: true });
    const data = record(await response.json());
    if (!Array.isArray(data.results)) throw new DiscoveryError("invalid-response");
    return data.results.slice(0, config.candidateCount).map(normalizeOpenAlexWork).filter((paper): paper is ScientificPaper => Boolean(paper));
  }
}
export const openAlexDiscovery = new OpenAlexDiscoveryProvider();
