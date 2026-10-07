const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHash, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");
const { AnaraConnection, createCallback, allowedUrl } = require("../electron/anara-connection.cjs");

const endpoint = "https://anara.com/api/mcp";
const issuer = "https://anara.com/api/better-auth";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "papergraph-anara-"));
  const key = randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString: value => {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString("utf8");
    },
  };
  let authorization, opened = 0, refreshes = 0, calls = [], revocations = [];
  const fetchFn = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.includes("oauth-protected-resource")) return json({ resource: endpoint, authorization_servers: [issuer], scopes_supported: ["anara:read", "anara:chat", "anara:write"] });
    if (url.pathname.includes("oauth-authorization-server") || url.pathname.includes("openid-configuration")) return json({
      issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`, revocation_endpoint: `${issuer}/oauth2/revoke`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
      scopes_supported: ["anara:read", "anara:write", "offline_access"], authorization_response_iss_parameter_supported: true,
    });
    if (url.pathname.endsWith("/register")) {
      const body = JSON.parse(init.body);
      assert.equal(body.token_endpoint_auth_method, "none");
      assert.equal(body.scope, "anara:read offline_access");
      return json({ ...body, client_id: "fixture-client" }, 201);
    }
    if (url.pathname.endsWith("/token")) {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("resource"), endpoint);
      if (params.get("grant_type") === "authorization_code") {
        assert.equal(params.get("code"), "fixture-code");
        assert.equal(createHash("sha256").update(params.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
      } else { refreshes++; if (options.failRefresh) return json({ error: "invalid_grant" }, 400); }
      return json({ access_token: "fixture-access-secret", refresh_token: "fixture-refresh-secret", token_type: "Bearer", expires_in: 3600, scope: "anara:read offline_access" });
    }
    if (url.pathname.endsWith("/revoke")) { revocations.push(new URLSearchParams(init.body)); return new Response(null, { status: options.failRevoke ? 401 : 200 }); }
    if (url.href === endpoint) {
      if (init.method === "GET") return new Response(null, { status: 405 });
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer fixture-access-secret");
      const message = JSON.parse(init.body);
      calls.push(message.method);
      if (message.method === "initialize") return json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Anara fixture", version: "1" } } });
      if (message.method === "tools/list") return json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "anara_run_code", inputSchema: { type: "object" } }] } });
      return new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  const openExternal = async value => {
    opened++;
    authorization = new URL(value);
    assert.equal(authorization.searchParams.get("scope"), "anara:read offline_access");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    if (options.pending) return;
    const callback = new URL(authorization.searchParams.get("redirect_uri"));
    callback.searchParams.set("state", authorization.searchParams.get("state"));
    callback.searchParams.set(options.denied ? "error" : "code", options.denied ? "access_denied" : "fixture-code");
    callback.searchParams.set("iss", options.badIssuer ? "https://evil.example" : issuer);
    assert.equal((await fetch(callback)).status, 200);
  };
  const manager = new AnaraConnection({ directory, safeStorage, openExternal, fetchFn });
  t.after(async () => { await manager.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { manager, directory, safeStorage, fetchFn, openExternal, get opened() { return opened; }, get refreshes() { return refreshes; }, calls, revocations };
}
async function connected(f) { f.manager.connect(); await f.manager.task; assert.equal(f.manager.state.status, "connected"); }

test("official SDK completes public OAuth with PKCE, initializes MCP and discovers tools without executing them", async t => {
  const f = fixture(t);
  f.manager.connect(); f.manager.connect();
  await f.manager.task;
  assert.deepEqual(f.manager.state, { status: "connected", error: null });
  assert.equal(f.opened, 1);
  assert.ok(f.calls.includes("tools/list"));
  assert.ok(!f.calls.includes("tools/call"));
  assert.ok(!JSON.stringify(f.manager.state).includes("secret"));
  const stored = fs.readFileSync(f.manager.file);
  assert.ok(!stored.includes(Buffer.from("fixture-access-secret")));
  assert.ok(!stored.includes(Buffer.from("fixture-refresh-secret")));
  await f.manager.disconnect();
  assert.equal(f.manager.state.status, "disconnected");
  assert.ok(!fs.existsSync(f.manager.file));
  assert.equal(f.revocations.length, 2);
});

test("restart refreshes expired credentials silently and validates the session", async t => {
  const f = fixture(t); await connected(f); await f.manager.stop();
  f.manager.record.expiresAt = Date.now() - 1000; f.manager.persist();
  const restored = new AnaraConnection({ directory: f.directory, safeStorage: f.safeStorage, fetchFn: f.fetchFn, openExternal: () => { throw new Error("Must not open browser"); } });
  t.after(() => restored.stop());
  await restored.restore(); await restored.task;
  assert.equal(restored.state.status, "connected");
  assert.equal(f.refreshes, 1);
});

test("issuer mismatch never exchanges the authorization code", async t => {
  const f = fixture(t, { badIssuer: true });
  f.manager.connect(); await f.manager.task;
  assert.equal(f.manager.state.status, "error");
  assert.ok(!f.manager.record.tokens);
});

test("cancelling browser authorization cannot resurrect credentials", async t => {
  const f = fixture(t, { pending: true });
  const opened = new Promise(resolve => { f.manager.openExternal = () => resolve(); });
  f.manager.connect(); await opened;
  await f.manager.disconnect(); await f.manager.task;
  assert.deepEqual(f.manager.state, { status: "disconnected", error: null });
  assert.ok(!fs.existsSync(f.manager.file));
});

test("disconnect deletes local tokens even if remote revocation fails", async t => {
  const f = fixture(t, { failRevoke: true }); await connected(f);
  await f.manager.disconnect();
  assert.deepEqual(f.manager.state, { status: "disconnected", error: "revocation-unconfirmed" });
  assert.ok(!fs.existsSync(f.manager.file));
});

test("declined consent leaves no tokens or MCP session", async t => {
  const f = fixture(t, { denied: true });
  f.manager.connect(); await f.manager.task;
  assert.equal(f.manager.state.status, "error");
  assert.ok(!f.manager.record.tokens);
  assert.equal(f.calls.length, 0);
});

test("invalid refresh requires reconnect without opening the browser", async t => {
  const f = fixture(t, { failRefresh: true }); await connected(f);
  f.manager.record.expiresAt = Date.now() - 1000;
  f.manager.start(false); await f.manager.task;
  assert.equal(f.manager.state.status, "expired");
  assert.equal(f.opened, 1);
  assert.ok(!f.manager.record.tokens);
});

test("secure storage is required and non-Anara network destinations are rejected", async t => {
  const f = fixture(t);
  f.safeStorage.isEncryptionAvailable = () => false;
  assert.deepEqual(f.manager.connect(), { status: "error", error: "storage-unavailable" });
  for (const url of ["http://anara.com", "https://evil.example", "https://anara.com.evil.example", "https://user:password@anara.com"]) assert.throws(() => allowedUrl(url));
});

test("loopback callback rejects mismatched state, host, duplicates and methods without consuming the attempt", async () => {
  const controller = new AbortController();
  const callback = await createCallback("expected", controller.signal);
  try {
    assert.equal((await fetch(`${callback.url}?state=wrong&code=x`)).status, 400);
    assert.equal((await fetch(`${callback.url}?state=expected&code=x`, { method: "POST" })).status, 400);
    assert.equal((await fetch(`${callback.url}?state=expected&code=x&code=y`)).status, 400);
    const invalidHost = await new Promise((resolve, reject) => {
      const req = http.get(`${callback.url}?state=expected&code=x`, { headers: { Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
    });
    assert.equal(invalidHost, 400);
    assert.equal((await fetch(`${callback.url}?state=expected&code=x&iss=${encodeURIComponent(issuer)}`)).status, 200);
    assert.equal((await callback.result).get("code"), "x");
  } finally { callback.close(); }
});
