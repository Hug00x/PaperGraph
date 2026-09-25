import { discoveredMetadata } from "./academic/discovery/identity.ts";
import { importedPdfMetadata } from "./academic/pdf-metadata.ts";
import type { WorkspaceArticle } from "./workspace-data.ts";

export function isViewOnlyArticle(article: Pick<WorkspaceArticle, "source" | "tags">) {
  const tags = article.tags.map((tag) => tag.toLowerCase());
  return Boolean(discoveredMetadata(article.source)) || article.source.includes("papergraph-import-text:") ||
    article.source.includes("\\includepdf") ||
    (tags.includes("pdf") && (tags.includes("importado") || tags.includes("imported")));
}

export function articleAbstract(article: Pick<WorkspaceArticle, "source" | "abstract">) {
  return article.abstract?.trim() || discoveredMetadata(article.source)?.abstract.trim() ||
    importedPdfMetadata(article.source).abstract?.trim() || "";
}
