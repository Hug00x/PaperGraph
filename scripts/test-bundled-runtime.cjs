const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { OllamaManager } = require("../electron/ollama-manager.cjs");
const root = path.resolve(__dirname, "..");
const dataDirectory = path.resolve(process.argv[2] || path.join(root, ".utmp/ollama-clean-test"));

async function run() {
  const phases = [];
  const manager = new OllamaManager({ runtimeDirectory: path.join(root, "build/ollama"), dataDirectory });
  let previous = "";
  let percentage = -10;
  manager.on("state", (state) => {
    phases.push(state.phase);
    if (previous !== state.phase || (state.percentage !== null && state.percentage >= percentage + 10)) {
      console.log(JSON.stringify(state)); previous = state.phase; percentage = state.percentage ?? -10;
    }
  });
  const env = await manager.prepare();
  try {
    // Runtime never consults PATH; the guardian receives its own restricted environment.
    await manager.start();
    assert.equal(manager.state.phase, "ready", JSON.stringify(manager.state));
    const response = await fetch(env.OLLAMA_BASE_URL + "/api/embed", {
      method: "POST", headers: { Authorization: `Bearer ${env.PAPERGRAPH_EMBEDDING_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Scientific articles about affective learning", model: "bge-m3" }),
      signal: AbortSignal.timeout(120000),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.embeddings[0].length, 1024);
    const unauthorized = await fetch(env.OLLAMA_BASE_URL + "/api/embed", { method: "POST" });
    assert.equal(unauthorized.status, 403);
    return { phases: [...new Set(phases)], downloaded: phases.includes("downloading-model"), dimensions: 1024, port: manager.port };
  } finally { await manager.stop(); }
}
(async () => {
  const first = await run();
  const second = await run();
  assert.equal(second.downloaded, false, "Second start must reuse the existing model");
  console.log(JSON.stringify({ first, second }));
  await fs.writeFile(path.join(dataDirectory, "test-result.json"), JSON.stringify({ first, second }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
