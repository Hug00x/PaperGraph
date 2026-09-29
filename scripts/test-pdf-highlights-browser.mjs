import WebSocket from "../node_modules/next/dist/compiled/ws/index.js";
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, copyFile, unlink, rmdir, mkdtemp } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
// Run against an existing local Next dev server. The temporary route uses AnnotatedPdfViewer,
// test-only state and localStorage; it never accesses a user's workspace.
const route = path.resolve('src/app/pdf-highlights-check/page.tsx');
if (existsSync(route)) throw Error('Temporary pdf-highlights-check route already exists; refusing to overwrite it.');
await mkdir(path.dirname(route), {recursive:true});
await copyFile('tests/fixtures/pdf-highlights-page.tsx', route, constants.COPYFILE_EXCL);
await mkdir('.utmp', {recursive:true});
const profile = await mkdtemp(path.resolve('.utmp/pdf-highlights-browser-'));
const executable = process.env.BROWSER_PATH ?? [
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
if (!executable) { await unlink(route); await rmdir(path.dirname(route)); throw Error('Set BROWSER_PATH to Chrome, Chromium or Edge.'); }
const browser = spawn(executable, ['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
 '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const keepAlive = setInterval(()=>{},1000);
let ws;
try {
 let pages;
 for(let i=0;i<50;i++){try{const port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();break;}catch{await pause(100);}}
 assert.ok(pages,'Browser started');
 ws = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 ws.addEventListener('error',e=>console.log('WS error',e.message));
 ws.addEventListener('close',()=>clearInterval(keepAlive));
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0; const pending=new Map();
 ws.addEventListener('message', e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async expression=>{for(let i=0;i<400;i++){if(await ev(expression))return;await pause(100);}throw Error('Timeout: '+expression);};

 const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
 const click = async expression => { await ev(`(${expression}).click()`); await pause(100); };
 const count = () => ev(`document.querySelectorAll('[data-highlight-id]').length`);
 const select = async (multiline = false) => {
   await ev(`(()=>{const spans=document.querySelectorAll('[data-pdf-text="1"] span');const r=document.createRange();r.setStart(spans[0].firstChild,0);r.setEnd(spans[${multiline ? 1 : 0}].firstChild,${multiline ? 12 : 10});const s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`);
   await wait(`!${button('Highlight selection')}.disabled`);
 };
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:process.env.PDF_TEST_URL ?? 'http://localhost:3011/pdf-highlights-check'});
 await wait(`document.querySelectorAll('[data-pdf-text="2"] span').length>=2`);
 assert.equal(await ev(`document.body.textContent.includes('Select PDF text, then') || document.body.textContent.includes('No highlights in this version')`),false);
 await select(true);await click(`document.querySelector('[aria-label="Green"]')`);await click(button('Highlight selection'));await wait(`document.querySelectorAll('[data-highlight-id]').length===2`);
 const saved = await ev(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('papergraph-pdf-highlights:'))))`);
 assert.equal(saved.length,1);assert.equal(saved[0].rects.length,2);
 assert.equal(saved[0].color,'green');
 assert.equal(await ev(`document.querySelector('[data-highlight-id]').dataset.highlightColor`),'green');
 assert.ok(saved[0].selected_text.includes('Scientific'));assert.ok(saved[0].selected_text.includes('Second'));
 console.log('PASS multiline selection and local persistence');
 await click(button('Highlights (1)'));
 assert.equal(await ev(`document.querySelector('[data-highlight-entry]').open`),false);
 assert.equal(await ev(`getComputedStyle(document.querySelector('[data-highlight-entry] summary .truncate')).whiteSpace`),'nowrap');
 await click(`document.querySelector('[data-highlight-entry] summary')`);
 assert.equal(await ev(`document.querySelector('[data-highlight-entry]').open`),true);
 await click(`document.querySelector('[data-highlight-entry] [aria-label="Pink"]')`);
 await wait(`document.querySelector('[data-highlight-id]').dataset.highlightColor==='pink'`);
 await click(`document.querySelector('[data-highlight-entry] summary')`);
 assert.equal(await ev(`document.querySelector('[data-highlight-entry]').open`),false);
 await click(button('Highlights (1)'));
 console.log('PASS compact rows expand and collapse; existing highlights can be recolored');
 const geometry = async () => ev(`(()=>{const h=document.querySelector('[data-highlight-id]'),t=document.querySelector('[data-pdf-text="1"] span');const r=document.createRange();r.selectNodeContents(t);const a=h.getBoundingClientRect(),b=r.getBoundingClientRect();return {dx:Math.abs(a.left-b.left),dy:Math.abs(a.top-b.top),height:Math.abs(a.height-b.height),width:a.width};})()`);
 const before=await geometry();assert.ok(before.dx<2 && before.dy<2 && before.height<2,JSON.stringify(before));
 const screenshot=await cdp('Page.captureScreenshot');await writeFile('.utmp/pdf-highlights.png',Buffer.from(screenshot.data,'base64'));
 await click(`document.querySelector('[aria-label="Zoom in"]')`);await pause(700);
 let after=await geometry();assert.ok(after.dx<2 && after.dy<2 && after.height<2,JSON.stringify(after));assert.ok(after.width>before.width);
 await cdp('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:2,mobile:false});await pause(700);
 after=await geometry();assert.ok(after.dx<2 && after.dy<2,JSON.stringify(after));
 console.log('PASS highlight alignment at zoom and after resizing');
 await cdp('Page.reload');await wait(`document.querySelectorAll('[data-highlight-id]').length===2`);
 assert.equal(await ev(`document.querySelector('[data-highlight-id]').dataset.highlightColor`),'pink');
 console.log('PASS highlights restored after reload');
 await click(`document.querySelector('#readonly')`);
 assert.equal(await ev(`Boolean(${button('Highlight selection')})`),false);
 await click(button('Highlights (1)'));
 assert.equal(await ev(`document.querySelectorAll('[aria-label^="Delete highlight"]').length`),0);
 assert.equal(await count(),2);
 console.log('PASS read-only viewer');
 await click(`document.querySelector('#readonly')`);
 await click(`document.querySelector('[data-highlight-entry] summary')`);
 await click(`document.querySelector('[aria-label^="Delete highlight"]')`);await wait(`document.querySelectorAll('[data-highlight-id]').length===0`);
 assert.equal(await ev(`!!document.querySelector('[aria-label="Saved highlights"]')`),false);
 await cdp('Page.reload');await wait(`document.querySelectorAll('[data-pdf-text="1"] span').length>=2`);assert.equal(await count(),0);
 console.log('PASS deletion persists');
 await select();await click(button('Highlight selection'));await wait(`document.querySelectorAll('[data-highlight-id]').length===1`);
 await click(`document.querySelector('#replace')`);await wait(`document.querySelector('[data-pdf-text="1"] span')?.textContent==='Replacement document'`);assert.equal(await count(),0);
 await click(`document.querySelector('#replace')`);await wait(`document.querySelectorAll('[data-highlight-id]').length===1`);
 console.log('PASS replacement PDF does not inherit highlights');
 await wait(`document.querySelectorAll('[data-pdf-text="2"] span').length>=2`);
 await ev(`(()=>{const a=document.querySelector('[data-pdf-text="1"] span'),b=document.querySelectorAll('[data-pdf-text="2"] span')[1];const r=document.createRange();r.setStart(a.firstChild,0);r.setEnd(b.firstChild,12);window.getSelection().removeAllRanges();window.getSelection().addRange(r);})()`);
 await wait(`!${button('Highlight selection')}.disabled`);await click(button('Highlight selection'));
 await wait(`document.querySelectorAll('[data-highlight-id]').length===5`);
 const rotated=await ev(`(()=>{const p=document.querySelector('[data-pdf-page="2"]'),h=p.querySelector('[data-highlight-id]'),t=p.querySelector('[data-pdf-text] span');const r=document.createRange();r.selectNodeContents(t);const a=h.getBoundingClientRect(),b=r.getBoundingClientRect();return {dx:Math.abs(a.left-b.left),dy:Math.abs(a.top-b.top),dw:Math.abs(a.width-b.width),dh:Math.abs(a.height-b.height)};})()`);
 assert.ok(Object.values(rotated).every(v=>v<2),JSON.stringify(rotated));
 console.log('PASS cross-page selections and rotated page alignment');
 await select();await ev(`Storage.prototype.setItem=function(){throw new Error('quota')};`);await click(button('Highlight selection'));
 await wait(`!!document.querySelector('[role="alert"]')`);assert.equal(await count(),5);
 console.log('PASS failed save is reported and does not create a false saved highlight');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.reload');await wait(`document.querySelectorAll('[data-pdf-text="2"] span').length>=2`);
 await click(`document.querySelector('#imported')`);
 await wait(`!!document.querySelector('#import-state')`);
 await wait(`document.querySelectorAll('[data-pdf-text="2"] span').length>=2`);
 const importState=()=>ev(`JSON.parse(document.querySelector('#import-state').textContent)`);
 assert.equal((await importState()).requests,1);
 assert.equal(await ev(`Boolean(${button('Published')}) || Boolean(${button('Review')})`),false);
 await select();
 await ev(`window.fixtureCanvas=document.querySelector('[data-pdf-page="1"] canvas');window.fixtureScroller=document.querySelector('.papergraph-pdf-preview-stage');window.fixtureScroller.scrollTop=90;`);
 const startPolls=(await importState()).polls;
 await wait(`JSON.parse(document.querySelector('#import-state').textContent).polls>=${startPolls+2}`);
 assert.equal((await importState()).requests,1,'unchanged snapshots must not fetch the imported PDF again');
 assert.equal(await ev(`window.fixtureCanvas===document.querySelector('[data-pdf-page="1"] canvas')`),true);
 assert.equal(await ev(`window.fixtureScroller.scrollTop`),90);
 assert.equal(await ev(`window.getSelection().toString()`),'Scientific');
 await click(button('Highlight selection'));await wait(`document.querySelectorAll('[data-highlight-id]').length===1`);
 assert.equal(await ev(`Boolean(${button('Save')}) || Boolean(${button('Refresh PDF')})`),false);
 assert.equal(await ev(`document.querySelectorAll('aside input').length`),0);
 assert.equal(await ev(`document.querySelector('aside h2')?.textContent`),'Imported paper');
 assert.equal(await ev(`document.querySelector('h3')?.textContent`),'Keywords');
 console.log('PASS imported PDF reading layout has no metadata fields, Save or Refresh PDF; selection and scroll survive sync');
 await click(`document.querySelector('#replace-import')`);
 await wait(`document.querySelector('[data-pdf-text="1"] span')?.textContent==='Replacement document'`);
 assert.equal((await importState()).requests,2);
 assert.equal(await count(),0);
 console.log('PASS real file replacement still loads the PDF');
 await cdp('Browser.close');
} finally {clearInterval(keepAlive);ws?.close();browser.kill();await unlink(route);await rmdir(path.dirname(route));}
