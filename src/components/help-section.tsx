"use client";
import { HelpArrow } from './help/help-arrow';
import { HelpCard } from './help/help-card';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppLanguage } from '@/lib/portuguese-labels';
import { helpCategories, helpGuides, type HelpCategory, type HelpDestination } from '@/lib/help/content';
import { nextHelpResult, normalizeHelp, searchHelp } from '@/lib/help/search';
import { HelpGuideView } from './help/help-guide';
import { HelpHome } from './help/help-home';
export type HelpLocation = { kind: 'home' } | { kind: 'category'; id: HelpCategory } | { kind: 'guide'; id: string };
type Props = { language: AppLanguage; location?: HelpLocation; onLocationChange?: (location: HelpLocation) => void; onNavigate?: (destination: HelpDestination) => void; onReturn?: () => void; };
function Highlight({ value, query }: { value: string; query: string }) {
  const terms = normalizeHelp(query).split(' ').filter(t => t.length > 1);
  return <>{value.split(/(\s+)/).map((word, i) => terms.some(t => normalizeHelp(word).includes(t)) ? <mark key={i}>{word}</mark> : word)}</>;
}
export function HelpSection({ language, location: controlledLocation, onLocationChange, onNavigate, onReturn }: Props) {
  const en = language === 'en';
  const [localLocation, setLocalLocation] = useState<HelpLocation>({ kind: 'home' });
  const location = controlledLocation ?? localLocation;
  const [history, setHistory] = useState<HelpLocation[]>([]);
  const [query, setQuery] = useState('');
  const [activeResult, setActiveResult] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldFocusContent = useRef(false);
  const results = useMemo(() => searchHelp(query, language), [query, language]);
  const guide = location.kind === 'guide' ? helpGuides.find(g => g.id === location.id) : undefined;
  const category = location.kind === 'category' ? helpCategories.find(c => c[0] === location.id) : undefined;
  const searching = query.trim().length > 0;
  function setLocation(next: HelpLocation) { setLocalLocation(next); onLocationChange?.(next); }
  function navigate(next: HelpLocation) { setHistory(h => [...h, location]); setLocation(next); setQuery(''); setActiveResult(0); shouldFocusContent.current = true; }
  function open(id: string) { navigate({ kind: 'guide', id }); }
  useEffect(() => {
    if (shouldFocusContent.current) { contentRef.current?.focus({ preventScroll: true }); contentRef.current?.scrollIntoView({ block: 'nearest' }); shouldFocusContent.current = false; }
  }, [location, searching]);
  useEffect(() => { if (searching) document.getElementById(`help-result-${activeResult}`)?.scrollIntoView({ block: 'nearest' }); }, [activeResult, searching]);
  return <section className="help-center" aria-labelledby="help-title">
    <header className="help-header"><div><p className="help-eyebrow">PaperGraph</p><h2 id="help-title">{en ? 'Help & learning' : 'Ajuda e aprendizagem'}</h2><p>{en ? 'Find a workflow, learn a feature or get unstuck.' : 'Explora as funcionalidades e encontra soluções para as tuas dúvidas.'}</p></div>{onReturn && <button type="button" className="help-button" onClick={onReturn}>← {en ? 'Return to previous view' : 'Voltar à vista anterior'}</button>}</header>
    <div className="help-search"><label htmlFor="help-search-input">{en ? 'Search Help' : 'Pesquisar na Ajuda'}</label><div className="help-search-field"><span aria-hidden="true">⌕</span><input id="help-search-input" ref={searchRef} type="search" autoComplete="off" value={query} placeholder={en ? 'Try “connect papers”, “Groups” or “LaTeX compilation”…' : 'Experimenta “ligar artigos”, “Grupos” ou “compilação LaTeX”…'} role="combobox" aria-autocomplete="list" aria-expanded={searching && results.length > 0} aria-controls={searching && results.length > 0 ? 'help-results' : undefined} aria-activedescendant={searching && results[activeResult] ? `help-result-${activeResult}` : undefined}
      onChange={e => { setQuery(e.target.value); setActiveResult(0); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(''); setActiveResult(0); }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) { e.preventDefault(); setActiveResult(i => nextHelpResult(i, e.key === 'ArrowDown' ? 1 : -1, results.length)); }
        if (e.key === 'Enter' && searching && results[activeResult]) { e.preventDefault(); open(results[activeResult].guide.id); }
      }} />{query && <button type="button" aria-label={en ? 'Clear search' : 'Limpar pesquisa'} onClick={() => { setQuery(''); setActiveResult(0); searchRef.current?.focus(); }}>×</button>}</div><p className="help-search-hint">{en ? 'Search stays on this device. Use ↑ ↓ and Enter to open a result.' : 'A pesquisa fica neste dispositivo. Usa ↑ ↓ e Enter para abrir um resultado.'}</p></div>
    <div className="help-layout"><nav aria-label={en ? 'Help topics' : 'Temas da Ajuda'} className="help-sidebar"><button type="button" aria-current={!searching && location.kind === 'home' ? 'page' : undefined} onClick={() => navigate({ kind: 'home' })}>{en ? 'Overview' : 'Visão geral'}</button>{helpCategories.map(c => <button key={c[0]} type="button" aria-current={!searching && (location.kind === 'category' ? location.id === c[0] : guide?.category === c[0]) ? 'page' : undefined} onClick={() => c[0] === 'shortcuts' ? open('shortcuts') : navigate({ kind: 'category', id: c[0] })}>{c[en ? 1 : 2]}</button>)}</nav>
    <div ref={contentRef} tabIndex={-1} className="help-content" aria-label={en ? 'Help content' : 'Conteúdo da Ajuda'}>
      {!searching && location.kind !== 'home' && <div className="help-breadcrumb"><button type="button" className="help-text-link" onClick={() => { const previous = history.at(-1) ?? { kind: 'home' as const }; setHistory(h => h.slice(0, -1)); setLocation(previous); shouldFocusContent.current = true; }}>← {en ? 'Back' : 'Voltar'}</button><button type="button" className="help-text-link" onClick={() => navigate({ kind: 'home' })}>{en ? 'Help overview' : 'Visão geral da Ajuda'}</button></div>}
      {searching ? <section aria-labelledby="help-results-title"><h3 id="help-results-title">{en ? 'Search results' : 'Resultados da pesquisa'}</h3><p role="status" className="help-result-count">{results.length} {en ? 'guides found' : 'guias encontrados'}</p>{results.length ? <div id="help-results" role="listbox" aria-label={en ? 'Matching guides' : 'Guias encontrados'}>{results.map(({ guide: result }, i) => <div key={result.id} className={`help-result ${activeResult === i ? "is-active" : ""}`} onMouseMove={() => setActiveResult(i)}><button type="button" role="option" aria-selected={activeResult === i} id={`help-result-${i}`} onClick={() => open(result.id)} onFocus={() => setActiveResult(i)}><small>{helpCategories.find(c => c[0] === result.category)![en ? 1 : 2]}</small><strong><Highlight value={result.title[language]} query={query} /></strong><span><Highlight value={result.summary[language]} query={query} /></span><HelpArrow /></button></div>)}</div> : <div className="help-empty"><strong>{en ? 'No matching guides yet' : 'Nenhum guia encontrado'}</strong><p>{en ? 'Try fewer words, a feature name, or browse Troubleshooting.' : 'Experimenta menos palavras, o nome da funcionalidade ou Resolver problemas.'}</p><button type="button" className="help-button" onClick={() => navigate({ kind: 'category', id: 'trouble' })}>{en ? 'Browse troubleshooting' : 'Ver resolução de problemas'}</button></div>}</section>
        : location.kind === 'guide' ? guide ? <HelpGuideView guide={guide} language={language} onOpen={open} onNavigate={onNavigate} /> : <div className="help-empty"><h3>{en ? 'Guide not found' : 'Guia não encontrado'}</h3><button type="button" className="help-button" onClick={() => navigate({ kind: 'home' })}>{en ? 'Return to overview' : 'Voltar à visão geral'}</button></div>
        : category ? <section><p className="help-eyebrow">{en ? 'Browse guides' : 'Explorar guias'}</p><h3>{category[en ? 1 : 2]}</h3><div className="help-card-grid">{helpGuides.filter(g => g.category === category[0]).map(g => <HelpCard key={g.id} title={g.title[language]} description={g.summary[language]} onClick={() => open(g.id)} />)}</div></section>
        : <HelpHome language={language} onOpen={open} onCategory={id => navigate({ kind: 'category', id })} />}
    </div></div>
    <footer className="help-footer"><span>{en ? 'Need more help?' : 'Precisas de mais ajuda?'}</span><a href="https://github.com/Hug00x/PaperGraph/issues" target="_blank" rel="noopener noreferrer">{en ? 'Report a problem' : 'Comunicar um problema'} ↗</a></footer>
  </section>;
}
