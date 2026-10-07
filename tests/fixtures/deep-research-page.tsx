"use client";
import { useState } from 'react';
import { GraphPane } from '@/components/graph-pane';
import { recommendedArticleSource } from '@/lib/academic/discovery/identity';
import type { GraphZone } from '@/lib/graph-zones';
import type { ArticlePosition, WorkspaceArticle } from '@/lib/workspace-data';
const initialArticles: WorkspaceArticle[] = ['A', 'B', 'C'].map((id, index) => ({ id, title: `Scientific paper ${id}`, abstract: `Public abstract ${id}`, author: 'Private uploader', status: 'Published', tags: [`10.1234/paper${id.toLowerCase()}`], updatedAt: '', source: 'PRIVATE_LATEX_MUST_NOT_BE_SENT', index }));
const initialPositions = { A: { x: 46, y: 48 }, B: { x: 52, y: 48 }, C: { x: 62, y: 60 } };
export default function Fixture() {
  const [articles, setArticles] = useState(initialArticles);
  const [positions, setPositions] = useState<Record<string, ArticlePosition>>(initialPositions);
  const [zones, setZones] = useState<GraphZone[]>([{ id: 'group-a', name: 'Public Research Group', notes: 'PRIVATE_GROUP_NOTES', x: 40, y: 40, width: 30, height: 30, color: 'teal' }]);
  const [active, setActive] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  return <main className="papergraph-app flex h-screen min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
    <div className="flex gap-4 p-3 text-xs"><button id="fixture-viewer" onClick={() => setCanEdit(value => !value)}>Toggle Viewer</button><span id="fixture-role">{canEdit ? 'Editor' : 'Viewer'}</span>
      <pre id="fixture-state">{JSON.stringify({ active, count: articles.length, notes: zones[0].notes })}</pre></div>
    <GraphPane workspaceId="fixture-workspace" accessToken="fixture-supabase" articles={articles} activeArticle={articles.find(a => a.id === active) || null}
      language="en" canEdit={canEdit} relations={[]} unlinkedMentions={[]} articlePositions={positions} zones={zones}
      onSelectArticle={setActive} onArticlePositionsChange={setPositions} onZonesChange={(next, p) => { if (canEdit) { setZones(next); setPositions(p); } }}
      onAddRecommendation={async () => {}} onAddResearchPaper={async (candidate, _, signal) => {
        signal.throwIfAborted(); if (!canEdit) throw new Error('read-only');
        const id = 'canonical-paper';
        const source = recommendedArticleSource({ source: 'openalex', title: candidate.title, externalId: 'https://openalex.org/W12345', doi: candidate.doi,
          abstract: 'Canonical abstract', authors: [], year: candidate.year, topics: [], references: [], venue: '', url: candidate.url, citationCount: 0, type: 'article' });
        setArticles(values => values.some(a => a.id === id) ? values : [...values, { id, title: candidate.title, author: '', status: 'Published', tags: [], updatedAt: '', source }]);
        setPositions(values => ({ ...values, [id]: { x: 56, y: 53 } })); return id;
      }} onCreateRelation={() => {}} onRemoveRelation={() => {}} onCreateWikilinkFromMention={() => {}} onIgnoreUnlinkedMention={() => {}}
      onEditArticle={() => {}} onViewArticle={() => {}} onExportArticlePdf={() => {}} onDeleteArticle={() => {}}
      onImportPdfArticle={async () => { throw new Error('Unused in fixture'); }} />
  </main>;
}
