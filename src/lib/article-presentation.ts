import { discoveredMetadata } from "./academic/discovery/identity.ts";
import { importedPdfMetadata } from "./academic/pdf-metadata.ts";
import type { WorkspaceArticle } from "./workspace-data.ts";

export function isImportedPdfArticle(article: { source?: string; tags: string[] }) {
  const tags = article.tags.map((tag) => tag.toLowerCase());
  return article.source?.includes("papergraph-import-text:") === true ||
    article.source?.includes("\\includepdf") === true ||
    (tags.includes("pdf") && (tags.includes("importado") || tags.includes("imported")));
}

export function getVisibleArticleTags(article: Pick<WorkspaceArticle, "source" | "tags">) {
  return isImportedPdfArticle(article) ? article.tags.filter((tag) => tag.toLowerCase() !== "pdf") : article.tags;
}

export function isViewOnlyArticle(article: Pick<WorkspaceArticle, "source" | "tags">) {
  return Boolean(discoveredMetadata(article.source)) || isImportedPdfArticle(article);
}

export function articleAbstract(article: Pick<WorkspaceArticle, "source" | "abstract">) {
  return article.abstract?.trim() || discoveredMetadata(article.source)?.abstract.trim() ||
    importedPdfMetadata(article.source).abstract?.trim() || "";
}
