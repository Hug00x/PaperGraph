import { helpFaqs, helpGuides, helpShortcuts } from './content.ts';
export function normalizeHelp(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
}
const synonyms: Record<string, string> = { zone: 'group', zones: 'groups', zona: 'grupo', zonas: 'grupos', connections: 'relationships', connection: 'relationship', annotation: 'highlights', annotations: 'highlights', realces: 'destaques', compilation: 'compile', papers: 'paper', references: 'citation', referencias: 'citacao' };
const stopWords = new Set(['how', 'do', 'does', 'i', 'a', 'an', 'the', 'to', 'my', 'can', 'what', 'is', 'in', 'of', 'and', 'with', 'como', 'o', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'eu', 'para', 'no', 'na', 'e']);
const expand = (value: string) => normalizeHelp(value).split(' ').map(t => synonyms[t] ?? t);
function createIndex(language: 'en' | 'pt') {
  return helpGuides.map(guide => {
    const extra = [...helpFaqs.filter(f => f.guide === guide.id).flatMap(f => [f.question[language], f.answer[language]]), ...(guide.id === 'shortcuts' ? helpShortcuts.flatMap(s => [s.keys, s.context[language], s.action[language]]) : [])];
    const title = normalizeHelp(guide.title[language]), keywords = normalizeHelp(guide.keywords.join(' ')), summary = normalizeHelp(guide.summary[language]);
    const body = normalizeHelp([...guide.steps, ...guide.tips, ...guide.requirements].map(p => p[language]).concat(extra).join(' '));
    return { guide, title, keywords, summary, expanded: expand(`${title} ${keywords} ${summary} ${body}`).join(' ') };
  });
}
// Normalize packaged content once, not on every keystroke.
const indices = { en: createIndex('en'), pt: createIndex('pt') };
export function searchHelp(query: string, language: 'en' | 'pt') {
  const phrase = normalizeHelp(query);
  const terms = [...new Set(expand(query).filter(t => t && !stopWords.has(t)))];
  if (!phrase || !terms.length) return [];
  return indices[language].flatMap(entry => {
    let score = entry.title === phrase ? 150 : entry.title.includes(phrase) ? 70 : 0;
    for (const term of terms) {
      if (!entry.expanded.includes(term)) return [];
      score += entry.title.includes(term) ? 20 : entry.keywords.includes(term) ? 12 : entry.summary.includes(term) ? 7 : 2;
    }
    return [{ guide: entry.guide, score }];
  }).sort((a, b) => b.score - a.score || a.guide.id.localeCompare(b.guide.id));
}
export function nextHelpResult(current: number, direction: 1 | -1, count: number) { return count ? (current + direction + count) % count : 0; }
