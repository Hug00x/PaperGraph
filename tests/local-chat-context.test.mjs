import test from 'node:test';
import assert from 'node:assert/strict';
import { localPaperContext, selectPassages, boundedHistory } from '../src/lib/local-chat-context.ts';
const article = { id: 'a', title: 'Paper A', source: '', abstract: 'An abstract.', tags: [], author: '', status: 'Published', updatedAt: '' };
test('uses LaTeX content, not just keyword matches, and labels partial imported PDF context', async () => {
  const signal = new AbortController().signal;
  const latex = await localPaperContext({ ...article, source: '\\section{Results}\nA measured improvement.' }, [], '', 'Quality?', 24000, signal);
  assert.match(latex.text, /measured improvement/); assert.match(latex.coverage, /LaTeX/);
  const source = `% papergraph-import-text:${btoa('PDF introductory text')}\n\\includepdf{papergraph-images/a.pdf}`;
  const pdf = await localPaperContext({ ...article, source }, [], '', 'Quality?', 24000, signal);
  assert.match(pdf.text, /PDF introductory text/); assert.match(pdf.coverage, /first three pages/);
  const abstract = await localPaperContext(article, [], '', 'Quality?', 24000, signal);
  assert.match(abstract.coverage, /abstract only/);
});
test('long documents retain opening and question-relevant excerpts within the limit', () => {
  const source = 'Introduction '.repeat(400) + 'neutral text '.repeat(3000) + 'methodology ablation '.repeat(80) + 'Conclusion '.repeat(400);
  const result = selectPassages(source, 'Explain the methodology ablation', 10000);
  assert.ok(result.partial); assert.ok(result.text.length <= 10000); assert.match(result.text, /Introduction/); assert.match(result.text, /ablation/);
});
test('history preserves recent complete exchanges and respects the context budget', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'x'.repeat(2000) }));
  const kept = boundedHistory(messages); assert.equal(kept[0].role, 'user'); assert.equal(kept.at(-1).role, 'assistant');
  assert.ok(kept.length <= 18); assert.ok(kept.reduce((n, m) => n + m.content.length, 0) <= 20000); assert.equal(kept.at(-1), messages.at(-1));
});
