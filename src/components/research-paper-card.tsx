"use client";

import type { ResearchCandidate } from "../../electron/research-contract.cjs";
import type { WorkspaceArticle } from "@/lib/workspace-data";
import { existingResearchPaper } from "@/lib/deep-research-context";

export function ResearchPaperCard({ paper, articles, canAdd, adding, addedId, en, onAdd, onView }: {
  paper: ResearchCandidate; articles: WorkspaceArticle[]; canAdd: boolean; adding: boolean; addedId?: string; en: boolean;
  onAdd: () => void; onView: (id: string) => void;
}) {
  const existing = existingResearchPaper(paper, articles);
  const id = existing?.id || addedId;
  return <article className="rounded-2xl border border-[var(--border)] p-3">
    <h4 className="text-sm font-semibold leading-5">{paper.title || paper.doi || paper.openAlexId}</h4>
    <p className="mt-1 text-xs text-[var(--muted)]">{[paper.authors.slice(0, 3).join(', '), paper.year].filter(Boolean).join(' · ')}</p>
    {paper.doi && <p className="mt-1 break-all text-xs text-[var(--muted)]">DOI: {paper.doi}</p>}
    {paper.relevanceExplanation && <p className="mt-2 text-xs leading-5">{paper.relevanceExplanation}</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      {id ? <button type="button" className="recommendations-action" onClick={() => onView(id)}>{en ? 'View in Graph' : 'Ver no mapa'}</button>
        : <button type="button" className="recommendations-action" disabled={!canAdd || adding} onClick={onAdd}>
          {adding ? (en ? 'Adding…' : 'A adicionar…') : (en ? '+ Add to Graph' : '+ Adicionar ao mapa')}</button>}
      {paper.url && <a href={paper.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">{en ? 'Open' : 'Abrir'}</a>}
    </div>
  </article>;
}

