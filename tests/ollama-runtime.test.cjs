const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { OllamaManager, hasModel, availablePort } = require("../electron/ollama-manager.cjs");
const config = require("../electron/embedding-runtime-config.json");

function manager() {
  const value = new OllamaManager({ runtimeDirectory: ".", dataDirectory: "." });
  value.log = () => {};
  return value;
}
function stream(lines) {
  const bytes = new TextEncoder().encode(lines.join("\n"));
  return new Response(new ReadableStream({ start(controller) {
    // Split inside JSON to exercise the real streaming decoder.
    controller.enqueue(bytes.slice(0, 19)); controller.enqueue(bytes.slice(19)); controller.close();
  } }));
}

test("recognizes the required model tags, never an unrelated model", () => {
  assert.ok(hasModel({ models: [{ name: "bge-m3:latest" }] }));
  assert.ok(hasModel({ models: [{ model: "bge-m3" }] }));
  assert.equal(hasModel({ models: [{ name: "bge-m3:other" }, { name: "llama3" }] }), false);
});
test("busy preferred port gets a different loopback port without disrupting its owner", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const original = server.address().port;
    assert.notEqual(await availablePort(original), original);
    assert.equal(server.listening, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("pull streams real byte totals, handles fragmented JSON and requires success", async () => {
  const value = manager();
  const progress = [];
  value.on("state", (state) => progress.push(state));
  value.request = async (_endpoint, options) => {
    assert.deepEqual(JSON.parse(options.body), { model: "bge-m3", stream: true });
    return stream([
      JSON.stringify({ digest: "sha256:a", total: 1000, completed: 250 }),
      JSON.stringify({ digest: "sha256:a", total: 1000, completed: 1000 }),
      JSON.stringify({ status: "success" }),
    ]);
  };
  await value.pull();
  assert.ok(progress.some((s) => s.percentage === 25 && s.completed === 250 && s.total === 1000));
  assert.equal(progress.at(-1).percentage, 100);
  value.request = async () => stream([JSON.stringify({ digest: "a", total: 1000, completed: 500 })]);
  await assert.rejects(value.pull(), /pull-interrupted/);
});
test("offline first setup is recoverable, concurrent retry doesn't start duplicate work", async () => {
  const value = manager(); let calls = 0;
  value.setup = async () => { calls++; value.update("downloading-model"); await Promise.resolve(); throw new Error("offline"); };
  await Promise.all([value.start(), value.start()]);
  assert.equal(calls, 1);
  assert.equal(value.state.phase, "offline");
  assert.equal(value.state.error, "download-failed");
  value.setup = async () => value.update("ready");
  await value.start(); assert.equal(value.state.phase, "ready");
});
test("ready model is verified by API after restart/update without pulling again", async (t) => {
  if (process.platform !== "win32") return t.skip("Windows runtime");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "papergraph-runtime-test-"));
  const value = new OllamaManager({ runtimeDirectory: directory, dataDirectory: directory });
  try {
    await fs.writeFile(path.join(directory, "ollama.exe"), "test fixture");
    value.process = { exitCode: null, killed: false };
    value.runtimePid = 123;
    value.ownsListener = async () => true;
    value.json = async (endpoint) => endpoint === "/api/version" ? { version: config.version }
      : endpoint === "/api/tags" ? { models: [{ name: "bge-m3:latest" }] }
        : { embeddings: [Array(1024).fill(0.01)] };
    value.pull = () => { throw new Error("Must not download an existing model"); };
    await value.setup(); assert.equal(value.state.phase, "ready");
    value.json = async (endpoint) => endpoint === "/api/version" ? { version: config.version }
      : endpoint === "/api/tags" ? { models: [{ name: "bge-m3:latest" }] } : { embeddings: [[1]] };
    await assert.rejects(value.setup(), (error) => error.code === "model-invalid");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test("bridge requires its private token and responds promptly while setup is running", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "papergraph-bridge-test-"));
  const value = new OllamaManager({ runtimeDirectory: directory, dataDirectory: directory });
  try {
    const env = await value.prepare();
    assert.equal((await fetch(env.OLLAMA_BASE_URL + "/api/embed", { method: "POST" })).status, 403);
    assert.equal((await fetch(env.OLLAMA_BASE_URL + "/api/embed", { method: "POST",
      headers: { Authorization: `Bearer ${env.PAPERGRAPH_EMBEDDING_TOKEN}` } })).status, 503);
    assert.equal((await fetch(env.OLLAMA_BASE_URL + "/api/pull", { method: "POST",
      headers: { Authorization: `Bearer ${env.PAPERGRAPH_EMBEDDING_TOKEN}` } })).status, 404);
  } finally { await value.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});
