import test from "node:test";
import assert from "node:assert/strict";
import { generateEmbedding, paperText, textHash } from "../src/lib/academic/embedding.ts";
import { preparePaper, refreshAcademicRelations } from "../src/lib/academic/papers.ts";
import { getSimilarPapers, getSemanticSimilarityThreshold } from "../src/lib/academic/semantic-search.ts";
import { resolveOpenAlexWork, citationProfile, buildCitationRelations } from "../src/lib/academic/openalex.ts";
import { extractPdfMetadata, importedPdfMetadata, titleFromPdfItems } from "../src/lib/academic/pdf-metadata.ts";

const vector = Array(1024).fill(0.01);
const input = { id: "paper-a", title: "Graph learning", source: "", tags: [] };
function savedPaper(overrides = {}) {
  return { ...input, abstract: "Learning graph representations", doi: null, openalex_id: null,
    referenced_work_ids: [], academic_input_hash: textHash(JSON.stringify(input)),
    embedding_model: "bge-m3", embedding_input_hash: textHash(paperText({ title: input.title, abstract: "Learning graph representations" })), ...overrides };
}

function fakeDatabase(papers, rpcResults = []) {
  const updates = [];
  const rpcCalls = [];
  return {
    updates, rpcCalls,
    from(table) {
      assert.equal(table, "articles");
      const filters = [];
      let update;
      const result = () => {
        const matched = papers.filter((paper) => filters.every(([key, value]) => key === "workspace_id" || JSON.stringify(paper[key]) === JSON.stringify(value)));
        if (update) {
          updates.push(update);
          matched.forEach((paper) => Object.assign(paper, update));
        }
        return { data: matched, error: null };
      };
      const query = {
        select() { return query; },
        update(value) { update = value; return query; },
        eq(key, value) {
          if (key === "tags") {
            assert.equal(typeof value, "string", "PostgREST array equality requires a PostgreSQL array literal");
            value = JSON.parse(`[${value.slice(1, -1)}]`);
          }
          filters.push([key, value]); return query;
        },
        is(key, value) { filters.push([key, value]); return query; },
        in() { return query; },
        async maybeSingle() { const r = result(); return { ...r, data: r.data[0] ?? null }; },
        then(resolve) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
    async rpc(name, args) { rpcCalls.push({ name, args }); return { data: rpcResults, error: null }; },
  };
}

test("Ollama uses configured endpoint, title + abstract, and validates 1024 dimensions", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://localhost:11434/api/embed");
    assert.deepEqual(JSON.parse(options.body), { model: "bge-m3", input: "Title\n\nAbstract", truncate: false });
    return Response.json({ embeddings: [vector] });
  });
  assert.deepEqual(await generateEmbedding(paperText({ title: "Title", abstract: "Abstract", doi: "ignored" })), vector);
});

test("invalid, zero, nonfinite vectors and service errors are rejected without fallback", async (t) => {
  t.mock.method(console, "error", () => {});
  const mock = t.mock.method(globalThis, "fetch");
  for (const embeddings of [[], [[1, 2]], [Array(1024).fill(0)], [Array(1024).fill(null)]]) {
    mock.mock.mockImplementation(async () => Response.json({ embeddings }));
    await assert.rejects(generateEmbedding("Title"), /Embedding service unavailable/);
  }
  mock.mock.mockImplementation(async () => { throw new Error("connection refused"); });
  await assert.rejects(generateEmbedding("Title"), /Embedding service unavailable/);
  mock.mock.mockImplementation(async () => new Response("missing model", { status: 404 }));
  await assert.rejects(generateEmbedding("Title"), /Embedding service unavailable/);
});

test("unchanged papers reuse stored metadata and embeddings without network requests", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected network request"); });
  const db = fakeDatabase([]);
  const result = await preparePaper(db, "workspace", savedPaper());
  assert.deepEqual(result.warnings, []);
  assert.equal(db.updates.length, 0);
});

test("missing embeddings are stored once and reused on retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ embeddings: [vector] }); });
  const paper = savedPaper({ embedding_model: null, embedding_input_hash: null });
  const db = fakeDatabase([paper]);
  assert.deepEqual((await preparePaper(db, "workspace", paper)).warnings, []);
  assert.equal(db.updates[0].embedding.length, 1024);
  await preparePaper(db, "workspace", paper);
  assert.equal(calls, 1);
});

test("abstract edits and model changes invalidate cache", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ embeddings: [vector] }); });
  for (const overrides of [{ abstract: "New abstract" }, { embedding_model: "old-model" }]) {
    const paper = savedPaper(overrides);
    const db = fakeDatabase([paper]);
    await preparePaper(db, "workspace", paper);
    assert.equal(db.updates.length, 1);
  }
  assert.equal(calls, 2);
});

test("source-only edits refresh metadata without recreating an unchanged embedding", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    requests++;
    assert.match(String(url), /^https:\/\/api.openalex.org\//);
    return Response.json({ results: [] });
  });
  const paper = savedPaper({ source: "An edited note without metadata changes" });
  const db = fakeDatabase([paper]);
  const result = await preparePaper(db, "workspace", paper);
  assert.deepEqual(result.warnings, []);
  assert.equal(requests, 1);
  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].embedding, undefined);
});

test("Ollama URL and model can be changed through server configuration", async (t) => {
  const oldUrl = process.env.OLLAMA_BASE_URL;
  const oldModel = process.env.OLLAMA_EMBEDDING_MODEL;
  process.env.OLLAMA_BASE_URL = "http://embedding-server:11434/";
  process.env.OLLAMA_EMBEDDING_MODEL = "bge-m3:pinned";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://embedding-server:11434/api/embed");
    assert.equal(JSON.parse(options.body).model, "bge-m3:pinned");
    return Response.json({ embeddings: [vector] });
  });
  try {
    assert.equal((await generateEmbedding("Title")).length, 1024);
  } finally {
    if (oldUrl === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = oldUrl;
    if (oldModel === undefined) delete process.env.OLLAMA_EMBEDDING_MODEL; else process.env.OLLAMA_EMBEDDING_MODEL = oldModel;
  }
});

test("concurrent title edit prevents storing a stale embedding", async (t) => {
  t.mock.method(console, "warn", () => {});
  const paper = savedPaper({ embedding_input_hash: null, embedding_model: null });
  const db = fakeDatabase([{ ...paper, title: "Concurrent edit" }]);
  // No row matches the old title when the embedding request completes.
  t.mock.method(globalThis, "fetch", async () => {
    return Response.json({ embeddings: [vector] });
  });
  const result = await preparePaper(db, "workspace", paper);
  assert.match(result.warnings[0], /Paper changed/);
  assert.equal(db.updates.length, 1);
});

test("database RPC handles nearest neighbours with workspace, model and limit", async () => {
  const expected = [{ paper: { id: "paper-b", title: "Related paper" }, similarity: 0.91 }];
  const db = fakeDatabase([], expected);
  assert.deepEqual(await getSimilarPapers(db, "workspace", "paper-a", 5), expected);
  assert.deepEqual(db.rpcCalls, [{ name: "get_similar_papers", args: {
    p_workspace_id: "workspace", p_article_id: "paper-a", p_limit: 5, p_model: "bge-m3",
  } }]);
  await assert.rejects(getSimilarPapers(db, "workspace", "paper-a", 0), /Invalid similarity limit/);
});

test("Ollama failure returns a warning while citation links survive", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  const first = savedPaper({ openalex_id: "W1", referenced_work_ids: ["W2"], embedding_model: null, embedding_input_hash: null });
  const secondInput = { ...input, id: "paper-b" };
  const second = savedPaper({ ...secondInput, academic_input_hash: textHash(JSON.stringify(secondInput)), openalex_id: "W2" });
  const result = await refreshAcademicRelations(fakeDatabase([first, second]), "workspace", [first.id, second.id], "en");
  assert.deepEqual(result.warnings, ["Embedding service unavailable"]);
  assert.equal(result.relations[0].relationType, "citation");
});

test("OpenAlex title lookup does not accept an unrelated first search result", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ results: [{ id: "W1", title: "Unrelated paper" }] }));
  assert.equal(await resolveOpenAlexWork(input), null);
});

test("reciprocal database neighbours above the threshold become a single graph edge", async () => {
  const first = savedPaper();
  const secondInput = { ...input, id: "paper-b" };
  const second = savedPaper({ ...secondInput, academic_input_hash: textHash(JSON.stringify(secondInput)) });
  const db = fakeDatabase([first, second]);
  db.rpc = async (_name, args) => ({ error: null, data: [
    { paper: { id: args.p_article_id === first.id ? second.id : first.id }, similarity: 0.544150764447421 },
  ] });
  const result = await refreshAcademicRelations(db, "workspace", [first.id, second.id], "en");
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].note, "Semantic similarity: 54%.");
  assert.equal(result.diagnostics.semanticThreshold, 0.5);
});

test("graph minimum applies to raw scores, permits isolated papers and does not suppress citations", async () => {
  const first = savedPaper({ openalex_id: "W1", referenced_work_ids: ["W2"] });
  const secondInput = { ...input, id: "paper-b" };
  const second = savedPaper({ ...secondInput, openalex_id: "W2", academic_input_hash: textHash(JSON.stringify(secondInput)) });
  for (const score of [0.407571812382561, 0.49999, 0.5, 0.7, NaN]) {
    const db = fakeDatabase([first, second]);
    db.rpc = async (_name, args) => ({ error: null, data: [
      { paper: { id: args.p_article_id === first.id ? second.id : first.id }, similarity: score },
    ] });
    const result = await refreshAcademicRelations(db, "workspace", [first.id, second.id], "en");
    assert.equal(result.relations.filter((r) => r.relationType === "semantic").length, score >= 0.5 ? 1 : 0);
    assert.equal(result.relations.filter((r) => r.relationType === "citation").length, 1);
  }
});

test("graph threshold is configurable and invalid configuration cannot silently create weak links", async () => {
  const original = process.env.SEMANTIC_SIMILARITY_THRESHOLD;
  try {
    delete process.env.SEMANTIC_SIMILARITY_THRESHOLD;
    assert.equal(getSemanticSimilarityThreshold(), 0.5);
    process.env.SEMANTIC_SIMILARITY_THRESHOLD = "0.65";
    assert.equal(getSemanticSimilarityThreshold(), 0.65);
    const first = savedPaper();
    const secondInput = { ...input, id: "paper-b" };
    const second = savedPaper({ ...secondInput, academic_input_hash: textHash(JSON.stringify(secondInput)) });
    const db = fakeDatabase([first, second], [{ paper: { id: second.id }, similarity: 0.6 }]);
    const result = await refreshAcademicRelations(db, "workspace", [first.id, second.id], "en");
    assert.equal(result.relations.length, 0);
    assert.equal(result.diagnostics.semanticThreshold, 0.65);
    for (const invalid of ["65", "50%", "NaN", "-0.1", "Infinity"]) {
      process.env.SEMANTIC_SIMILARITY_THRESHOLD = invalid;
      assert.throws(getSemanticSimilarityThreshold, /between 0 and 1/);
    }
  } finally {
    if (original === undefined) delete process.env.SEMANTIC_SIMILARITY_THRESHOLD;
    else process.env.SEMANTIC_SIMILARITY_THRESHOLD = original;
  }
});

test("DOI URL metadata still matches citation identifiers", () => {
  const a = citationProfile({ ...input, source: "References 10.1234/example" }, { doi: null, openalex_id: null, referenced_work_ids: [] });
  const b = citationProfile({ ...input, id: "paper-b" }, { doi: "https://doi.org/10.1234/example", openalex_id: null, referenced_work_ids: [] });
  assert.equal(buildCitationRelations([a, b], "en").length, 1);
});

const abstractText = "We investigate graph representations for scientific documents and evaluate their usefulness in finding related research across multiple collections.";
const pdfSource = (text) => `% papergraph-import-text:${Buffer.from(text).toString("base64")}`;

test("extracts multiline and legacy flattened abstracts without including the introduction", () => {
  for (const separator of ["\n", " "]) {
    const result = extractPdfMetadata(`A research title${separator}Abstract${separator}${abstractText}${separator}Keywords: graphs${separator}1 Introduction${separator}Unrelated body`);
    assert.equal(result.abstract, abstractText);
  }
  assert.equal(extractPdfMetadata("Scanned PDF without text").abstract, null);
  assert.equal(extractPdfMetadata(`Abstract ${abstractText} body without a boundary`).abstract, null);
});

test("PDF identity ignores DOI references and DOI on later pages", () => {
  assert.equal(extractPdfMetadata("Title\nReferences\n10.1234/cited-work").doi, null);
  assert.equal(extractPdfMetadata("Title\fSecond page 10.1234/cited-work").doi, null);
  assert.equal(extractPdfMetadata("Title\ndoi:10.1234/own-work.\nReferences 10.1234/cited-work").doi, "10.1234/own-work");
});

test("title extraction joins large title lines and excludes journal headers and authors", () => {
  const item = (str, height, y) => ({ str, height, transform: [1, 0, 0, 1, 20, y] });
  assert.equal(titleFromPdfItems([
    item("Journal of Science", 24, 800), item("Learning representations", 18, 750),
    item("of scientific documents", 18, 729), item("Alice Smith", 11, 680), item("Abstract", 12, 620),
  ]), "Learning representations of scientific documents");
  assert.equal(titleFromPdfItems([
    item("Toward a Theory of Intrinsically", 18, 578),
    item("Instruction*", 18, 554), item("Motivating", 18, 579),
  ]), "Toward a Theory of Intrinsically Motivating Instruction");
});

test("local PDF abstract is persisted and embedded when OpenAlex is offline", async (t) => {
  t.mock.method(console, "warn", () => {});
  let embeddedText;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).includes("openalex.org")) throw new Error("offline");
    embeddedText = JSON.parse(options.body).input;
    return Response.json({ embeddings: [vector] });
  });
  const paper = savedPaper({ source: pdfSource(`Title\nAbstract\n${abstractText}\nKeywords: graphs`), abstract: null });
  const db = fakeDatabase([paper]);
  const result = await preparePaper(db, "workspace", paper);
  assert.equal(paper.abstract, abstractText);
  assert.equal(embeddedText, `${paper.title}\n\n${abstractText}`);
  assert.equal(paper.academic_input_hash, null); // Permit a later metadata retry.
  assert.ok(result.warnings.some((warning) => warning.includes("OpenAlex")));
});

test("OpenAlex work without abstract preserves the PDF abstract", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => String(url).includes("openalex.org")
    ? Response.json({ results: [{ id: "W123", title: input.title, abstract_inverted_index: null }] })
    : Response.json({ embeddings: [vector] }));
  const paper = savedPaper({ source: pdfSource(`Abstract ${abstractText} Keywords: graphs`), abstract: null });
  await preparePaper(fakeDatabase([paper]), "workspace", paper);
  assert.equal(paper.abstract, abstractText);
  assert.equal(paper.openalex_id, "W123");
});

test("OpenAlex retries transient rate limits and resolves by document DOI", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /10.1234\/own/);
    return ++count === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } })
      : Response.json({ id: "W123", title: "Matched paper" });
  });
  const work = await resolveOpenAlexWork({ ...input, source: pdfSource("Title DOI:10.1234/own\nReferences 10.1234/other") });
  assert.equal(work.id, "W123");
  assert.equal(count, 2);
});

test("legacy imported sources decode Unicode and recover abstracts without reimport", () => {
  const text = `Resumo ${abstractText} Keywords: investigação`;
  assert.equal(importedPdfMetadata(pdfSource(text)).abstract, abstractText);
});
