import WebSocket from "../node_modules/next/dist/compiled/ws/index.js";
import { spawn } from "node:child_process";
import { readFile, mkdir, copyFile, unlink, rmdir, mkdtemp } from "node:fs/promises";
import { existsSync, constants } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";

const route = path.resolve("src/app/profile-photo-check/page.tsx");
if (existsSync(route)) throw new Error("Fixture route already exists.");
const executable = process.env.BROWSER_PATH ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].find(existsSync);
if (!executable) throw new Error("Set BROWSER_PATH to Chrome, Chromium or Edge.");
await mkdir(path.dirname(route), { recursive: true });
await copyFile("tests/fixtures/profile-photo-page.tsx", route, constants.COPYFILE_EXCL);
await mkdir(".utmp", { recursive: true });
const profile = await mkdtemp(path.resolve(".utmp/profile-photo-browser-"));
const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keepAlive = setInterval(() => {}, 1000);
let ws;
try {
  let pages;
  for (let index = 0; index < 100; index++) {
    try {
      const port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch { await pause(100); }
  }
  assert.ok(pages, "Browser starts");
  ws = new WebSocket(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  let sequence = 0;
  const pending = new Map();
  ws.on("close", () => {
    for (const request of pending.values()) request.reject(new Error("Browser connection closed."));
    pending.clear();
  });
  ws.on("message", data => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
    else promise.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let index = 0; index < 400; index++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Timeout: ${expression}`);
  };
  const upload = async kind => evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'orange'; ctx.fillRect(0,0,800,400);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    const file = ${kind === "invalid" ? "new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})"
      : kind === "large" ? "new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'})"
      : "new File([blob],'photo.png',{type:'image/png'})"};
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('input[type=file]'); input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await cdp("Page.navigate", { url: process.env.PROFILE_PHOTO_TEST_URL ?? "http://localhost:3012/profile-photo-check" });
  await wait("Boolean(document.querySelector('input[type=file]')) && !document.querySelector('input[type=file]').disabled");
  assert.equal(await evaluate("document.querySelector('#member').textContent"), "TU");
  await upload("valid");
  await wait("Boolean(document.querySelector('[role=status]')) && Boolean(document.querySelector('#member img'))");
  assert.equal(await evaluate("document.querySelector('#image-info').textContent"), "256x256:image/webp");
  await evaluate("document.querySelector('#remount').click()");
  await wait("!document.querySelector('input[type=file]').disabled && Boolean(document.querySelector('main img'))");
  const oldUrl = await evaluate("document.querySelector('#member img').src");
  for (const kind of ["invalid", "large"]) {
    await upload(kind);
    await wait("Boolean(document.querySelector('[role=alert]'))");
    assert.match(await evaluate("document.querySelector('[role=alert]').textContent"), /até 5 MB/);
    assert.equal(await evaluate("document.querySelector('#member img').src"), oldUrl);
  }
  await evaluate("document.querySelector('#fail').click()");
  await upload("valid");
  await wait("Boolean(document.querySelector('[role=alert]')) && document.querySelector('[role=alert]').textContent.includes('Não foi possível guardar')");
  assert.equal(await evaluate("document.querySelector('#member img').src"), oldUrl);
  await evaluate("document.querySelector('#fail').click(); [...document.querySelectorAll('button')].find(button=>button.textContent==='Remover foto').click()");
  await wait("Boolean(document.querySelector('[role=status]')) && !document.querySelector('#member img')");
  assert.equal(await evaluate("document.querySelector('#member').textContent"), "TU");
  console.log("PASS: initials, upload, 256px WebP conversion, account reopen, file validation, failed-save recovery and removal.");
} finally {
  clearInterval(keepAlive);
  ws?.close(); browser.kill();
  await unlink(route);
  await rmdir(path.dirname(route));
}
