"use client";
import { HelpCard } from './help-card';
import { helpCategories, helpGuides, helpShortcuts, type HelpDestination, type HelpGuide } from '@/lib/help/content';
import type { AppLanguage } from '@/lib/portuguese-labels';
export function HelpGuideView({ guide, language, onOpen, onNavigate }: {
  guide: HelpGuide; language: AppLanguage; onOpen: (id: string) => void; onNavigate?: (destination: HelpDestination) => void;
}) {
  const en = language === 'en';
  const category = helpCategories.find(c => c[0] === guide.category)!;
  return <article className="help-guide" aria-labelledby="help-guide-title">
    <p className="help-eyebrow">{category[en ? 1 : 2]}</p>
    <h3 id="help-guide-title">{guide.title[language]}</h3><p className="help-lead">{guide.summary[language]}</p>
    {guide.requirements.length > 0 && <aside className="help-callout" aria-label={en ? 'Requirements' : 'Requisitos'}><strong>{en ? 'Before you begin' : 'Antes de começar'}</strong><ul>{guide.requirements.map((item, i) => <li key={i}>{item[language]}</li>)}</ul></aside>}
    <h4>{en ? 'Step by step' : 'Passo a passo'}</h4>
    <ol className="help-steps">{guide.steps.map((step, i) => <li key={i}><span aria-hidden="true">{i + 1}</span><p>{step[language]}</p></li>)}</ol>
    {guide.destination && onNavigate && <button type="button" className="help-button help-primary" onClick={() => onNavigate(guide.destination!)}>{en ? 'Show me where' : 'Mostrar onde'} <span aria-hidden="true">↗</span></button>}
    {guide.tips.length > 0 && <section className="help-notes"><h4>{en ? 'Good to know' : 'Convém saber'}</h4>{guide.tips.map((tip, i) => <p key={i}>{tip[language]}</p>)}</section>}
    {guide.id === 'shortcuts' && <div className="help-table-wrap"><table><caption>{en ? 'Controls and their required focus' : 'Controlos e contexto de foco necessário'}</caption><thead><tr><th scope="col">{en ? 'Where' : 'Onde'}</th><th scope="col">{en ? 'Keys / gesture' : 'Teclas / gesto'}</th><th scope="col">{en ? 'Action' : 'Ação'}</th></tr></thead><tbody>{helpShortcuts.map(item => <tr key={`${item.context.en}-${item.keys}`}><td>{item.context[language]}</td><td><kbd>{item.keys}</kbd></td><td>{item.action[language]}</td></tr>)}</tbody></table></div>}
    <section className="help-related"><h4>{en ? 'Continue exploring' : 'Continuar a explorar'}</h4><div className="help-card-grid">{guide.related.map(id => { const related = helpGuides.find(g => g.id === id)!; return <HelpCard key={id} title={related.title[language]} description={related.summary[language]} onClick={() => onOpen(id)} />; })}</div></section>
  </article>;
}
