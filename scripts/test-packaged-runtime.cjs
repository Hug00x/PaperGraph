// Runs a built/installed desktop application with an isolated profile.
// Chromium debugging is enabled by this test command only, never by normal startup.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { availablePort } = require("../electron/ollama-manager.cjs");
const root = path.resolve(__dirname, "..");
const executable = path.resolve(process.argv[2] || path.join(root, "desktop-dist/win-unpacked/PaperGraph.exe"));
const profile = path.join(root, ".utmp/packaged-profile");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:"));
      if (target) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        const pending = new Map(); let sequence = 0;
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(data); const promise = pending.get(message.id);
          if (promise) { pending.delete(message.id); if (message.error) promise.reject(new Error(message.error.message)); else promise.resolve(message.result); }
        };
        return { socket, call: (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
        }) };
      }
    } catch { /* application still starting */ }
    await sleep(500);
  }
  throw new Error("Packaged window failed to become available");
}
async function run() {
  const port = await availablePort(0);
  await fs.mkdir(path.join(profile, "roaming"), { recursive: true });
  await fs.mkdir(path.join(profile, "local"), { recursive: true });
  const env = { ...process.env, APPDATA: path.join(profile, "roaming"), LOCALAPPDATA: path.join(profile, "local") };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(profile, "chromium")}`],
    { env, windowsHide: true, stdio: "ignore" });
  let debuggerClient;
  try {
    debuggerClient = await connect(port);
    const evaluate = async (expression) => {
      const result = await debuggerClient.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error("Packaged renderer evaluation failed");
      return result.result.value;
    };
    const phases = new Set(); let ready = false; let last = "";
    for (let i = 0; i < 1800; i++) {
      const state = await evaluate("window.papergraphRuntime?.getState()");
      if (state) {
        phases.add(state.phase);
        if (last !== state.phase) { console.log(`Packaged UI: ${state.phase}`); last = state.phase; }
        if (["error", "offline"].includes(state.phase)) throw new Error(JSON.stringify(state));
        if (state.phase === "ready") { ready = true; break; }
      }
      await sleep(500);
    }
    assert.ok(ready, "Packaged runtime must become ready");
    assert.ok(await evaluate("document.querySelector('.semantic-runtime-status') !== null"), "React status card must render");
    const screenshot = await debuggerClient.call("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(path.join(profile, "ready.png"), Buffer.from(screenshot.data, "base64"));
    const appUrl = await evaluate("location.origin");
    assert.equal((await fetch(appUrl)).status, 200);
    assert.equal((await fetch(appUrl + "/api/academic-relations", { method: "POST" })).status, 401);
    const finished = new Promise((resolve) => child.once("exit", resolve));
    void evaluate("window.close()").catch(() => {});
    await Promise.race([finished, sleep(15000).then(() => { throw new Error("Desktop did not shut down normally"); })]);
    return { phases: [...phases], downloaded: phases.has("downloading-model"), ready: true, normalShutdown: true };
  } finally {
    debuggerClient?.socket.close();
    if (child.exitCode === null) child.kill();
  }
}
(async () => {
  const first = await run(); const second = await run();
  assert.equal(second.downloaded, false);
  const result = { executable, first, second };
  await fs.writeFile(path.join(profile, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
})().catch((error) => { console.error(error); process.exitCode = 1; });
