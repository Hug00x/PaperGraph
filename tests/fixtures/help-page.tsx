"use client";
import { useEffect, useState } from 'react';
import { HelpSection, type HelpLocation } from '@/components/help-section';
import { HelpButton } from '@/components/help-button';
import { GraphPane } from '@/components/graph-pane';
import type { AppLanguage } from '@/lib/portuguese-labels';
import type { HelpDestination } from '@/lib/help/content';
import type { GraphZone } from '@/lib/graph-zones';
const zone: GraphZone = { id: 'zone', name: 'Study group', color: 'blue', x: 40, y: 40, width: 20, height: 20, notes: 'Original notes' };
export default function HelpFixture() {
  useEffect(() => { document.querySelector('main')?.setAttribute('data-help-ready', 'true'); }, []);
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [location, setLocation] = useState<HelpLocation>({ kind: 'home' });
  const [view, setView] = useState<HelpDestination | 'help'>('help');
  const [returnTo, setReturn] = useState<HelpDestination | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [zones, setZones] = useState([zone]);
  const [writes, setWrites] = useState(0);
  const openHelp = (id: string) => { setReturn('graph'); setLocation({ kind: 'guide', id }); setView('help'); };
  return <main data-help-ready="false" className="papergraph-app h-screen overflow-auto bg-[var(--background)] p-5">
    <div className="mb-4 flex gap-4"><HelpButton isEnglish={language === 'en'} onClick={() => openHelp('graph-navigation')} /><button id="language" onClick={() => setLanguage(l => l === 'en' ? 'pt' : 'en')}>Language</button><button id="toggle-role" onClick={() => setCanEdit(v => !v)}>Role: {canEdit ? 'Editor' : 'Viewer'}</button><button id="reopen-help" onClick={() => setView('help')}>Reopen Help</button><button id="invalid-guide" onClick={() => { setView('help'); setLocation({ kind: 'guide', id: 'missing' }); }}>Invalid guide</button></div>
    <output id="writes" hidden>{writes}</output>
    {view === 'help' ? <div className="mx-auto grid max-w-[1440px] gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]"><aside className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5"><h1>Settings</h1><p className="mt-3 text-sm text-[var(--muted)]">General · Workspaces · Anara · Help · Account</p></aside><div className="min-w-0 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-5"><HelpSection language={language} location={location} onLocationChange={setLocation} onNavigate={setView} onReturn={returnTo ? () => setView(returnTo) : undefined} /></div></div>
      : view === 'graph' ? <div className="flex h-[850px]"><GraphPane workspaceId="" accessToken="" articles={[]} activeArticle={null} language={language} relations={[]} unlinkedMentions={[]} articlePositions={{}} zones={zones} canEdit={canEdit} onZonesChange={z => { setZones(z); setWrites(w => w + 1); }} onArticlePositionsChange={() => {}} onSelectArticle={() => {}} onAddRecommendation={async () => {}} onCreateRelation={() => {}} onRemoveRelation={() => {}} onCreateWikilinkFromMention={() => {}} onIgnoreUnlinkedMention={() => {}} onEditArticle={() => {}} onViewArticle={() => {}} onExportArticlePdf={() => {}} onImportPdfArticle={async () => { throw Error('No imports in Help test'); }} onDeleteArticle={() => {}} /></div>
      : <section id="destination">{view}<button onClick={() => setView('help')}>Back to Help</button></section>}
  </main>;
}


