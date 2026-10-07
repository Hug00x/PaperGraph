const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { Client, StreamableHTTPClientTransport, auth } = require("@modelcontextprotocol/client");

const ENDPOINT = "https://anara.com/api/mcp";
const SCOPE = "anara:read offline_access";
const RESEARCH_SCOPE = "anara:read anara:chat offline_access";
const { LIMITS } = require('./research-contract.cjs');

function allowedUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://anara.com" || url.username || url.password) throw new Error("Untrusted Anara endpoint");
  return url;
}

// A temporary listener is separate from Next.js and never handles Supabase auth.
async function createCallback(state, signal) {
  let resolveResult, rejectResult, consumed = false;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // The browser can finish before the caller starts awaiting the result.
  result.catch(() => {});
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    let url;
    try { url = new URL(req.url, "http://127.0.0.1"); }
    catch { res.writeHead(400); res.end("Invalid authorization callback."); return; }
    const incoming = Buffer.from(url.searchParams.get("state") || "");
    const expected = Buffer.from(state);
    const valid = incoming.length === expected.length && timingSafeEqual(incoming, expected);
    if (req.method !== "GET" || req.headers.host !== `127.0.0.1:${server.address()?.port}` ||
        url.pathname !== "/anara/callback" || !valid || consumed ||
        ["state", "code", "iss", "error"].some(key => url.searchParams.getAll(key).length > 1)) {
      res.writeHead(400); res.end("Invalid authorization callback."); return;
    }
    if (!url.searchParams.get("code") && !url.searchParams.get("error")) {
      res.writeHead(400); res.end("Missing authorization result."); return;
    }
    consumed = true;
    res.end("Authorization received. Return to PaperGraph to see the connection status.");
    resolveResult(url.searchParams);
    server.close();
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.maxHeadersCount = 30;
  const close = () => { server.close(); server.closeAllConnections(); rejectResult(new Error("Authorization cancelled")); };
  signal.addEventListener("abort", close, { once: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  if (signal.aborted) { close(); throw new Error("Authorization cancelled"); }
  return { url: `http://127.0.0.1:${server.address().port}/anara/callback`, result,
    close: () => { signal.removeEventListener("abort", close); close(); } };
}

class AnaraConnection extends EventEmitter {
  constructor({ directory, safeStorage, openExternal, focus, sdk = { Client, StreamableHTTPClientTransport, auth }, fetchFn = fetch }) {
    super();
    this.file = path.join(directory, "anara-credentials.bin");
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.focus = focus;
    this.sdk = sdk;
    this.fetchFn = fetchFn;
    this.state = { status: "disconnected", error: null };
    this.generation = 0;
    this.record = {};
  }

  setState(status, error = null) { this.state = { status, error }; this.emit("state", this.state); }
  secureStorageAvailable() {
    return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  }
  persist() {
    if (!this.secureStorageAvailable()) throw new Error("Secure storage unavailable");
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, this.safeStorage.encryptString(JSON.stringify(this.record)), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  async restore() {
    if (!fs.existsSync(this.file)) return;
    try {
      if (!this.secureStorageAvailable()) throw new Error("Secure storage unavailable");
      this.record = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
      if (!this.record.tokens?.access_token) { this.setState("disconnected"); return; }
      this.start(false);
    } catch { this.setState("error", "storage-unavailable"); }
  }
  connect() {
    if (this.disconnecting || this.state.status === "connecting" || this.state.status === "connected") return this.state;
    if (!this.secureStorageAvailable()) { this.setState("error", "storage-unavailable"); return this.state; }
    this.start(true);
    return this.state;
  }
  connectForResearch() {
    if (this.disconnecting || this.state.status === 'connecting' || this.researchActive) return this.state;
    if (this.state.status === 'connected' && this.record.tokens?.scope?.split(' ').includes('anara:chat')) return this.state;
    if (!this.secureStorageAvailable()) { this.setState('error', 'storage-unavailable'); return this.state; }
    this.start(true, RESEARCH_SCOPE);
    return this.state;
  }
  start(interactive, scope = this.record.scope || SCOPE) {
    if (this.researchActive) { this.timer = setTimeout(() => this.start(false), 15000); this.timer.unref?.(); return; }
    clearTimeout(this.timer);
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.setState("connecting");
    this.task = this.run(interactive, generation, controller, scope).catch(() => {
      if (generation === this.generation) this.setState("error", "connection-failed");
    });
  }
  async run(interactive, generation, controller, scope) {
    let callback, verifier, discovery;
    const oauthState = randomBytes(32).toString("hex");
    const current = () => {
      if (generation !== this.generation || controller.signal.aborted) throw new Error("Stale Anara operation");
    };
    const deadline = setTimeout(() => controller.abort(), 180000);
    const request = async (input, init = {}) => {
      current();
      const url = allowedUrl(input);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000), ...(init.signal ? [init.signal] : [])]);
      const response = await this.fetchFn(url, { ...init, signal, redirect: "error" });
      if (Number(response.headers.get('content-length')) > LIMITS.responseBytes) throw new Error('Anara response too large');
      if (!response.body) return response;
      const reader = response.body.getReader(); let received = 0;
      return new Response(new ReadableStream({
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { stream.close(); return; }
            received += chunk.value.byteLength;
            if (received > LIMITS.responseBytes) { await reader.cancel(); stream.error(new Error('Anara response too large')); return; }
            stream.enqueue(chunk.value);
          } catch (error) { stream.error(error); }
        }, cancel: reason => reader.cancel(reason),
      }), { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    try {
      await this.client?.close().catch(() => {});
      current();
      if (interactive) {
        callback = await createCallback(oauthState, controller.signal);
        current();
        // Dynamic redirect ports require a newly registered public client.
        this.record = { redirectUrl: callback.url, scope };
        this.persist();
      }
      const redirectUrl = callback?.url || this.record.redirectUrl;
      const provider = {
        redirectUrl,
        clientMetadata: { client_name: "PaperGraph", redirect_uris: [redirectUrl],
          grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
          token_endpoint_auth_method: "none", scope },
        state: () => oauthState,
        clientInformation: () => { current(); return this.record.client; },
        saveClientInformation: value => { current(); this.record.client = value; },
        tokens: () => { current(); return this.record.tokens; },
        saveTokens: value => {
          current();
          if (value.scope?.split(" ").some(granted => !scope.split(" ").includes(granted))) throw new Error("Unexpected permissions");
          this.record.tokens = { ...value, scope: value.scope || this.record.tokens?.scope || scope };
          this.record.expiresAt = value.expires_in ? Date.now() + value.expires_in * 1000 : null;
          this.persist();
        },
        saveCodeVerifier: value => { current(); verifier = value; },
        codeVerifier: () => { current(); return verifier; },
        saveDiscoveryState: value => { current(); discovery = value; },
        discoveryState: () => discovery,
        invalidateCredentials: scope => {
          current();
          if (scope === "tokens" || scope === "all") { delete this.record.tokens; delete this.record.expiresAt; this.persist(); }
          if (scope === "client" || scope === "all") delete this.record.client;
          if (scope === "verifier" || scope === "all") verifier = undefined;
          if (scope === "discovery" || scope === "all") discovery = undefined;
        },
        redirectToAuthorization: async value => {
          current();
          if (!interactive || !callback) throw Object.assign(new Error("Reauthorization required"), { code: "reauthorization-required" });
          const url = allowedUrl(value);
          if (url.searchParams.get("scope")?.split(" ").some(granted => !scope.split(" ").includes(granted))) throw new Error("Unexpected permissions");
          await this.openExternal(url.href);
        },
      };
      const needsAuth = interactive || (this.record.expiresAt && this.record.expiresAt <= Date.now() + 60000);
      if (needsAuth) {
        const result = await this.sdk.auth(provider, { serverUrl: ENDPOINT, scope, fetchFn: request });
        if (result === "REDIRECT") {
          const params = await callback.result;
          current();
          // SDK validates issuer (including error responses), then exchanges with PKCE.
          const transport = new this.sdk.StreamableHTTPClientTransport(new URL(ENDPOINT), { authProvider: provider, fetch: request });
          try { await transport.finishAuth(params); } finally { await transport.close(); }
          this.focus?.();
        }
      }
      current();
      this.client = new this.sdk.Client({ name: "PaperGraph", version: "0.1.9" }, { capabilities: {} });
      this.transport = new this.sdk.StreamableHTTPClientTransport(new URL(ENDPOINT), { authProvider: provider, fetch: request });
      await this.client.connect(this.transport);
      // Discovery only: no research tool is executed or exposed through IPC.
      let cursor;
      let pages = 0;
      this.tools = [];
      do {
        const page = await this.client.listTools(cursor ? { cursor } : {});
        current();
        this.tools.push(...page.tools);
        cursor = page.nextCursor;
        if (this.tools.length > 1000 || ++pages > 100) throw new Error("Too many tools");
      } while (cursor);
      current();
      this.setState("connected");
      const delay = this.record.expiresAt ? Math.max(1000, Math.min(300000, this.record.expiresAt - Date.now() - 60000)) : 300000;
      this.timer = setTimeout(() => this.start(false), delay);
      this.timer.unref?.();
    } catch (error) {
      if (generation === this.generation) {
        await this.client?.close().catch(() => {});
        if (generation !== this.generation) return;
        this.tools = [];
        const expired = ["reauthorization-required", "invalid_grant", "invalid_token"].includes(error.code) || error.name === "UnauthorizedError";
        this.setState(!interactive && expired ? "expired" : "error", controller.signal.aborted ? "connection-timeout" : "connection-failed");
      }
    } finally { clearTimeout(deadline); callback?.close(); verifier = undefined; }
  }

  disconnect() {
    if (this.disconnecting) return this.disconnecting;
    this.disconnecting = this.performDisconnect().finally(() => { this.disconnecting = null; });
    return this.disconnecting;
  }
  async performDisconnect() {
    const previous = this.record;
    ++this.generation;
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.client?.close().catch(() => {});
    this.tools = [];
    try {
      fs.rmSync(this.file, { force: true });
      fs.rmSync(`${this.file}.tmp`, { force: true });
      this.record = {};
    } catch { this.setState("error", "storage-removal-failed"); return this.state; }
    this.setState("disconnected");
    // Anara currently advertises confidential-client revocation methods only.
    // Try RFC 7009 public-client revocation; never claim that local deletion revoked a grant.
    let revoked = true;
    for (const [key, hint] of [["refresh_token", "refresh_token"], ["access_token", "access_token"]]) {
      if (!previous.tokens?.[key]) continue;
      try {
        const response = await this.fetchFn("https://anara.com/api/better-auth/oauth2/revoke", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: previous.tokens[key], token_type_hint: hint, client_id: previous.client?.client_id || "" }),
        });
        revoked = response.ok && revoked;
      } catch { revoked = false; }
    }
    if (!revoked && this.state.status === "disconnected") this.setState("disconnected", "revocation-unconfirmed");
    return this.state;
  }
  async stop() {
    ++this.generation;
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.client?.close().catch(() => {});
  }
}

module.exports = { AnaraConnection, createCallback, allowedUrl };
