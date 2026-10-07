import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchPaper, existingResearchPaper, canAddResearchPaper } from '../src/lib/deep-research-context.ts';
import { recommendedArticleSource } from '../src/lib/academic/discovery/identity.ts';
import { prepareRecommendedArticle } from '../src/lib/academic/discovery/repository.ts';
import { OpenAlexDiscoveryProvider } from '../src/lib/academic/discovery/openalex-provider.ts';
import { openAlexClient } from '../src/lib/academic/openalex-client.ts';
const paper = { source: 'openalex', externalId: 'https://openalex.org/W123', title: 'Public scientific article title', doi: '10.1234/public', abstract: 'Public abstract', authors: [{ name: 'Scientific author', id: '' }], year: 2020, topics: [], references: [], venue: 'Journal', url: 'https://doi.org/10.1234/public', citationCount: 0, type: 'article' };
const article = { id: 'article-a', title: 'Private node label', author: 'Private uploader', source: `${recommendedArticleSource(paper)}\nPRIVATE_LATEX_AND_NOTES`, status: 'Published', tags: [] };
test('context extracts only academic metadata and strips source, uploader, graph and notes', () => {
  const context = researchPaper(article);
  assert.deepEqual(context, { title: paper.title, doi: paper.doi, openAlexId: paper.externalId, abstract: paper.abstract, year: paper.year, authors: ['Scientific author'] });
  assert.ok(!JSON.stringify(context).includes('PRIVATE'));
  assert.ok(!JSON.stringify(context).includes('uploader'));
});
test('duplicate detection reuses DOI, OpenAlex IDs and normalized-title fallback', () => {
  const candidate = { ...researchPaper(article), url: '', relevanceExplanation: '' };
  assert.equal(existingResearchPaper(candidate, [article]).id, article.id);
  assert.equal(existingResearchPaper({ ...candidate, doi: null }, [article]).id, article.id);
  assert.equal(existingResearchPaper({ ...candidate, doi: null, openAlexId: null }, [article]).id, article.id);
  assert.equal(prepareRecommendedArticle('workspace', paper, [article]).existingId, article.id);
});
test('canonical import uses existing identity/source conventions and Viewer writes remain disabled', () => {
  const prepared = prepareRecommendedArticle('workspace', paper, []);
  assert.equal(prepared.article.status, 'Published');
  assert.ok(prepared.article.source.startsWith('% papergraph-discovery:'));
  assert.equal(canAddResearchPaper(false, 'workspace', 'access'), false);
  assert.equal(canAddResearchPaper(true, '', 'access'), false);
  assert.equal(canAddResearchPaper(true, 'workspace', 'access'), true);
});

test('research resolution uses stable identifiers or a unique exact normalized title, never a fuzzy match', async t => {
  const provider = new OpenAlexDiscoveryProvider();
  t.mock.method(provider, 'lookup', async id => { assert.equal(id, '10.1234/public'); return paper; });
  assert.equal(await provider.resolveResearchPaper({ title: paper.title, doi: paper.doi }), paper);
  t.mock.method(openAlexClient, 'fetch', async url => {
    assert.equal(new URL(url).searchParams.get('search.title'), paper.title);
    return Response.json({ results: [{ id: 'W123', title: paper.title, publication_year: 2020 }, { id: 'W555', title: 'An unrelated fuzzy title', publication_year: 2020 }] });
  });
  assert.equal((await provider.resolveResearchPaper({ title: paper.title, year: 2020 })).externalId, paper.externalId);
  t.mock.method(openAlexClient, 'fetch', async () => Response.json({ results: [{ id: 'W123', title: paper.title }, { id: 'W456', title: paper.title }] }));
  assert.equal(await provider.resolveResearchPaper({ title: paper.title }), null);
});
