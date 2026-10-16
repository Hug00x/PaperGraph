import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { helpCategories, helpGuides, helpFaqs, helpShortcuts } from '../src/lib/help/content.ts';
import { searchHelp, nextHelpResult, normalizeHelp } from '../src/lib/help/search.ts';

test('every guide is bilingual, actionable, categorized and tied to existing implementation', () => {
  assert.equal(new Set(helpGuides.map(g => g.id)).size, helpGuides.length);
  for (const category of helpCategories) assert.ok(helpGuides.some(g => g.category === category[0]), category[0]);
  for (const guide of helpGuides) {
    assert.ok(helpCategories.some(c => c[0] === guide.category), guide.id);
    assert.ok(guide.steps.length && guide.keywords.length && guide.sources.length, guide.id);
    for (const value of [guide.title, guide.summary, ...guide.steps, ...guide.tips, ...guide.requirements]) for (const language of ['en', 'pt']) assert.ok(value[language].trim(), `${guide.id}/${language}`);
    assert.ok(guide.keywords.every(k => typeof k === 'string' && k.trim()));
    for (const id of guide.related) assert.ok(helpGuides.some(g => g.id === id) && id !== guide.id, `${guide.id} -> ${id}`);
    for (const source of guide.sources) assert.ok(existsSync(source), `${guide.id}: ${source}`);
  }
  for (const faq of helpFaqs) assert.ok(helpGuides.some(g => g.id === faq.guide));
  assert.equal(new Set(helpShortcuts.map(s => `${s.context.en}:${s.keys}`)).size, helpShortcuts.length);
});
test('exact titles rank first in both languages', () => {
  for (const guide of helpGuides) for (const language of ['en', 'pt']) assert.equal(searchHelp(guide.title[language], language)[0]?.guide.id, guide.id);
});
test('search understands workflow questions, synonyms, accents and case', () => {
  for (const [query, language, expected] of [
    ['How do I connect papers?', 'en', 'relationships'], ['zones', 'en', 'groups'], ['PDF annotations', 'en', 'highlights'],
    ['LaTeX compilation', 'en', 'compile'], ['compilacao', 'pt', 'compile-problems'], ['GRUPOS', 'pt', 'groups'],
    ['Anara', 'en', 'anara'], ['Ctrl+Enter', 'en', 'shortcuts'], ['BGE-M3', 'en', 'semantic'],
  ]) assert.ok(searchHelp(query, language).some(r => r.guide.id === expected), query);
  assert.deepEqual(searchHelp('compilação', 'pt'), searchHelp('COMPILACAO', 'pt'));
  assert.equal(normalizeHelp('Relações'), 'relacoes');
});
test('search empty, irrelevant, multiple results and deterministic ranking', () => {
  for (const query of ['', '   ', 'how do i', 'zzzznonexistent', '<script>private-data</script>']) assert.deepEqual(searchHelp(query, 'en'), []);
  assert.ok(searchHelp('PDF', 'en').length > 1);
  assert.deepEqual(searchHelp('PDF', 'en'), searchHelp('PDF', 'en'));
});
test('keyboard navigation wraps and handles empty results', () => {
  assert.equal(nextHelpResult(0, -1, 5), 4);
  assert.equal(nextHelpResult(4, 1, 5), 0);
  assert.equal(nextHelpResult(1, 1, 5), 2);
  assert.equal(nextHelpResult(0, -1, 0), 0);
});
