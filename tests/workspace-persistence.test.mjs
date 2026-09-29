import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { persistWorkspace, rememberWorkspaceRevision, refreshWorkspace } from "../src/lib/workspace-persistence.ts";
import { loadWorkspaceSnapshotFromSupabase, saveWorkspaceSnapshotToSupabase, saveWorkspaceArticles, refreshWorkspaceSnapshotFromSupabase } from "../src/lib/supabase-workspace.ts";
import { defaultSnapshot } from "../src/lib/workspace-data.ts";
import { mergeWorkspace } from "../src/lib/workspace-merge.ts";

const owner = "00000000-0000-0000-0000-000000000001";
const viewer = "00000000-0000-0000-0000-000000000002";
const outsider = "00000000-0000-0000-0000-000000000003";
const workspace = "00000000-0000-0000-0000-000000000004";
const secondWorkspace = "00000000-0000-0000-0000-000000000005";
const articleId = "00000000-0000-0000-0000-000000000006";
const article = { id: articleId, title: "Research", author: "Author", status: "Published", source: "Scientific source", tags: [], abstract: "Abstract" };
const payload = (overrides = {}) => ({ language: "pt", articles: [article],
  article_versions: [{ id: "version-1", article_id: articleId, title: "Research", author: "Author", status: "Published", source: "v1", tags: [] }],
  relations: [{ from_article_id: articleId, to_article_id: articleId, relation_type: "manual", note: "test" }],
  article_positions: [{ article_id: articleId, x: 30, y: 40 }],
  assets: [{ id: "asset-1", article_id: articleId, bucket: "papergraph-assets", storage_path: "test/file.pdf", original_name: "file.pdf", mime_type: "application/pdf", size_bytes: 1 }],
  ignored_unlinked_mentions: [{ source_article_id: articleId, target_article_id: articleId, mention_key: "key" }], ...overrides });

async function database(uuidIds = false) {
  const db = new PGlite();
  const bootstrap = await readFile(new URL("../supabase/bootstrap-workspace.sql", import.meta.url), "utf8");
  let tables = bootstrap.slice(bootstrap.indexOf("create table"), bootstrap.indexOf("create or replace function public.is_workspace_member"));
  if (uuidIds) tables = tables.replace("create table if not exists public.articles (\n  id text", "create table if not exists public.articles (\n  id uuid").replace("create table if not exists public.articles (\r\n  id text", "create table if not exists public.articles (\r\n  id uuid");
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    ${tables}
    create function public.is_workspace_member(w uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid()) $$;
    create function public.can_edit_workspace(w uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid() and member_role in ('owner','editor','member')) $$;
    insert into auth.users values ('${owner}'), ('${viewer}'), ('${outsider}');
    insert into public.workspaces(id,owner_id) values ('${workspace}','${owner}'), ('${secondWorkspace}','${outsider}');
    insert into public.workspace_members(workspace_id,user_id,member_role) values
      ('${workspace}','${owner}','owner'),('${workspace}','${viewer}','viewer'),('${secondWorkspace}','${outsider}','owner');
    create policy members on public.workspaces for select to authenticated using (public.is_workspace_member(id));
    grant select,insert,update,delete on all tables in schema public to authenticated;
    alter table public.articles
      add abstract text, add openalex_id text, add openalex_title text, add doi text,
      add authors jsonb not null default '[]', add publication_year integer, add cited_by_count integer,
      add topics jsonb not null default '[]', add referenced_work_ids text[] not null default '{}',
      add academic_input_hash text, add embedding jsonb, add embedding_model text, add embedding_input_hash text;
  `);
  for (const table of ["articles", "article_versions", "relations", "article_positions", "assets", "ignored_unlinked_mentions"]) {
    await db.exec(`create policy members on public.${table} for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.can_edit_workspace(workspace_id));`);
  }
  const semantic = await readFile(new URL("../supabase/migrations/202609230001_semantic_search.sql", import.meta.url), "utf8");
  await db.exec(semantic.slice(semantic.indexOf("create or replace function public.invalidate_article_embedding"), semantic.indexOf("-- Security invoker")));
  await db.exec(await readFile(new URL("../supabase/migrations/202609240001_atomic_workspace.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202609270001_graph_zones.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202609270002_zone_notes.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202609280001_workspace_merge_language.sql", import.meta.url), "utf8"));
  await db.exec(`set role authenticated; set test.user_id='${owner}';`);
  return db;
}
const save = async (db, revision, snapshot = payload(), partial = false, id = workspace) =>
  (await db.query("select public.save_workspace_snapshot($1,$2,$3,$4) as revision", [id, revision, snapshot, partial])).rows[0].revision;
const load = async (db, id = workspace) => (await db.query("select public.load_workspace_snapshot($1) as snapshot", [id])).rows[0].snapshot;

test("PDF highlights survive snapshot saves and follow article deletion", async () => {
  const db = await database();
  try {
    await db.exec('reset role');
    await db.exec(await readFile(new URL('../supabase/migrations/202609280003_pdf_highlights.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set test.user_id='${owner}'`);
    await save(db, '0');
    await db.query(`insert into public.pdf_highlights(workspace_id,article_id,document_key,page_number,selected_text,rects) values ($1,$2,$3,1,'Passage',$4)`, [workspace,articleId,'a'.repeat(64),JSON.stringify([{x:0.1,y:0.1,width:0.2,height:0.1}])]);
    await save(db, '1', payload({articles:[{...article,title:'Renamed article'}]}));
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length,1);
    await save(db, '2', payload({articles:[],article_versions:[],relations:[],article_positions:[],assets:[],ignored_unlinked_mentions:[]}));
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length,0);
  } finally { await db.close(); }
});

function databaseClient(db) {
  return { rpc: async (name, args) => {
    try {
      const data = name === "load_workspace_snapshot" ? await load(db, args.p_workspace_id) :
        await save(db, args.p_expected_revision, args.p_snapshot, args.p_articles_only, args.p_workspace_id);
      return { data, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  } };
}

test("live refresh receives groups and positions, retains local drafts and rebases the next save", async () => {
  const db = await database();
  try {
    await save(db, "0");
    const a = databaseClient(db), b = databaseClient(db);
    let visible = await loadWorkspaceSnapshotFromSupabase(b, workspace);
    const first = await loadWorkspaceSnapshotFromSupabase(a, workspace);
    visible = { ...visible, articles: visible.articles.map(row => ({ ...row, title: "Unsaved local title" })) };
    first.zones = [{ id: "live-zone", name: "Live group", color: "green", x: 20, y: 20, width: 25, height: 25 }];
    first.articlePositions[articleId] = { x: 36, y: 37 };
    await saveWorkspaceSnapshotToSupabase(a, { id: workspace, language: "pt" }, first);
    assert.equal(await refreshWorkspaceSnapshotFromSupabase(b, { id: workspace, language: "pt" }, () => visible, next => { visible = next; }), true);
    assert.deepEqual(visible.zones, first.zones);
    assert.deepEqual(visible.articlePositions[articleId], { x: 36, y: 37 });
    assert.equal(visible.articles[0].title, "Unsaved local title");
    assert.equal((await load(db)).articles[0].title, article.title, "refresh never writes local drafts");
    visible.articlePositions[articleId] = { x: 40, y: 41 };
    await saveWorkspaceSnapshotToSupabase(b, { id: workspace, language: "pt" }, visible);
    assert.equal((await load(db)).articles[0].title, "Unsaved local title");
    assert.deepEqual((await load(db)).zones, first.zones);
  } finally { await db.close(); }
});

test("live refresh discards responses when editing, switching sessions or queuing a save during the fetch", async () => {
  for (const change of ["edit", "session", "save"]) {
    let release;
    let started;
    const fetching = new Promise(resolve => { started = resolve; });
    const client = { rpc: async (name) => {
      if (name === "load_workspace_snapshot") { started(); return new Promise(resolve => { release = resolve; }); }
      return { data: "2", error: null };
    } };
    const baseline = payload();
    const identity = rememberWorkspaceRevision(client, workspace, "1", baseline);
    let current = true, applied = false;
    const refresh = refreshWorkspace(client, workspace, () => ({ identity, payload: baseline, isCurrent: () => current }), () => { applied = true; });
    await fetching;
    let savePromise;
    if (change === "edit") current = false;
    if (change === "session") rememberWorkspaceRevision(client, workspace, "5", baseline);
    if (change === "save") savePromise = persistWorkspace(client, workspace, baseline, false, identity);
    release({ data: { ...baseline, revision: "1" }, error: null });
    assert.equal(await refresh, false);
    if (savePromise) await savePromise;
    assert.equal(applied, false, change);
  }
});

test("private map policies isolate workspaces and restrict viewer broadcasts", async () => {
  const db = await database();
  try {
    await db.exec(`reset role;
      create schema realtime;
      create table realtime.messages(extension text);
      alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic', true) $$;
      grant usage on schema realtime to authenticated;
      grant select, insert on realtime.messages to authenticated;
      insert into realtime.messages values ('broadcast'), ('presence');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/202609280002_graph_realtime.sql", import.meta.url), "utf8"));
    await db.exec(`set role authenticated; set test.user_id='${viewer}'; set test.topic='papergraph:workspace:${workspace}:map';`);
    assert.equal((await db.query("select * from realtime.messages")).rows.length, 2);
    await db.exec("insert into realtime.messages values ('presence')");
    await assert.rejects(db.exec("insert into realtime.messages values ('broadcast')"), /row-level security/);
    await db.exec(`set test.user_id='${owner}';`);
    await db.exec("insert into realtime.messages values ('broadcast')");
    await db.exec(`set test.user_id='${outsider}';`);
    assert.equal((await db.query("select * from realtime.messages")).rows.length, 0);
    await assert.rejects(db.exec("insert into realtime.messages values ('presence')"), /row-level security/);
  } finally { await db.close(); }
});

test("two sessions merge independent article changes and preserve unseen additions on subsequent saves", async () => {
  const db = await database();
  try {
    const other = { ...article, id: "other", title: "Other" };
    await save(db, "0", payload({ articles: [article, other] }));
    const a = databaseClient(db), b = databaseClient(db);
    const first = await loadWorkspaceSnapshotFromSupabase(a, workspace);
    const second = await loadWorkspaceSnapshotFromSupabase(b, workspace);
    const saveSnapshot = (client, snapshot) => saveWorkspaceSnapshotToSupabase(client, { id: workspace, language: "pt" }, snapshot);
    first.articles[0].title = "Writer A";
    first.articles.push({ ...article, id: "new", title: "New remote article", updatedAt: "now" });
    await saveSnapshot(a, first);
    second.articles.find((row) => row.id === "other").title = "Writer B";
    await saveSnapshot(b, second);
    let current = await load(db);
    assert.equal(current.articles.find((row) => row.id === articleId).title, "Writer A");
    assert.equal(current.articles.find((row) => row.id === "other").title, "Writer B");
    assert.ok(current.articles.some((row) => row.id === "new"));
    second.articles.find((row) => row.id === "other").source = "B edits again without reloading";
    await saveSnapshot(b, second);
    current = await load(db);
    assert.equal(current.articles.length, 3);
    assert.equal(current.articles.find((row) => row.id === articleId).title, "Writer A");
    assert.equal(current.articles.find((row) => row.id === "other").source, "B edits again without reloading");
  } finally { await db.close(); }
});

test("same-field conflicts preserve the winner and block further stale saves", async () => {
  const db = await database();
  try {
    await save(db, "0");
    const a = databaseClient(db), b = databaseClient(db);
    const first = await loadWorkspaceSnapshotFromSupabase(a, workspace);
    const second = await loadWorkspaceSnapshotFromSupabase(b, workspace);
    first.articles[0].source = "A's text";
    second.articles[0].source = "B's text";
    await saveWorkspaceArticles(a, workspace, first.articles, first.persistenceSession);
    await assert.rejects(saveWorkspaceArticles(b, workspace, second.articles, second.persistenceSession), /workspace-save-conflict/);
    await assert.rejects(saveWorkspaceArticles(b, workspace, second.articles, second.persistenceSession), /workspace-reload-required/);
    assert.equal((await load(db)).articles[0].source, "A's text");
    assert.equal(second.articles[0].source, "B's text");
  } finally { await db.close(); }
});

test("three-way merge handles fields, geometry, timestamps, language and partial upserts", () => {
  const zone = { id: "z", name: "Zone", color: "green", x: 10, y: 10, width: 20, height: 20 };
  const base = payload({ zones: [zone] });
  const local = structuredClone(base), remote = structuredClone(base);
  local.articles[0].title = "Local title";
  remote.articles[0].source = "Remote text";
  remote.articles[0].updated_at = "later";
  local.zones[0].name = "Local zone";
  remote.zones[0].x = 40;
  remote.language = "en";
  local.relations[0].created_at = "local time";
  remote.relations[0].id = "regenerated";
  const merged = mergeWorkspace(base, local, remote);
  assert.equal(merged.articles[0].title, "Local title");
  assert.equal(merged.articles[0].source, "Remote text");
  assert.equal(merged.zones[0].name, "Local zone");
  assert.equal(merged.zones[0].x, 40);
  assert.equal(merged.language, "en");
  assert.equal(merged.relations.length, 1);
  const partial = mergeWorkspace(base, { articles: [{ ...article, id: "new" }] }, remote, true);
  assert.equal(partial.articles.length, 2);
  assert.equal(partial.articles.find((row) => row.id === articleId).source, "Remote text");
  assert.deepEqual(partial.zones, remote.zones);
});

test("edit/delete races and newly added dependent elements cannot silently disappear", () => {
  const base = payload();
  const deleted = payload({ articles: [], article_versions: [], relations: [], article_positions: [], assets: [], ignored_unlinked_mentions: [] });
  const edited = payload({ articles: [{ ...article, source: "Changed" }] });
  assert.throws(() => mergeWorkspace(base, deleted, edited), /workspace-save-conflict/);
  assert.throws(() => mergeWorkspace(base, edited, deleted), /workspace-save-conflict/);
  const withNewAsset = structuredClone(base);
  withNewAsset.assets.push({ ...base.assets[0], id: "new-asset" });
  assert.throws(() => mergeWorkspace(base, deleted, withNewAsset), /workspace-save-conflict/);
  assert.throws(() => mergeWorkspace(base, withNewAsset, deleted), /workspace-save-conflict/);
  assert.deepEqual(mergeWorkspace(base, base, deleted).articles, []);
});

test("merge retries remain bounded when other writers keep winning", async () => {
  const base = payload();
  let saves = 0, loads = 0;
  const client = { rpc: async (name) => {
    if (name === "load_workspace_snapshot") { loads++; return { data: { ...base, revision: String(loads + 1) }, error: null }; }
    saves++;
    return { data: null, error: { message: "workspace-save-conflict" } };
  } };
  rememberWorkspaceRevision(client, workspace, "1", base);
  await assert.rejects(persistWorkspace(client, workspace, base), /workspace-reload-required/);
  assert.equal(saves, 4);
  assert.equal(loads, 3);
  await assert.rejects(persistWorkspace(client, workspace, base), /workspace-reload-required/);
});

test("Zones and member positions save atomically, survive old clients, validate geometry and respect permissions", async () => {
  const db = await database();
  const zone = { id: "zone-1", name: "Method 1", color: "green", x: 20, y: 30, width: 20, height: 20 };
  try {
    assert.deepEqual((await load(db)).zones, []);
    await save(db, "0", payload({ zones: [zone] }));
    assert.deepEqual((await load(db)).zones, [zone]);
    await save(db, "1", payload()); // An older writer omits Zones; it must preserve them.
    assert.deepEqual((await load(db)).zones, [zone]);
    const before = await load(db);
    await assert.rejects(save(db, "2", payload({ zones: [{ ...zone, width: -1 }], article_positions: [{ article_id: articleId, x: 99, y: 99 }] })), /valid_workspace_zones/);
    assert.deepEqual(await load(db), before);
    await save(db, "2", payload({ zones: [zone, { ...zone, id: "overlap", color: "violet" }] }));
    await assert.rejects(save(db, "3", payload({ zones: [{ ...zone, color: "url(evil)" }] })), /valid_workspace_zones/);
    await assert.rejects(save(db, "3", payload({ zones: [{ ...zone, notes: "x".repeat(20001) }] })), /valid_workspace_zones/);
    await assert.rejects(db.query("update public.workspaces set zones='[]' where id=$1", [workspace]), /permission denied/);
    await db.exec(`set test.user_id='${viewer}';`);
    assert.deepEqual((await load(db)).zones, [zone, { ...zone, id: "overlap", color: "violet" }]);
    await assert.rejects(save(db, "2", payload({ zones: [] })), /workspace-write-forbidden/);
    await db.exec(`set test.user_id='${owner}';`);
    await save(db, "3", payload({ zones: [] }));
    assert.deepEqual((await load(db)).zones, []);
    assert.equal((await load(db)).articles.length, 1);
  } finally { await db.close(); }
});

test("SQL transaction saves all tables and fully rolls back a late failure", async () => {
  const db = await database();
  try {
    assert.equal(await save(db, "0"), "1");
    const before = await load(db);
    for (const key of ["articles", "article_versions", "relations", "article_positions", "assets", "ignored_unlinked_mentions"]) assert.equal(before[key].length, 1);
    await assert.rejects(save(db, "1", payload({ articles: [{ ...article, title: "Must roll back" }], assets: [{ ...payload().assets[0], size_bytes: "not-a-number" }] })), /invalid input syntax/);
    assert.deepEqual(await load(db), before);
    assert.equal(await save(db, "1", payload({ articles: [], article_versions: [], relations: [], article_positions: [], assets: [], ignored_unlinked_mentions: [] })), "2");
    assert.equal((await load(db)).articles.length, 0);
  } finally { await db.close(); }
});

test("two writers with the same revision cannot overwrite or delete the winner's changes", async () => {
  const db = await database();
  try {
    const results = await Promise.allSettled([
      save(db, "0", payload({ articles: [{ ...article, title: "First writer" }] })),
      save(db, "0", payload({ articles: [] })),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(results.find((r) => r.status === "rejected").reason.message, /workspace-save-conflict/);
    assert.equal(results.find((r) => r.status === "rejected").reason.code, "PT409");
    assert.equal((await load(db)).articles[0].title, "First writer");
    await assert.rejects(save(db, null), /workspace-save-conflict/);
    await assert.rejects(save(db, "0", { articles: [article] }, true), /workspace-save-conflict/);
  } finally { await db.close(); }
});

test("viewer, outsider and anonymous calls cannot write; old direct snapshot writes are blocked", async () => {
  const db = await database();
  try {
    await save(db, "0");
    await assert.rejects(db.query("delete from public.articles where workspace_id=$1", [workspace]), /permission denied/);
    await assert.rejects(db.query("update public.workspaces set snapshot_revision=999 where id=$1", [workspace]), /permission denied/);
    await db.exec(`set test.user_id='${viewer}';`);
    assert.equal((await load(db)).articles.length, 1);
    await assert.rejects(save(db, "1"), /workspace-write-forbidden/);
    await db.exec(`set test.user_id='${outsider}';`);
    assert.equal(await load(db), null);
    await assert.rejects(save(db, "1"), /workspace-write-forbidden/);
    await db.exec("set test.user_id='';");
    await assert.rejects(save(db, "1"), /workspace-write-forbidden/);
    await db.exec("reset role; set role anon;");
    await assert.rejects(load(db), /permission denied/);
  } finally { await db.close(); }
});

test("UUID article schema, scientific metadata and vectors survive partial and full saves", async () => {
  const db = await database(true);
  try {
    assert.equal(await save(db, "0", { articles: [{ ...article, authors: [{ display_name: "Scientist" }], topics: [{ id: "T1" }], referenced_work_ids: ["W1"] }] }, true), "1");
    await db.query("update public.articles set embedding='[1,2]', embedding_model='model', embedding_input_hash='hash' where workspace_id=$1", [workspace]);
    await save(db, "1");
    const row = (await db.query("select authors,topics,referenced_work_ids,embedding from public.articles where workspace_id=$1", [workspace])).rows[0];
    assert.deepEqual(row.authors, [{ display_name: "Scientist" }]);
    assert.deepEqual(row.embedding, [1, 2]);
    assert.deepEqual(row.referenced_work_ids, ["W1"]);
    assert.equal((await load(db)).revision, "2");
    await save(db, "2", payload({ articles: [{ ...article, title: "Changed title" }] }));
    assert.equal((await db.query("select embedding from public.articles where workspace_id=$1", [workspace])).rows[0].embedding, null);
  } finally { await db.close(); }
});

test("uncertain network outcome freezes writes instead of retrying against a fresh revision", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; throw new Error("Network disconnected after commit"); } };
  rememberWorkspaceRevision(client, workspace, "1", payload());
  await assert.rejects(persistWorkspace(client, workspace, payload()), /Network disconnected/);
  await assert.rejects(persistWorkspace(client, workspace, payload()), /workspace-reload-required/);
  assert.equal(calls, 1);
});

test("an operation started before reload cannot use the newly loaded revision", async () => {
  const calls = [];
  const client = { rpc: async (_, args) => { calls.push(args); return { data: "21", error: null }; } };
  const oldLoad = rememberWorkspaceRevision(client, workspace, "10");
  const newLoad = rememberWorkspaceRevision(client, workspace, "20");
  await assert.rejects(persistWorkspace(client, workspace, {}, false, oldLoad), /workspace-reload-required/);
  assert.equal(calls.length, 0);
  await persistWorkspace(client, workspace, {}, false, newLoad);
  assert.equal(calls[0].p_expected_revision, "20");
});

test("caller-supplied workspace IDs are overridden and another workspace is untouched", async () => {
  const db = await database();
  try {
    const forged = payload({ articles: [{ ...article, workspace_id: secondWorkspace }],
      assets: [{ ...payload().assets[0], workspace_id: secondWorkspace }] });
    await save(db, "0", forged);
    const own = await load(db);
    assert.equal(own.articles.length, 1);
    assert.equal(own.assets[0].workspace_id, workspace);
    await db.exec(`set test.user_id='${outsider}';`);
    assert.equal((await load(db, secondWorkspace)).articles.length, 0);
    assert.equal((await load(db, secondWorkspace)).assets.length, 0);
  } finally { await db.close(); }
});

test("client serializes partial/full writes, blocks queued retries after conflict, and requires an explicit reload", async () => {
  const calls = [];
  const client = { rpc: async (_, args) => {
    calls.push(args);
    return args.p_snapshot.fail ? { error: { message: "workspace-save-conflict" } } : { data: String(Number(args.p_expected_revision) + 1), error: null };
  } };
  await assert.rejects(persistWorkspace(client, workspace, {}), /workspace-reload-required/);
  rememberWorkspaceRevision(client, workspace, "7");
  await Promise.all([persistWorkspace(client, workspace, {}, true), persistWorkspace(client, workspace, {})]);
  assert.deepEqual(calls.map((c) => c.p_expected_revision), ["7", "8"]);
  const failed = await Promise.allSettled([persistWorkspace(client, workspace, { fail: true }), persistWorkspace(client, workspace, {})]);
  assert.ok(failed.every((r) => r.status === "rejected"));
  assert.equal(calls.length, 3);
  rememberWorkspaceRevision(client, workspace, "12");
  await persistWorkspace(client, workspace, {});
  assert.equal(calls.at(-1).p_expected_revision, "12");
});

test("client integration loads one consistent snapshot and saves through the RPC without direct table writes", async () => {
  const db = await database();
  const client = { rpc: async (name, args) => {
    try {
      const data = name === "load_workspace_snapshot" ? await load(db, args.p_workspace_id) :
        await save(db, args.p_expected_revision, args.p_snapshot, args.p_articles_only, args.p_workspace_id);
      return { data, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  } };
  try {
    const loaded = await loadWorkspaceSnapshotFromSupabase(client, workspace);
    await saveWorkspaceArticles(client, workspace, [{ ...article, updatedAt: "now" }]);
    const zones = [{ id: "zone-adapter", name: "Restored zone", color: "teal", notes: "Method notes\nNext steps", x: 20, y: 30, width: 20, height: 20 }];
    await saveWorkspaceSnapshotToSupabase(client, { id: workspace, language: "en" }, { ...defaultSnapshot, zones, articlePositions: { [articleId]: { x: 30.123456, y: 40 } }, persistenceSession: loaded.persistenceSession, articles: [{ ...article, updatedAt: "now" }] });
    const snapshot = await loadWorkspaceSnapshotFromSupabase(client, workspace);
    assert.equal(snapshot.articles[0].abstract, "Abstract");
    assert.deepEqual(snapshot.zones, zones);
    assert.equal(snapshot.articlePositions[articleId].x, 30.123456);
    assert.equal((await load(db)).revision, "2");
  } finally { await db.close(); }
});
