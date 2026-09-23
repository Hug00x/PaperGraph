import { decodeImportedPdfText, importedPdfMetadata } from "./pdf-metadata.ts";
import { openAlexClient } from "./openalex-client.ts";
import { normalizeDoi, discoveredMetadata } from "./discovery/identity.ts";
type AppLanguage = "en" | "pt";

export type ArticleInput = {
  id: string;
  source: string;
  tags: string[];
  title: string;
};

export type AcademicRelation = {
  id: string;
  fromArticleId: string;
  toArticleId: string;
  note: string;
  createdAt: string;
  relationType: "citation" | "semantic";
};

export type OpenAlexWork = {
  abstract_inverted_index?: Record<string, number[]> | null;
  doi?: string | null;
  display_name?: string | null;
  id?: string | null;
  referenced_works?: string[] | null;
  title?: string | null;
  authorships?: Array<{ author: { id?: string; display_name?: string } }>;
  publication_year?: number;
  cited_by_count?: number;
  topics?: unknown[];
};

type OpenAlexListResponse = {
  results?: OpenAlexWork[];
};

type ArticleAcademicProfile = {
  article: ArticleInput;
  doi: string | null;
  mentionedDois: Set<string>;
  openAlexId: string | null;
  referencedOpenAlexIds: Set<string>;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractDois(value: string) {
  const matches = value.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/gi) ?? [];
  const dois = matches.map(normalizeDoi).filter(Boolean);

  return Array.from(new Set(dois));
}

function extractDoi(value: string) {
  return extractDois(value)[0] ?? null;
}

function extractArxivIds(value: string) {
  const matches = value.match(/\b(?:arxiv:)?\d{4}\.\d{4,5}(?:v\d+)?\b/gi) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => match.replace(/^arxiv:/i, "").replace(/v\d+$/i, "").toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function abstractFromInvertedIndex(index: unknown) {
  if (!index || typeof index !== "object" || Array.isArray(index)) {
    return "";
  }

  const words: Array<{ position: number; word: string }> = [];

  Object.entries(index).slice(0, 16000).forEach(([word, positions]) => {
    if (!Array.isArray(positions)) return;
    positions.slice(0, 16000).forEach((position: unknown) => {
      if (typeof position === "number" && Number.isInteger(position) && position >= 0 && position < 16000 && words.length < 16000) words.push({ position, word });
    });
  });

  return words
    .sort((firstWord, secondWord) => firstWord.position - secondWord.position)
    .map((item) => item.word)
    .join(" ").slice(0, 16000);
}

function getArticleDoi(article: ArticleInput) {
  if (article.source.includes("papergraph-import-text:") || article.source.includes("\\includepdf")) return importedPdfMetadata(article.source).doi;
  return extractDoi([article.title, ...article.tags].join(" "));

}

function fetchOpenAlex(url: string) {
  return openAlexClient.fetch(url);
}

async function fetchOpenAlexWorkByDoi(doi: string) {
  const doiUrl = `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`;
  const response = await fetchOpenAlex(
    `https://api.openalex.org/works/${doiUrl}?select=id,doi,title,display_name,abstract_inverted_index,referenced_works,authorships,publication_year,cited_by_count,topics`,
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OpenAlexWork;
}

async function fetchOpenAlexWorkByArxivId(arxivId: string) {
  const doiWork = await fetchOpenAlexWorkByDoi(`10.48550/arXiv.${arxivId}`);

  if (doiWork?.id) {
    return doiWork;
  }

  const response = await fetchOpenAlex(
    `https://api.openalex.org/works?filter=locations.landing_page_url.search:${encodeURIComponent(arxivId)}&per-page=1&select=id,doi,title,display_name,abstract_inverted_index,referenced_works,authorships,publication_year,cited_by_count,topics`,
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as OpenAlexListResponse;

  return payload.results?.[0] ?? null;
}

async function searchOpenAlexWorkByTitle(title: string) {
  const response = await fetchOpenAlex(
    `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=3&select=id,doi,title,display_name,abstract_inverted_index,referenced_works,authorships,publication_year,cited_by_count,topics`,
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as OpenAlexListResponse;
  const titleKey = normalizeText(title);
  const works = payload.results ?? [];
  const exactMatch = works.find(
    (work) => normalizeText(work.display_name ?? work.title ?? "") === titleKey,
  );

  return exactMatch ?? null;
}

export async function resolveOpenAlexWork(article: ArticleInput) {
  const discovered = discoveredMetadata(article.source);
  if (discovered) return { id: discovered.externalId, title: discovered.title, doi: discovered.doi,
    authorships: discovered.authors.map((author) => ({ author: { id: author.id, display_name: author.name } })),
    publication_year: discovered.year ?? undefined, cited_by_count: discovered.citationCount,
    topics: discovered.topics.map((topic) => ({ id: topic.id, display_name: topic.name })), referenced_works: discovered.references };
  const doi = getArticleDoi(article);

  if (doi) {
    const doiWork = await fetchOpenAlexWorkByDoi(doi);

    if (doiWork?.id) {
      return doiWork;
    }
  }

  const pdfText = decodeImportedPdfText(article.source);
  const arxivIds = extractArxivIds(pdfText
    ? pdfText.split("\f")[0].split(/\b(?:references|bibliography)\b/i)[0].slice(0, 6000)
    : [article.title, ...article.tags].join(" "));

  for (const arxivId of arxivIds) {
    const arxivWork = await fetchOpenAlexWorkByArxivId(arxivId);

    if (arxivWork?.id) {
      return arxivWork;
    }
  }

  if (article.title.trim().length < 3) {
    return null;
  }

  return searchOpenAlexWorkByTitle(importedPdfMetadata(article.source).title ?? article.title);
}

export function buildCitationRelations(profiles: ArticleAcademicProfile[], language: AppLanguage) {
  const profileByOpenAlexId = new Map(
    profiles
      .filter((profile): profile is ArticleAcademicProfile & { openAlexId: string } => Boolean(profile.openAlexId))
      .map((profile) => [profile.openAlexId, profile]),
  );
  const profileByDoi = new Map(
    profiles
      .filter((profile): profile is ArticleAcademicProfile & { doi: string } => Boolean(profile.doi))
      .map((profile) => [profile.doi, profile]),
  );
  const relations: AcademicRelation[] = [];
  const seenRelationKeys = new Set<string>();

  function addCitationRelation(sourceProfile: ArticleAcademicProfile, targetProfile: ArticleAcademicProfile) {
    if (targetProfile.article.id === sourceProfile.article.id) {
      return;
    }

    const relationKey = `${sourceProfile.article.id}->${targetProfile.article.id}:citation`;

    if (seenRelationKeys.has(relationKey)) {
      return;
    }

    seenRelationKeys.add(relationKey);
    relations.push({
      id: crypto.randomUUID(),
      fromArticleId: sourceProfile.article.id,
      toArticleId: targetProfile.article.id,
      note:
        language === "en"
          ? `OpenAlex citation: ${sourceProfile.article.title} references ${targetProfile.article.title}.`
          : `Citação OpenAlex: ${sourceProfile.article.title} referencia ${targetProfile.article.title}.`,
      createdAt: "OpenAlex",
      relationType: "citation",
    });
  }

  profiles.forEach((sourceProfile) => {
    sourceProfile.referencedOpenAlexIds.forEach((referencedOpenAlexId) => {
      const targetProfile = profileByOpenAlexId.get(referencedOpenAlexId);

      if (targetProfile) {
        addCitationRelation(sourceProfile, targetProfile);
      }
    });

    sourceProfile.mentionedDois.forEach((mentionedDoi) => {
      const targetProfile = profileByDoi.get(mentionedDoi);

      if (targetProfile) {
        addCitationRelation(sourceProfile, targetProfile);
      }
    });
  });

  return relations;
}


export function citationProfile(article: ArticleInput, metadata: { doi: string | null; openalex_id: string | null; referenced_work_ids: string[] }): ArticleAcademicProfile {
  return { article, doi: metadata.doi ? normalizeDoi(metadata.doi) : getArticleDoi(article), openAlexId: metadata.openalex_id,
    referencedOpenAlexIds: new Set(metadata.referenced_work_ids),
    mentionedDois: new Set(extractDois([article.source, decodeImportedPdfText(article.source)].join(" "))) };
}
