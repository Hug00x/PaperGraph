// Opt-in live acceptance test. Creates and removes its own Supabase user/workspace.
// No email is sent: the administrative test account is created pre-confirmed.
import { createClient } from "@supabase/supabase-js";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { availablePort } from "../electron/ollama-manager.cjs";
import { openAlexDiscovery } from "../src/lib/academic/discovery/openalex-provider.ts";
import { prepareRecommendedArticle } from "../src/lib/academic/discovery/repository.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, ".utmp/discovery-desktop-test");
const execute = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let userId, workspaceId, child, socket, previousProtocol;
const protocolKey = "HKCU\\Software\\Classes\\papergraph\\shell\\open\\command";
async function until(check, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await sleep(500); }
  throw new Error(`Timed out: ${label}`);
}
try {
  const seed = await openAlexDiscovery.lookup("W2626778328");
  const other = await openAlexDiscovery.lookup("10.18653/v1/N19-1423");
  assert.ok(seed && other);
  await mkdir(profile, { recursive: true });
  const email = `papergraph-validation-${randomUUID()}@example.invalid`, password = randomUUID() + randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Discovery validation" } });
  if (created.error) throw new Error(`Create test user: ${created.error.message}`);
  userId = created.data.user.id;
  const login = await user.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(`Test login: ${login.error.message}`);
  const workspace = await user.rpc("create_user_workspace", { requested_workspace_name: "PaperGraph discovery acceptance test" });
  if (workspace.error) throw new Error(`Create test workspace: ${workspace.error.message}`);
  workspaceId = workspace.data[0].workspace_id;
  const fixtures = [seed, other].map((paper) => ({ paper, article: prepareRecommendedArticle(workspaceId, paper, []).article }));
  const inserted = await user.from("articles").insert(fixtures.map(({ paper, article }) => ({
    id: article.id, workspace_id: workspaceId, title: article.title, author: article.author, status: article.status,
    source: article.source, source_type: "latex", tags: article.tags, abstract: paper.abstract, doi: paper.doi,
    openalex_id: paper.externalId, openalex_title: paper.title,
    authors: paper.authors.map((a) => ({ id: a.id, display_name: a.name })), publication_year: paper.year,
    topics: paper.topics.map((t) => ({ id: t.id, display_name: t.name })), referenced_work_ids: paper.references,
  })));
  if (inserted.error) throw new Error(`Seed test workspace: ${inserted.error.message}`);
  const protocol = await execute("reg.exe", ["query", protocolKey, "/ve"], { windowsHide: true }).catch(() => null);
  previousProtocol = protocol?.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1];
  const port = await availablePort(0);
  const env = { ...process.env, APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(root, ".utmp/packaged-profile/local") };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(path.join(root, "desktop-dist/win-unpacked/PaperGraph.exe"), [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, "chromium")}`], { env, windowsHide: true, stdio: "ignore" });
  const target = await until(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:")); } catch { return null; }
  }, "desktop window");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error("Desktop test expression failed");
    return response.result.value;
  };
  const authKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  await evaluate(`localStorage.setItem(${JSON.stringify(authKey)}, ${JSON.stringify(JSON.stringify(login.data.session))}); localStorage.setItem('papergraph-language','pt');`);
  await call("Page.reload");
  await until(async () => evaluate(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Mapa')))`), "signed-in workspace");
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Mapa')).click()`);
  await until(async () => evaluate("document.querySelectorAll('[data-graph-node]').length === 2"), "seed nodes");
  await until(async () => evaluate("window.papergraphRuntime.getState().then(s=>s.phase==='ready')"), "local engine");
  const select = (title) => evaluate(`[...document.querySelectorAll('button')].find(b=>b.querySelector('p')?.textContent===${JSON.stringify(title)}).click()`);
  await select(seed.title);
  await evaluate("document.querySelector('.recommendations-panel button').click()");
  await select(other.title);
  await sleep(1500);
  assert.equal(await evaluate("document.querySelectorAll('.recommendation-item').length"), 0, "Cancelled seed must not populate a different paper");
  await evaluate("document.querySelector('.recommendations-panel button').click()");
  await until(async () => evaluate("document.querySelectorAll('.recommendation-item').length > 0"), "recommendations");
  const title = await evaluate("document.querySelector('.recommendation-item h4').textContent");
  assert.ok(title !== seed.title && title !== other.title);
  await evaluate("document.querySelector('.recommendation-item button').click()");
  await until(async () => evaluate("document.querySelectorAll('[data-graph-node]').length === 3"), "added recommendation node");
  const stored = await user.from("articles").select("id,title,doi,openalex_id,abstract,embedding_model").eq("workspace_id", workspaceId);
  assert.equal(stored.error, null); assert.equal(stored.data.length, 3);
  const added = stored.data.find((a) => a.title === title);
  assert.ok(added?.openalex_id); assert.equal(added.embedding_model, "bge-m3");
  const appUrl = await evaluate("location.origin");
  const repeat = await fetch(`${appUrl}/api/recommendations`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.data.session.access_token}` },
    body: JSON.stringify({ action: "prepare-add", workspaceId, articleId: fixtures[1].article.id, externalId: added.openalex_id }) });
  assert.equal((await repeat.json()).existingId, added.id);
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(profile, "recommendations.png"), Buffer.from(screenshot.data, "base64"));
  await select(title);
  assert.equal(await evaluate("document.querySelectorAll('.recommendation-item').length"), 0);
  await call("Page.reload");
  await until(async () => evaluate("document.querySelectorAll('[data-graph-node]').length === 3"), "persistent nodes after reload");
  const evidence = { switchedSeedIgnoredOldResults: true, addedDirectlyToMap: true, articlePersisted: true,
    duplicatePrevented: true, newArticleSelectable: true, embeddingStored: true, nodesAfterReload: 3 };
  await writeFile(path.join(profile, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  void evaluate("window.close()").catch(() => {});
  await until(async () => child.exitCode !== null, "normal desktop shutdown", 20000);
} finally {
  socket?.close(); if (child && child.exitCode === null) child.kill();
  if (previousProtocol) await execute("reg.exe", ["add", protocolKey, "/ve", "/t", "REG_SZ", "/d", previousProtocol, "/f"], { windowsHide: true });
  if (workspaceId) { const cleaned = await user.rpc("delete_user_workspace", { target_workspace_id: workspaceId }); if (cleaned.error) console.error("Test workspace cleanup failed:", cleaned.error.message); }
  if (userId) { const cleaned = await admin.auth.admin.deleteUser(userId); if (cleaned.error) throw new Error(`Test account cleanup failed: ${cleaned.error.message}`); }
  console.log("Temporary test account/workspace cleanup complete");
}
