// Integration checks against the actual bundled binary. No global installation is modified.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { OllamaManager } = require("../electron/ollama-manager.cjs");
const root = path.resolve(__dirname, "..");
const runtimeDirectory = path.join(root, "build/ollama");
const cleanData = path.join(root, ".utmp/ollama-clean-test");
const interruptedData = path.join(root, ".utmp/ollama-interrupted-test");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable(url) {
  try { return (await fetch(url + "/api/version", { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}
async function closed(url) {
  for (let i = 0; i < 40; i++) { if (!await reachable(url)) return; await sleep(250); }
  throw new Error("Owned runtime still listening after shutdown");
}
async function crashChild() {
  const manager = new OllamaManager({ runtimeDirectory, dataDirectory: cleanData });
  await manager.prepare(); await manager.start();
  assert.equal(manager.state.phase, "ready");
  console.log(JSON.stringify({ url: manager.url, pid: manager.runtimePid }));
  setInterval(() => {}, 10000);
}
async function main() {
  const globalUrl = "http://127.0.0.1:11434";
  const globalBefore = await reachable(globalUrl);
  const result = { globalBefore };
  let manager = new OllamaManager({ runtimeDirectory, dataDirectory: interruptedData });
  await manager.prepare();
  const realRequest = manager.request.bind(manager);
  // Deterministic network failure at the download boundary; no firewall/adapter changes.
  manager.request = (endpoint, ...args) => endpoint === "/api/pull"
    ? Promise.reject(new Error("Simulated offline download")) : realRequest(endpoint, ...args);
  try {
    await manager.start();
    assert.equal(manager.state.phase, "offline"); result.offline = "controlled download failure, real runtime";
    manager.request = realRequest;
    let stopping;
    manager.on("state", (state) => {
      if (state.phase === "downloading-model" && state.completed > 1024 * 1024 && !stopping) {
        console.log("Interrupting real model download after received bytes");
        stopping = manager.stop();
      }
    });
    await manager.start(); await stopping;
    assert.ok(stopping, "Test requires a previously empty interrupted-test model directory");
    await closed(manager.url); result.interruptedShutdown = true;
  } finally { await manager.stop(); }

  manager = new OllamaManager({ runtimeDirectory, dataDirectory: interruptedData });
  await manager.prepare();
  let last = -20;
  manager.on("state", (state) => {
    if (state.percentage !== null && state.percentage >= last + 20) {
      console.log(`Resumed download ${state.percentage}%`); last = state.percentage;
    }
  });
  try {
    await manager.start(); assert.equal(manager.state.phase, "ready");
    result.interruptedRecovery = "ready, real 1024-dimensional embedding verified";
  } finally { await manager.stop(); await closed(manager.url); }

  const child = spawn(process.execPath, [__filename, "--crash-child"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let owned;
  try {
    owned = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Crash test startup timed out")), 240000);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk; const line = output.split("\n")[0];
        try { const data = JSON.parse(line); clearTimeout(timer); resolve(data); } catch { /* incomplete */ }
      });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Crash child exited early: ${code}`)); });
    });
    child.kill(); // Kill only the owning Node process, deliberately not its tree.
    await closed(owned.url); result.ownerCrashCleanup = true;
  } finally { if (child.exitCode === null) child.kill(); }
  assert.equal(await reachable(globalUrl), globalBefore, "Global Ollama availability changed");
  result.globalAfter = await reachable(globalUrl);
  await fs.writeFile(path.join(root, ".utmp/runtime-lifecycle-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
(process.argv.includes("--crash-child") ? crashChild() : main()).catch((error) => { console.error(error); process.exitCode = 1; });
