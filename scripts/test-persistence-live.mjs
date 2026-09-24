// Opt-in Supabase acceptance test. Creates only a temporary, pre-confirmed user
// and workspace; no email is sent. Removes its own fixtures in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const options = { auth: { persistSession: false, autoRefreshToken: false }, global: {
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
    AbortSignal.timeout(45000), ...(init?.signal ? [init.signal] : []),
  ]) }),
} };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const clients = [0, 1].map(() => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options));
let userId, workspaceId;
const check = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
try {
  const email = `papergraph-persistence-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  userId = check(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  for (const client of clients) check(await client.auth.signInWithPassword({ email, password }));
  workspaceId = check(await clients[0].rpc("create_user_workspace", { requested_workspace_name: "Atomic persistence acceptance test" }))[0].workspace_id;
  const load = async () => check(await clients[0].rpc("load_workspace_snapshot", { p_workspace_id: workspaceId }));
  const initial = await load();
  assert.ok(initial && typeof initial.revision === "string", "Atomic read RPC must be deployed");
  const articleId = randomUUID();
  const snapshot = { language: "pt", articles: [{ id: articleId, title: "Atomic persistence test", author: "Test",
    status: "Published", source_type: "latex", source: "Test fixture", tags: [], abstract: "Test abstract" }],
    article_versions: [], relations: [], article_positions: [{ article_id: articleId, x: 25, y: 35 }],
    assets: [], ignored_unlinked_mentions: [] };
  const save = (client, revision, data) => client.rpc("save_workspace_snapshot", {
    p_workspace_id: workspaceId, p_expected_revision: revision, p_snapshot: data, p_articles_only: false,
  });
  const outcomes = await Promise.all(clients.map((client, i) => save(client, initial.revision,
    { ...snapshot, articles: [{ ...snapshot.articles[0], title: `Concurrent writer ${i}` }] })));
  assert.equal(outcomes.filter((r) => !r.error).length, 1, "Exactly one concurrent writer must succeed");
  assert.match(outcomes.find((r) => r.error).error.message, /workspace-save-conflict/);
  assert.equal(outcomes.find((r) => r.error).status, 409);
  const before = await load();
  const failed = await save(clients[0], before.revision, { ...snapshot,
    assets: [{ id: randomUUID(), article_id: articleId, bucket: "papergraph-assets", storage_path: "test/fixture",
      original_name: "fixture", mime_type: "application/pdf", size_bytes: "invalid-bigint" }] });
  assert.ok(failed.error, "Late failure must be rejected");
  assert.deepEqual(await load(), before, "Failure must roll back every table and revision");
  const legacy = await clients[0].from("articles").delete().eq("workspace_id", workspaceId);
  assert.ok(legacy.error, "Legacy writers must not bypass revision checks");
  console.log(JSON.stringify({ atomicRpcDeployed: true, concurrentWritersProtected: true,
    rollbackVerified: true, legacyWritesBlocked: true }));
} finally {
  try {
    if (workspaceId) check(await clients[0].rpc("delete_user_workspace", { target_workspace_id: workspaceId }));
  } finally {
    if (userId) check(await admin.auth.admin.deleteUser(userId));
  }
  console.log("Temporary persistence fixtures removed");
}
