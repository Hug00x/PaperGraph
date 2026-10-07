import type { WorkspaceArticle } from './workspace-data.ts';
import { articleIdentity, discoveredMetadata, samePaper } from './academic/discovery/identity.ts';
import { importedPdfMetadata } from './academic/pdf-metadata.ts';
import { LIMITS, doi, openAlex, type ResearchPaper, type ResearchCandidate } from '../../electron/research-contract.cjs';

// Extract bibliographic fields locally. Never pass article.source or imported PDF text through IPC.
export function researchPaper(article: WorkspaceArticle): ResearchPaper {
  const metadata = discoveredMetadata(article.source);
  const pdf = importedPdfMetadata(article.source);
  const identity = articleIdentity(article);
  return { title: (metadata?.title || pdf.title || article.title).slice(0, LIMITS.title),
    doi: doi(identity.doi), openAlexId: openAlex(identity.externalId),
    year: identity.year && identity.year >= 1500 && identity.year <= 2100 ? identity.year : null,
    abstract: (metadata?.abstract || pdf.abstract || article.abstract || '').slice(0, LIMITS.abstract),
    authors: metadata?.authors.slice(0, 20).map(a => a.name.slice(0, 200)) || [] };
}
export function existingResearchPaper(candidate: ResearchCandidate, articles: WorkspaceArticle[]) {
  return articles.find(article => samePaper({ ...candidate, externalId: candidate.openAlexId }, articleIdentity(article))) || null;
}
export function canAddResearchPaper(canEdit: boolean, workspaceId: string, accessToken: string) {
  return canEdit && Boolean(workspaceId && accessToken);
}
