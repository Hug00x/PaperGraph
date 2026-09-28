import WebSocket from "../node_modules/next/dist/compiled/ws/index.js";
import { spawn } from "node:child_process";
import { readFile, mkdir, copyFile, unlink, rmdir, mkdtemp } from "node:fs/promises";
import { existsSync, constants } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";

const route = path.resolve("src/app/graph-live-check/page.tsx");
if (existsSync(route)) throw Error("Refusing to overwrite existing test route");
await mkdir(path.dirname(route), { recursive: true });
await copyFile("tests/fixtures/graph-live-page.tsx", route, constants.COPYFILE_EXCL);
await mkdir(".utmp", { recursive: true });
const profile = await mkdtemp(path.resolve(".utmp/graph-live-browser-"));
const executable = process.env.BROWSER_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(existsSync);
if (!executable) throw Error("Set BROWSER_PATH");
const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const connections = [];
async function connect(url) {
  const socket = new WebSocket(url); connections.push(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let nextId = 0; const pending = new Map();
  socket.on("message", bytes => {
    const message = JSON.parse(bytes.toString());
    if (!message.id) return;
    const task = pending.get(message.id); pending.delete(message.id);
    if (message.error) task.reject(Error(JSON.stringify(message.error))); else task.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async expression => {
    for (let i = 0; i < 150; i++) { if (await ev(expression)) return; await pause(100); }
    throw Error(`Timeout: ${expression}\n${await ev("document.querySelector('#fixture-live')?.textContent")}\n${await ev("document.querySelector('#fixture-error')?.textContent")}`);
  };
  const rect = expression => ev(`(()=>{const e=${expression};if(!e)throw Error('Missing element');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,top:r.top,width:r.width,height:r.height};})()`);
  const mouse = (type, x, y, extra = {}) => cdp("Input.dispatchMouseEvent", { type, x, y, ...extra });
  const click = async expression => { const r = await rect(expression); await mouse("mousePressed", r.x, r.y, { button: "left", clickCount: 1 }); await mouse("mouseReleased", r.x, r.y, { button: "left", clickCount: 1 }); await pause(100); };
  const state = () => ev("JSON.parse(document.querySelector('#fixture-state').textContent)");
  return { cdp, ev, wait, rect, mouse, click, state };
}
const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const node = id => `document.querySelector('[data-article-id="${id}"]')`;
const stateExpression = "JSON.parse(document.querySelector('#fixture-state').textContent)";
let control;
try {
  let port;
  for (let i = 0; i < 80; i++) { try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await pause(100); } }
  assert.ok(port, "Browser started");
  const makePage = async name => {
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const api = await connect(page.webSocketDebuggerUrl);
    await api.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await api.cdp("Page.navigate", { url: `${process.env.GRAPH_TEST_URL ?? "http://localhost:3000"}/graph-live-check?name=${name}` });
    await api.wait("!!document.querySelector('[data-article-id=\"A\"]')");
    await api.wait("JSON.parse(document.querySelector('#fixture-live').textContent).connected");
    await pause(700); return api;
  };
  const a = await makePage("Alice"); control = a;
  const b = await makePage("Bob");
  const initial = await a.state();
  const beforeB = await b.rect(node("A"));
  const start = await a.rect(node("A"));
  await a.cdp("Page.bringToFront");
  await a.mouse("mousePressed", start.x, start.y, { button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) { await a.mouse("mouseMoved", start.x + i * 12, start.y + i * 6, { button: "left", buttons: 1 }); await pause(30); }
  await b.wait("[...document.querySelectorAll('[data-graph-presence]')].some(e=>e.textContent.includes('Alice') && e.textContent.includes('moving'))");
  assert.ok((await b.rect(node("A"))).x > beforeB.x + 20, "Other page renders movement before pointer-up");
  assert.deepEqual((await b.state()).articlePositions, initial.articlePositions, "Preview never changes durable state");
  await a.mouse("mouseReleased", start.x + 60, start.y + 30, { button: "left", clickCount: 1 });
  await b.wait(`${stateExpression}.articlePositions.A.x > ${initial.articlePositions.A.x}`);
  assert.deepEqual((await a.state()).articlePositions, (await b.state()).articlePositions);
  await b.wait("document.querySelectorAll('[data-graph-presence]').length===0");
  console.log("PASS live article drag, collaborator badge and committed position without refresh");

  const beforeCancel = await a.state();
  const cancelStart = await a.rect(node("B"));
  await a.mouse("mousePressed", cancelStart.x, cancelStart.y, { button: "left", clickCount: 1 });
  await a.mouse("mouseMoved", cancelStart.x + 60, cancelStart.y + 30, { button: "left", buttons: 1 });
  await b.wait("!!document.querySelector('[data-article-id=\"B\"] [data-graph-presence]')");
  await a.ev("window.dispatchEvent(new PointerEvent('pointercancel'))");
  await a.mouse("mouseReleased", cancelStart.x + 60, cancelStart.y + 30, { button: "left", clickCount: 1 });
  await b.wait("document.querySelectorAll('[data-graph-presence]').length===0");
  assert.deepEqual((await a.state()).articlePositions, beforeCancel.articlePositions);
  assert.deepEqual((await b.state()).articlePositions, beforeCancel.articlePositions);
  console.log("PASS cancelled drags clear remote presence and preserve saved positions");

  await a.click(button("Create group"));
  const pa = await a.rect(node("A")), pb = await a.rect(node("B"));
  const left = Math.min(pa.x, pb.x) - 120, top = Math.min(pa.y, pb.y) - 120;
  const right = Math.max(pa.x, pb.x) + 120, bottom = Math.max(pa.y, pb.y) + 140;
  await a.mouse("mousePressed", left, top, { button: "left", clickCount: 1 });
  await a.mouse("mouseMoved", right, bottom, { button: "left", buttons: 1 });
  await a.mouse("mouseReleased", right, bottom, { button: "left", clickCount: 1 });
  await a.wait("!!document.querySelector('[role=dialog] input')");
  await a.ev("(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Shared group');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await pause(100); await a.click(button("Create"));
  await b.wait(`${stateExpression}.zones.length===1`);
  const zoneId = (await b.state()).zones[0].id;
  const zone = `document.querySelector('[data-zone-id="${zoneId}"]')`;
  assert.ok(await b.ev(`!!${zone}`));
  console.log("PASS group creation appears on the other device without refresh");

  const zoneStart = await a.rect(`${zone}.querySelector('button')`);
  const memberBefore = await b.rect(node("B"));
  await a.mouse("mousePressed", zoneStart.left + 20, zoneStart.y, { button: "left", clickCount: 1 });
  for (let i = 1; i <= 5; i++) { await a.mouse("mouseMoved", zoneStart.left + 20 + i * 12, zoneStart.y + i * 8, { button: "left", buttons: 1 }); await pause(30); }
  await b.wait("[...document.querySelectorAll('[data-zone-id] [data-graph-presence]')].some(e=>e.textContent.includes('Alice'))");
  assert.ok((await b.rect(node("B"))).x > memberBefore.x + 20, "Group members move in the remote preview");
  await a.mouse("mouseReleased", zoneStart.left + 80, zoneStart.y + 40, { button: "left", clickCount: 1 });
  const movedZone = (await a.state()).zones[0];
  await b.wait(`${stateExpression}.zones[0].x === ${movedZone.x} && ${stateExpression}.zones[0].y === ${movedZone.y}`);
  assert.deepEqual((await a.state()).zones, (await b.state()).zones);
  assert.deepEqual((await a.state()).articlePositions, (await b.state()).articlePositions);
  console.log("PASS live group drag and member positions remain atomic");

  const viewer = await makePage("Viewer");
  assert.equal(await viewer.ev(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Create group')`), false);
  await a.cdp("Page.bringToFront");

  const edit = await a.rect(`${zone}.querySelector('button')`);
  await a.mouse("mousePressed", edit.x, edit.y, { button: "right", clickCount: 1 });
  await a.mouse("mouseReleased", edit.x, edit.y, { button: "right", clickCount: 1 });
  await a.wait("!!document.querySelector('[role=dialog] input')");
  await viewer.wait("[...document.querySelectorAll('[data-zone-id] [data-graph-presence]')].some(e=>e.textContent.includes('Alice') && e.textContent.includes('editing'))");
  await a.click(button("Cancel"));
  await viewer.wait("document.querySelectorAll('[data-graph-presence]').length===0");
  console.log("PASS group editing presence reaches read-only viewers");

  await a.ev(`${zone}.querySelector('button').focus()`);
  await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
  await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
  const nudged = await a.state();
  await b.wait(`${stateExpression}.zones[0].x === ${nudged.zones[0].x}`);
  await a.ev(`${zone}.querySelector('[aria-label="Resize group se"]').focus()`);
  await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
  await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown" });
  const resized = await a.state();
  await viewer.wait(`${stateExpression}.zones[0].height === ${resized.zones[0].height}`);
  assert.deepEqual(resized.articlePositions, nudged.articlePositions);
  console.log("PASS keyboard moves and resizing synchronize without moving unrelated articles");

  // Miss a complete update, then reconnect: the receiver must fetch durable state.
  await b.ev("document.querySelector('#offline').click()");
  const moved = await a.rect(node("C"));
  await a.mouse("mousePressed", moved.x, moved.y, { button: "left", clickCount: 1 });
  await a.mouse("mouseMoved", moved.x - 45, moved.y + 30, { button: "left", buttons: 1 });
  await a.mouse("mouseReleased", moved.x - 45, moved.y + 30, { button: "left", clickCount: 1 });
  await pause(400);
  await b.ev("document.querySelector('#online').click()");
  const final = await a.state();
  await b.wait(`${stateExpression}.articlePositions.C.x === ${final.articlePositions.C.x}`);
  await viewer.wait(`${stateExpression}.articlePositions.C.x === ${final.articlePositions.C.x}`);
  assert.equal(await a.ev("document.querySelector('#fixture-error').textContent"), "");
  assert.equal(await b.ev("document.querySelector('#fixture-error').textContent"), "");
  console.log("PASS reconnect catches up missed changes without refresh");
} finally {
  if (control) { try { await control.cdp("Browser.close"); } catch {} }
  for (const socket of connections) socket.close();
  browser.kill(); await unlink(route); await rmdir(path.dirname(route));
}
