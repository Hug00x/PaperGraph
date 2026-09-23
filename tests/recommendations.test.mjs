import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDoi, samePaper, uniqueNewPapers, safePublicationUrl, recommendedArticleSource, discoveredMetadata, articleIdentity } from "../src/lib/academic/discovery/identity.ts";
import { abstractFromInvertedIndex } from "../src/lib/academic/openalex.ts";
import { buildSemanticQuery, normalizeOpenAlexWork, OpenAlexDiscoveryProvider } from "../src/lib/academic/discovery/openalex-provider.ts";
import { rankRecommendations, cosineSimilarity } from "../src/lib/academic/discovery/ranking.ts";
import { RecommendationService, ExpiringCache } from "../src/lib/academic/discovery/service.ts";
import { prepareRecommendedArticle, scientificSeed } from "../src/lib/academic/discovery/repository.ts";
import { textHash, paperText, generateEmbeddings, generateEmbedding } from "../src/lib/academic/embedding.ts";
import { OpenAlexClient, retryAfterMs } from "../src/lib/academic/openalex-client.ts";
import { discoveryConfig } from "../src/lib/academic/discovery/config.ts";

const vector = (index = 0) => Array.from({ length: 1024 }, (_, i) => Number(i === index));
const raw = (id, overrides = {}) => ({ id: `https://openalex.org/W${id}`, doi: `https://doi.org/10.1234/paper${id}`,
  title: `Scientific study number ${id}`, abstract_inverted_index: { Learning: [0], from: [1], data: [2] },
  publication_year: 2020, authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Research Author" } }],
  topics: [{ id: "https://openalex.org/T1", display_name: "Learning" }], referenced_works: [],
  primary_location: { source: { display_name: "Research Journal" }, landing_page_url: "https://example.org/paper" },
  relevance_score: 1.4, ...overrides });
const paper = (id, overrides) => normalizeOpenAlexWork(raw(id, overrides));

test("DOI normalization, DOI/OpenAlex aliases and fallback title/year identity", () => {
  assert.equal(normalizeDoi(" DOI: https://doi.org/10.1234/ABC "), "10.1234/abc");
  assert.ok(samePaper(paper(1), { ...paper(2), doi: "DOI: 10.1234/PAPER1" }));
  assert.ok(samePaper(paper(1), { title: "Custom node name", externalId: "W1" }));
  assert.ok(samePaper({ title: "A scientific study: in detail", year: 2020 }, { title: "A scientific study in detail", year: 2020 }));
  assert.equal(samePaper({ title: "A scientific study", year: 2020 }, { title: "A scientific study", year: 2021 }), false);
  assert.equal(samePaper(paper(1), { ...paper(2), title: paper(1).title }), false);
});
test("abstract reconstruction accepts unordered positions and rejects malformed indexes", () => {
  assert.equal(abstractFromInvertedIndex({ data: [2], Learning: [0], from: [1] }), "Learning from data");
  assert.equal(abstractFromInvertedIndex({ broken: "abc", bad: [-1, Infinity], valid: [0] }), "valid");
  assert.equal(abstractFromInvertedIndex(null), "");
});
test("mapper rejects malformed works and URLs, preserves supported scientific fields", () => {
  assert.equal(normalizeOpenAlexWork({ id: "bad", title: "A scientific paper" }), null);
  const mapped = paper(1, { primary_location: { landing_page_url: "javascript:alert(1)" }, topics: [{}], authorships: [null], abstract_inverted_index: null });
  assert.equal(mapped.abstract, ""); assert.equal(mapped.url, "https://doi.org/10.1234/paper1");
  assert.equal(safePublicationUrl("file:///C:/Windows/x.exe"), "");
  assert.equal(paper(1).venue, "Research Journal");
  assert.equal(paper(1).providerScore, 1.4);
});
test("query contains only scientific title/abstract, bounded by Unicode characters", () => {
  const query = buildSemanticQuery({ title: "A scientific study", abstract: "🧬".repeat(3000), notes: "PRIVATE", tags: ["PRIVATE"] });
  assert.equal(Array.from(query).length, 2000); assert.ok(!query.includes("PRIVATE"));
  assert.equal(buildSemanticQuery({ title: "A scientific study", abstract: "" }), "A scientific study");
  assert.throws(() => buildSemanticQuery({ title: "document.pdf", abstract: "" }), /insufficient-metadata/);
});
test("deduplication removes seed, existing workspace papers and duplicate DOI results", () => {
  assert.deepEqual(uniqueNewPapers([paper(1), paper(2), paper(3), paper(4, { doi: paper(3).doi.toUpperCase() })], [paper(1), paper(2)]).map((p) => p.externalId), [paper(3).externalId]);
});
test("cosine validates dimensions and finite nonzero vectors", () => {
  assert.equal(cosineSimilarity(vector(), vector()), 1); assert.equal(cosineSimilarity(vector(), vector(1)), 0);
  assert.throws(() => cosineSimilarity([1], [1])); assert.throws(() => cosineSimilarity(Array(1024).fill(0), vector()));
});
test("local semantic score dominates, provider scores >1 are normalized and reasons are proven", () => {
  const seed = { ...paper(1), references: [paper(2).externalId] };
  const candidates = [paper(2, { relevance_score: 100000 }), paper(3, { relevance_score: 1, referenced_works: [seed.externalId] })];
  const ranked = rankRecommendations(seed, candidates, [0.2, 0.8]);
  assert.equal(ranked[0].externalId, paper(3).externalId);
  assert.ok(ranked.every((p) => p.finalScore <= 1));
  assert.ok(ranked[0].reasons.some((r) => r.type === "cites-seed"));
  assert.ok(ranked[1].reasons.some((r) => r.type === "seed-cites"));
  assert.ok(!ranked[1].reasons.some((r) => r.type.includes("semantic")));
  assert.deepEqual(rankRecommendations(seed, candidates, [0.2, 0.8]), ranked);
  const noAuthorIds = rankRecommendations(seed, [{ ...paper(5), authors: [{ id: "", name: "Research Author" }], topics: [] }], [0.4])[0];
  assert.ok(!noAuthorIds.reasons.some((r) => r.type === "authors"));
});
test("service reuses stored seed vector, batches candidates and filters cached results against current workspace", async () => {
  let providerCalls = 0; const batches = [];
  const seed = paper(1);
  const service = new RecommendationService({ async findRelatedPaperCandidates() { providerCalls++; return [seed, ...Array.from({ length: 12 }, (_, i) => paper(i + 2))]; } },
    async (texts) => { batches.push(texts); return texts.map(() => vector()); });
  const options = { scope: "workspace:seed", seed, existing: [], stored: { embedding: JSON.stringify(vector()), embedding_model: "bge-m3", embedding_input_hash: textHash(paperText(seed)) } };
  const first = await service.recommend(options);
  assert.equal(first.reranking, "local"); assert.equal(first.papers.length, discoveryConfig.displayCount);
  assert.equal(batches.flat().length, 12); assert.ok(batches.every((batch) => batch.length <= discoveryConfig.batchSize));
  const second = await service.recommend({ ...options, existing: [first.papers[0]] });
  assert.equal(providerCalls, 1); assert.equal(second.cached, true);
  assert.ok(second.papers.every((p) => p.externalId !== first.papers[0].externalId));
  await service.recommend({ ...options, refresh: true }); assert.equal(providerCalls, 2); assert.equal(batches.flat().length, 12);
});
test("without local runtime recommendations survive in provider order", async () => {
  const service = new RecommendationService({ async findRelatedPaperCandidates() { return [paper(2, { relevance_score: 1 }), paper(3, { relevance_score: 2, abstract_inverted_index: null })]; } }, async () => { throw new Error("Runtime offline"); });
  const result = await service.recommend({ scope: "fallback", seed: paper(1), existing: [] });
  assert.equal(result.reranking, "unavailable"); assert.equal(result.papers[0].externalId, paper(3).externalId);
  assert.ok(result.papers.every((p) => p.semanticScore === undefined));
  assert.ok(result.papers[0].reasons.some((r) => r.type === "title-only"));
});
test("cancellation never becomes provider fallback or caches stale results", async () => {
  const controller = new AbortController();
  const service = new RecommendationService({ async findRelatedPaperCandidates() { return [paper(2)]; } }, async () => { controller.abort(); throw controller.signal.reason; });
  await assert.rejects(service.recommend({ scope: "cancelled", seed: paper(1), existing: [], signal: controller.signal }), { name: "AbortError" });
});
test("bounded cache expires and evicts oldest entries", (t) => {
  let now = 100; t.mock.method(Date, "now", () => now);
  const cache = new ExpiringCache(2); cache.set("a", 1, 10); cache.set("b", 2, 10); cache.set("c", 3, 10);
  assert.equal(cache.get("a"), undefined); assert.equal(cache.get("b"), 2); now = 111; assert.equal(cache.get("b"), undefined);
});
test("add payload uses stable IDs and inert metadata; repeated add returns existing article", () => {
  const first = prepareRecommendedArticle("workspace-a", paper(2), []);
  const second = prepareRecommendedArticle("workspace-a", paper(2), []);
  assert.equal(first.article.id, second.article.id);
  assert.equal(first.article.status, "Published");
  assert.equal(discoveredMetadata(first.article.source).externalId, paper(2).externalId);
  assert.equal(discoveredMetadata(first.article.source).abstract, paper(2).abstract);
  const duplicate = prepareRecommendedArticle("workspace-a", paper(2), [first.article]);
  assert.equal(duplicate.existingId, first.article.id); assert.equal(duplicate.article, null);
  assert.ok(samePaper(articleIdentity(first.article), paper(2)));
  assert.ok(recommendedArticleSource({ ...paper(2), title: "Paper \\input{private}" }).includes("\\textbackslash{}input\\{private\\}"));
});
test("private node labels and notes never become external discovery queries", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not send private data"); });
  await assert.rejects(scientificSeed({ title: "Personal note about secret project", source: "Private comments", tags: [], doi: null, openalex_id: null, openalex_title: null }), /insufficient-metadata/);
  const scientific = paper(2);
  assert.equal((await scientificSeed({ title: "Renamed private node", source: recommendedArticleSource(scientific) })).title, scientific.title);
});
test("OpenAlex client handles real semantic parameters, 429 Retry-After and malformed responses", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.origin, "https://api.openalex.org");
    assert.ok(url.searchParams.has("search.semantic"));
    assert.equal(url.searchParams.get("per-page"), String(discoveryConfig.candidateCount));
    calls++; return calls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "0" } }) : Response.json({ results: [raw(2)] });
  });
  const result = await new OpenAlexDiscoveryProvider().findRelatedPaperCandidates({ title: "A scientific title", abstract: "" });
  assert.equal(result.length, 1); assert.equal(calls, 2);
  assert.equal(retryAfterMs("120"), 120000);
  assert.equal(retryAfterMs(new Date(10000).toUTCString(), 2000), 8000);
});
test("network/long rate-limit failures are bounded and cancelled queues do not fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("", { status: 429, headers: { "Retry-After": "120" } }); });
  const client = new OpenAlexClient();
  await assert.rejects(client.fetch("https://api.openalex.org/works"), /rate-limit/); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.fetch("https://api.openalex.org/works", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});
test("embedding batch uses the existing endpoint and is reusable on import", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => { calls++; assert.ok(url.endsWith("/api/embed")); assert.deepEqual(JSON.parse(options.body).input, ["Batch A", "Batch B"]); return Response.json({ embeddings: [vector(), vector(1)] }); });
  await generateEmbeddings(["Batch A", "Batch B"]);
  assert.deepEqual(await generateEmbedding("Batch A"), vector()); assert.equal(calls, 1);
});
