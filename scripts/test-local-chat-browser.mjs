import WebSocket from '../node_modules/next/dist/compiled/ws/index.js';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, unlink, rmdir, mkdtemp } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const route = path.resolve('src/app/local-chat-check/page.tsx');
if (existsSync(route)) throw new Error('Fixture route already exists');
await mkdir(path.dirname(route), { recursive: true });
await copyFile('tests/fixtures/deep-research-page.tsx', route, constants.COPYFILE_EXCL);
await mkdir('.utmp', { recursive: true });
const profile = await mkdtemp(path.resolve('.utmp/deep-research-browser-'));
const executable = process.env.BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
if (!executable) { await unlink(route); await rmdir(path.dirname(route)); throw new Error('Set BROWSER_PATH'); }
const browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keepAlive = setInterval(() => {}, 1000);
let ws;
try {
  let pages;
  for (let i = 0; i < 100; i++) { try { const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await pause(100); } }
  assert.ok(pages, 'Browser started');
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const pending = new Map(); let sequence = 0;
  ws.on('message', data => { const message = JSON.parse(data); if (!message.id) return; const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expression => { const data = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (data.exceptionDetails) throw new Error(JSON.stringify(data.exceptionDetails)); return data.result.value; };
  const wait = async expression => { for (let i = 0; i < 200; i++) { if (await ev(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression}`); };
  const button = (label, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click = async expression => { assert.ok(await ev(`!!(${expression})`), `Control exists: ${expression}`); await ev(`(${expression}).click()`); await pause(100); };
  const drawer = "document.querySelector('[data-deep-research]:not([hidden])')";
  const openPaper = async action => {
    await ev(`document.querySelector('[data-article-id="A"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:700,clientY:400}))`);
    await click(button(action, "document.querySelector('[aria-label=\"Article actions\"]')"));
    await wait(`!!${drawer}`);
  };
  const install = String.raw`(() => {
    window.__localCalls=[]; window.__listeners=[]; window.__cancelled=new Set(); window.__slow=false;
    window.papergraphResearch={getAvailability:async()=>({connected:true,permission:true,supported:true})};
    window.papergraphLocalChat={subscribe:f=>{window.__listeners.push(f); return()=>{window.__listeners=window.__listeners.filter(x=>x!==f)}},
      cancel:async id=>{window.__cancelled.add(id)}, run:async request=>{
        window.__localCalls.push(request);
        const content='## Overall assessment\n\n**Strengths:** grounded analysis.\n\n- Small sample\n- Limited evaluation\n\n<script>window.__injected=true</script>';
        window.__listeners.forEach(f=>f({requestId:request.requestId,phase:'generating',delta:'## Overall assessment\n'}));
        await new Promise(r=>setTimeout(r,window.__slow?1200:200));
        if(window.__cancelled.has(request.requestId))return {requestId:request.requestId,error:'cancelled'};
        return {requestId:request.requestId,content};
      }};
  })()`;
  await cdp('Page.enable'); await cdp('Page.addScriptToEvaluateOnNewDocument',{source:install});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:`${process.env.GRAPH_TEST_URL || 'http://127.0.0.1:3015'}/local-chat-check`});
  await wait("!!document.querySelector('[data-article-id=\"A\"]')"); await pause(800);
  await openPaper('Ask Papergraph');
  const local="document.querySelector('[aria-label=\"Local conversation\"]')";
  await wait(`!!${local}`);
  const type=async value=>ev(`(()=>{const field=${local}.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await type('Assess the quality of this paper'); await pause(100); await click(button('Send',local));
  await wait(`${local}.textContent.includes('Overall assessment')`);
  await wait(`${local}.querySelector('textarea').disabled===false`);
  assert.equal(await ev(`${local}.querySelectorAll('h4').length`),1,'Markdown heading rendered');
  assert.equal(await ev(`${local}.querySelectorAll('li').length`),2,'Markdown list rendered');
  assert.equal(await ev('!!window.__injected'),false,'HTML escaped');
  assert.equal(await ev('window.__localCalls[0].papers.length'),1,'Only selected paper sent');
  assert.equal(await ev('window.__localCalls[0].papers[0].title'),'Scientific paper A');
  assert.ok(await ev("window.__localCalls[0].papers[0].text.includes('PRIVATE_LATEX_MUST_NOT_BE_SENT')"),'Local model receives article source');
  await type('Explain its limitations'); await pause(100); await click(button('Send',local));
  await wait('window.__localCalls.length===2'); await wait(`${local}.querySelector('textarea').disabled===false`);
  assert.equal(await ev('window.__localCalls[1].messages.length'),3,'Follow-up includes conversation');
  await click(button('Deep Research',drawer)); await click(button('Local',drawer));
  assert.equal(await ev(`${local}.querySelectorAll('article').length`),4,'Switch preserves local history');
  await click("document.querySelector('[aria-label=\"Close Ask Papergraph\"]')");
  await wait(`!${drawer}`); await openPaper('Ask Papergraph');
  assert.equal(await ev(`${local}.querySelectorAll('article').length`),4,'Reopening preserves local history');
  await ev('window.__slow=true'); await type('Another question'); await pause(100); await click(button('Send',local));
  await wait('window.__localCalls.length===3'); await click(button('Stop',local));
  await wait(`${local}.textContent.includes('Response stopped')`);
  assert.equal(await ev(`${local}.querySelectorAll('article').length`),5,'Partial answer displayed separately');
  await click(button('New conversation',local)); assert.equal(await ev(`${local}.querySelectorAll('article').length`),0);
  console.log('PASS local answers, Markdown, selected source, follow-up history, mode switch, cancellation and reset');
} finally { clearInterval(keepAlive); ws?.close(); browser.kill(); await unlink(route).catch(()=>{}); await rmdir(path.dirname(route)).catch(()=>{}); }
