"use client";
import { HelpArrow } from './help-arrow';
import { HelpCard } from './help-card';
import { helpCategories, helpFaqs, helpGuides, type HelpCategory } from '@/lib/help/content';
import type { AppLanguage } from '@/lib/portuguese-labels';
export function HelpHome({ language, onOpen, onCategory }: { language: AppLanguage; onOpen: (id: string) => void; onCategory: (id: HelpCategory) => void; }) {
  const en = language === 'en';
  return <>
    <section aria-labelledby="help-start-title" className="help-start">
      <div><p className="help-eyebrow">{en ? 'Start here' : 'Começa aqui'}</p><h3 id="help-start-title">{en ? 'Build your first research map' : 'Cria o teu primeiro mapa de investigação'}</h3><p>{en ? 'A short path from your first workspace to connected ideas.' : 'Um percurso curto da primeira workspace às ideias ligadas.'}</p></div>
      <button type="button" className="help-button help-primary" onClick={() => onOpen('first-project')}>{en ? 'Open quick start' : 'Abrir primeiros passos'} <HelpArrow /></button>
      <div className="help-quick-links">{['workspace-create', 'pdf-import', 'relationships'].map((id, i) => <button type="button" key={id} onClick={() => onOpen(id)}><span aria-hidden="true">0{i + 1}</span>{helpGuides.find(g => g.id === id)!.title[language]} <span aria-hidden="true">↗</span></button>)}</div>
    </section>
    <section aria-labelledby="help-explore-title"><h3 id="help-explore-title">{en ? 'Explore by topic' : 'Explorar por tema'}</h3><div className="help-card-grid">{helpCategories.filter(c => !['start', 'shortcuts', 'trouble'].includes(c[0])).map(c => { const guides = helpGuides.filter(g => g.category === c[0]); return <HelpCard key={c[0]} title={c[en ? 1 : 2]} description={guides.slice(0, 2).map(g => g.title[language]).join(' · ')} footer={<>{guides.length} {en ? 'guides' : 'guias'}</>} onClick={() => onCategory(c[0])} />; })}</div></section>
    <div className="help-card-grid help-utilities">{(['shortcuts', 'trouble'] as const).map(id => <button type="button" className="help-card" key={id} onClick={() => id === 'shortcuts' ? onOpen(id) : onCategory(id)}><strong>{helpCategories.find(c => c[0] === id)![en ? 1 : 2]}</strong><span>{id === 'shortcuts' ? (en ? 'Find the right keys for your current task.' : 'Encontra as teclas certas para a tarefa atual.') : (en ? 'Imports, saves, compilation and model recovery.' : 'Importações, gravação, compilação e recuperação de modelos.')}</span></button>)}</div>
    <section aria-labelledby="help-faq-title"><h3 id="help-faq-title">{en ? 'Common questions' : 'Perguntas frequentes'}</h3><div className="help-faq">{helpFaqs.map(faq => <details key={faq.guide}><summary>{faq.question[language]}</summary><p>{faq.answer[language]}</p><button type="button" className="help-text-link" onClick={() => onOpen(faq.guide)}>{en ? 'Read the guide' : 'Ler o guia'} →</button></details>)}</div></section>
  </>;
}
