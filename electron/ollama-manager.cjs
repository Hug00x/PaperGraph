const { EventEmitter } = require("node:events");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { existsSync, appendFileSync } = require("node:fs");
const { mkdir } = require("node:fs/promises");
const { createServer } = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const config = require("./embedding-runtime-config.json");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execute = promisify(execFile);
function hasModel(payload) {
  return Array.isArray(payload?.models) && payload.models.some((item) =>
    [config.model, `${config.model}:latest`].includes(item.name ?? item.model));
}
async function availablePort(preferred = config.preferredPort) {
  async function listen(port) {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, config.host, resolve); });
    const selected = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return selected;
  }
  try { return await listen(preferred); } catch { return listen(0); }
}

class OllamaManager extends EventEmitter {
  constructor({ runtimeDirectory, dataDirectory, guardianPath = path.join(__dirname.replace(/app\.asar([\\/])/, "app.asar.unpacked$1"), "ollama-guardian.ps1") }) {
    super();
    this.runtimeDirectory = runtimeDirectory;
    this.dataDirectory = dataDirectory;
    this.guardianPath = guardianPath;
    this.state = { phase: "idle", completed: 0, total: 0, percentage: null, error: null };
    this.token = randomBytes(32).toString("hex");
    this.process = null;
    this.stopping = false;
    this.operation = null;
    this.controller = new AbortController();
  }
  log(event) {
    // Only lifecycle events/codes: no documents, environment secrets or vectors.
    appendFileSync(path.join(this.dataDirectory, "runtime.log"), `[${new Date().toISOString()}] ${event}\n`);
  }
  update(phase, extra = {}) {
    this.state = { phase, completed: 0, total: 0, percentage: null, error: null, ...extra };
    this.emit("state", this.state);
  }
  async prepare() {
    await mkdir(path.join(this.dataDirectory, "models"), { recursive: true });
    await mkdir(path.join(this.dataDirectory, "home"), { recursive: true });
    this.port = await availablePort();
    this.url = `http://${config.host}:${this.port}`;
    this.bridge = createServer((req, res) => void this.handleBridge(req, res));
    await new Promise((resolve, reject) => {
      this.bridge.once("error", reject);
      this.bridge.listen(0, config.host, resolve);
    });
    this.bridgeUrl = `http://${config.host}:${this.bridge.address().port}`;
    return { OLLAMA_BASE_URL: this.bridgeUrl, OLLAMA_EMBEDDING_MODEL: config.model,
      PAPERGRAPH_MANAGED_EMBEDDINGS: "1", PAPERGRAPH_EMBEDDING_TOKEN: this.token };
  }
  async request(endpoint, options = {}, timeout = config.requestTimeoutMs) {
    return fetch(`${this.url}${endpoint}`, { ...options,
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeout)]) });
  }
  async json(endpoint, options, timeout) {
    const response = await this.request(endpoint, options, timeout);
    if (!response.ok) throw new Error(`api-${response.status}`);
    return response.json();
  }
  async ownsListener() {
    const { stdout } = await execute(path.join(process.env.SystemRoot || "C:\\Windows", "System32/netstat.exe"),
      ["-ano", "-p", "TCP"], { windowsHide: true, timeout: 5000 });
    return stdout.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[0] === "TCP" && fields[1] === `${config.host}:${this.port}` &&
        fields[2] === "0.0.0.0:0" && Number(fields.at(-1)) === this.runtimePid;
    });
  }
  start() {
    if (this.operation) return this.operation;
    if (this.stopping || this.state.phase === "ready") return Promise.resolve();
    this.operation = this.setup().catch((error) => {
      if (this.stopping) return;
      const code = error.code || (this.state.phase === "downloading-model" ? "download-failed" : "runtime-unavailable");
      this.log(`Setup failed: ${code}`);
      this.update(code === "download-failed" ? "offline" : "error", { error: code });
    }).finally(() => { this.operation = null; });
    return this.operation;
  }
  async setup() {
    if (process.platform !== "win32") throw Object.assign(new Error(), { code: "unsupported-platform" });
    const executable = path.join(this.runtimeDirectory, "ollama.exe");
    if (!existsSync(executable)) throw Object.assign(new Error(), { code: "runtime-missing" });
    this.update("starting-runtime");
    if (!this.process || this.process.exitCode !== null || this.process.killed) {
      // A occupied port is never treated as our runtime. Re-select without killing its owner.
      this.port = await availablePort(this.port);
      this.url = `http://${config.host}:${this.port}`;
      this.log(`Starting bundled ${config.version} on ${config.host}:${this.port}`);
      const systemRoot = process.env.SystemRoot || "C:\\Windows";
      const env = {};
      for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"]) {
        if (process.env[name]) env[name] = process.env[name];
      }
      Object.assign(env, {
        PATH: `${path.join(systemRoot, "System32")};${this.runtimeDirectory}`,
        USERPROFILE: path.join(this.dataDirectory, "home"),
        LOCALAPPDATA: path.join(this.dataDirectory, "home"),
        APPDATA: path.join(this.dataDirectory, "home"),
        OLLAMA_HOST: `${config.host}:${this.port}`,
        OLLAMA_MODELS: path.join(this.dataDirectory, "models"),
        OLLAMA_NO_CLOUD: "1", OLLAMA_MAX_LOADED_MODELS: "1",
      });
      this.process = spawn(path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", this.guardianPath,
        "-Executable", executable, "-WorkingDirectory", this.runtimeDirectory, "-OwnerProcessId", String(process.pid),
      ], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      this.runtimePid = null;
      let output = "";
      this.process.stdout.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-4096);
        const match = output.match(/PAPERGRAPH_RUNTIME_PID=(\d+)/);
        if (match) this.runtimePid = Number(match[1]);
      });
      this.process.stderr.resume();
      this.process.on("error", () => this.update("error", { error: "runtime-start-failed" }));
      this.process.on("exit", (code) => {
        this.log(`Owned runtime guardian exited (${code})`);
        if (!this.stopping) this.update("error", { error: "runtime-exited" });
      });
    }
    const deadline = Date.now() + config.startupTimeoutMs;
    let healthy = false;
    while (!this.stopping && Date.now() < deadline) {
      if (this.process.exitCode !== null) throw Object.assign(new Error(), { code: "runtime-start-failed" });
      if (this.runtimePid) {
        try {
          const info = await this.json("/api/version", undefined, 1500);
          if (info.version !== config.version) throw new Error("unexpected-version");
          if (!await this.ownsListener()) throw new Error("unexpected-owner");
          healthy = true; break;
        } catch { /* Wait for our owned process; no trust based only on an open port. */ }
      }
      await pause(250);
    }
    if (!healthy) throw Object.assign(new Error(), { code: "runtime-start-timeout" });
    this.log("Server ready; checking model");
    this.update("checking-model");
    if (!hasModel(await this.json("/api/tags"))) await this.pull();
    this.update("checking-model");
    if (!hasModel(await this.json("/api/tags"))) throw Object.assign(new Error(), { code: "model-invalid" });
    const result = await this.json("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input: "PaperGraph semantic search readiness", truncate: false }) }, 180000);
    const vector = result.embeddings?.[0];
    if (!Array.isArray(vector) || vector.length !== config.dimensions || !vector.every(Number.isFinite) || !vector.some((n) => n !== 0)) {
      throw Object.assign(new Error(), { code: "model-invalid" });
    }
    this.log("Semantic engine ready");
    this.update("ready");
  }
  async pull() {
    this.log("Model missing; pull started");
    this.update("downloading-model");
    const response = await this.request("/api/pull", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, stream: true }) }, config.downloadTimeoutMs);
    if (!response.ok || !response.body) throw new Error("pull-failed");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const layers = new Map();
    let buffer = "";
    let success = false;
    const accept = (line) => {
      if (!line.trim()) return;
      const message = JSON.parse(line);
      if (message.error) throw new Error("pull-failed");
      if (message.status === "success") success = true;
      if (typeof message.digest === "string" && Number.isFinite(message.total) && message.total > 0) {
        const previous = layers.get(message.digest);
        layers.set(message.digest, { total: message.total,
          completed: Math.min(message.total, Math.max(previous?.completed || 0, Number(message.completed) || 0)) });
        const total = [...layers.values()].reduce((sum, layer) => sum + layer.total, 0);
        const completed = [...layers.values()].reduce((sum, layer) => sum + layer.completed, 0);
        this.update("downloading-model", { total, completed, percentage: Math.floor(completed / total * 100) });
      }
    };
    try {
      while (true) {
        let timer;
        const chunk = await Promise.race([reader.read(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("pull-stalled")), config.downloadIdleTimeoutMs);
        })]).finally(() => clearTimeout(timer));
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 1024 * 1024) throw new Error("invalid-pull-stream");
        const lines = buffer.split("\n"); buffer = lines.pop();
        lines.forEach(accept);
      }
      accept(buffer + decoder.decode());
      if (!success) throw new Error("pull-interrupted");
    } finally { await reader.cancel().catch(() => {}); }
    this.log("Pull completed; validating model");
  }
  async handleBridge(req, res) {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${this.token}`) { res.writeHead(403); res.end('{}'); return; }
    if (req.url !== "/api/embed" || req.method !== "POST") { res.writeHead(404); res.end('{}'); return; }
    if (this.state.phase !== "ready") {
      res.writeHead(503); res.end(JSON.stringify({ error: "Semantic search is being prepared" })); return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("request-too-large");
      }
      const data = JSON.parse(body);
      if (typeof data.input !== "string" || !data.input.trim()) { res.writeHead(400); res.end('{}'); return; }
      const response = await this.request("/api/embed", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.model, input: data.input, truncate: false }) }, 120000);
      res.writeHead(response.status); res.end(await response.text());
    } catch {
      if (!this.stopping) this.update("error", { error: "runtime-unavailable" });
      if (!res.headersSent) res.writeHead(503);
      res.end(JSON.stringify({ error: "Embedding service unavailable" }));
    }
  }
  async stop() {
    this.stopping = true;
    this.controller.abort();
    if (this.bridge) { this.bridge.closeAllConnections(); this.bridge.close(); }
    const child = this.process;
    if (child && child.exitCode === null && child.pid) {
      await new Promise((resolve) => {
        const killer = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32/taskkill.exe"),
          ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        const timeout = setTimeout(resolve, 10000);
        const done = () => { clearTimeout(timeout); resolve(); };
        killer.once("exit", done); killer.once("error", done);
      });
    }
    this.log("Owned runtime stopped");
    this.update("idle");
  }
}
module.exports = { OllamaManager, hasModel, availablePort };
