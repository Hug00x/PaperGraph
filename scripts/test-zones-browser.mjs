import WebSocket from "../node_modules/next/dist/compiled/ws/index.js";
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, copyFile, unlink, rmdir, mkdtemp } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
// Run against an existing local Next dev server. The temporary route uses GraphPane,
// test-only state and localStorage; it never accesses a user's workspace.
const route = path.resolve('src/app/zones-check/page.tsx');
if (existsSync(route)) throw Error('Temporary zones-check route already exists; refusing to overwrite it.');
await mkdir(path.dirname(route), {recursive:true});
await copyFile('tests/fixtures/graph-zones-page.tsx', route, constants.COPYFILE_EXCL);
await mkdir('.utmp', {recursive:true});
const profile = await mkdtemp(path.resolve('.utmp/zones-browser-'));
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
 const wait=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(100);}throw Error('Timeout: '+expression);};
 const rect=expr=>ev(`(()=>{const e=${expr};if(!e)throw Error('missing element');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,left:r.x,top:r.y,width:r.width,height:r.height};})()`);
 const mouse=(type,x,y,extra={})=>cdp('Input.dispatchMouseEvent',{type,x,y,...extra});
 const click=async(expr,modifiers=0)=>{const r=await rect(expr);await mouse('mousePressed',r.x,r.y,{button:'left',clickCount:1,modifiers});await mouse('mouseReleased',r.x,r.y,{button:'left',clickCount:1,modifiers});await pause(150);};
 const rightClick=async(expr)=>{const r=await rect(expr);await mouse('mousePressed',r.x,r.y,{button:'right',clickCount:1});await mouse('mouseReleased',r.x,r.y,{button:'right',clickCount:1});await pause(150);};
 const button=text=>`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
 const drag=async(expr,dx,dy,anchorX)=>{const r=await rect(expr);if(anchorX!==undefined)r.x=r.left+anchorX;const beforeWrites=(await state()).writes;await mouse('mousePressed',r.x,r.y,{button:'left',clickCount:1});for(let i=1;i<=8;i++){await mouse('mouseMoved',r.x+dx*i/8,r.y+dy*i/8,{button:'left',buttons:1});await pause(20);}assert.equal((await state()).writes,beforeWrites,'no writes during preview');await mouse('mouseReleased',r.x+dx,r.y+dy,{button:'left',clickCount:1});await pause(200);};
 const state=()=>ev(`JSON.parse(document.querySelector('#fixture-state').textContent)`);
 const name=async value=>{await ev(`(()=>{const e=document.querySelector('[role=dialog] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);};
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:`${process.env.GRAPH_TEST_URL ?? 'http://localhost:3000'}/zones-check`});
 await wait(`!!document.querySelector('[data-article-id="A"]')`);await pause(600);
 assert.equal(await ev(`[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Select papers'))`),false);
 const create=()=>`[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Create group'))`;
 const createRect=await rect(create()), filterRect=await rect(button('Filters'));
 assert.ok(createRect.x<filterRect.x && Math.abs(createRect.y-filterRect.y)<2);
 const draw=async(x1,y1,x2,y2)=>{
   await click(create());const before=(await state()).writes;
   await mouse('mousePressed',x1,y1,{button:'left',clickCount:1});
   await mouse('mouseMoved',x2,y2,{button:'left',buttons:1});await pause(100);
   assert.equal((await state()).writes,before);
   await mouse('mouseReleased',x2,y2,{button:'left',clickCount:1});await pause(150);
 };
 const initial=await state(), ar=await rect(`document.querySelector('[data-article-id="A"]')`), br=await rect(`document.querySelector('[data-article-id="B"]')`);
 await draw(ar.x-100,ar.y-100,br.x+100,br.y+100);
 await name('Method 1');await click(`document.querySelector('[aria-label="Green"]')`);await click(button('Create'));
 let s=await state();assert.equal(s.zones.length,1);assert.deepEqual(s.positions,initial.positions);
 assert.equal(await ev(`document.querySelector('[data-article-id="A"]').dataset.zoneColor`),'green');
 console.log('PASS drawing creates zone without selection or moving articles; toolbar next to filters');
 const zone=s.zones[0],zoneExpr=`document.querySelector('[data-zone-id="${zone.id}"]')`;
 // Use the pencil to open dedicated notes, then save multiline text.
 await click(`${zoneExpr}.querySelector('[aria-label="Open group notes"]')`);
 await wait(`!!document.querySelector('textarea[aria-label^="Notes:"]')`);
 await ev(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Research notes\\nNext steps');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(100);
 await click(button('Save notes'));assert.equal((await state()).zones[0].notes,'Research notes\nNext steps');
 // Reopening the notes drawer shows saved content. Closing preserves it.
 await click(`${zoneExpr}.querySelector('[aria-label="Open group notes"]')`);
 assert.equal(await ev(`document.querySelector('textarea')?.value`),'Research notes\nNext steps');await click(button('Close'));
 console.log('PASS pencil opens dedicated notes; notes persist');
 await drag(`${zoneExpr}.querySelector('button')`,50,60,12);
 assert.equal(await ev(`document.querySelector('textarea[aria-label^="Notes:"]')!==null`),false);
 s=await state();const dx=s.zones[0].x-zone.x;
 assert.ok(dx>0);for(const id of ['A','B'])assert.ok(Math.abs(s.positions[id].x-initial.positions[id].x-dx)<1e-8);
 const zrect=await rect(zoneExpr),c=await rect(`document.querySelector('[data-article-id="C"]')`);
 await drag(`document.querySelector('[data-article-id="C"]')`,zrect.x-c.x,zrect.y+20-c.y);
 assert.equal(await ev(`document.querySelector('[data-article-id="C"]').dataset.zoneColor`),'green');
 console.log('PASS zone drag moves members without opening notes; article drop membership');
 // Cancel a small drawing and cancel an overlapping zone without persisting.
 const beforeInvalid=await state();await draw(1150,600,1152,602);assert.ok(await ev(`document.querySelector('[data-zone-drawing]')!==null`));
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await pause(100);
 assert.deepEqual(await state(),beforeInvalid);
 const currentRect=await rect(zoneExpr);await draw(currentRect.left-10,currentRect.top-10,currentRect.left+currentRect.width+10,currentRect.top+currentRect.height+10);
 assert.ok(await ev(`document.querySelector('[role="dialog"] input')!==null`));await click(button('Cancel'));assert.deepEqual(await state(),beforeInvalid);
 // Draw an empty Zone in reverse direction.
 await draw(1320,700,1040,430);await name('Method 2');await click(`document.querySelector('[aria-label="Violet"]')`);await click(button('Create'));
 s=await state();assert.equal(s.zones.length,2);const second=s.zones[1],secondExpr=`document.querySelector('[data-zone-id="${second.id}"]')`;
 assert.equal(second.notes,'');
 const target=await rect(secondExpr),article=await rect(`document.querySelector('[data-article-id="A"]')`);
 await drag(`document.querySelector('[data-article-id="A"]')`,target.x-article.x,target.y-article.y);
 assert.equal(await ev(`document.querySelector('[data-article-id="A"]').dataset.zoneColor`),'violet');
 assert.equal((await state()).zones[0].notes,'Research notes\nNext steps');
 console.log('PASS tiny drawing rejected, overlapping drawing accepted, reverse drawing and transfer');
 // Select by a short real drag to reveal controls, without opening notes.
 await drag(`${secondExpr}.querySelector('button')`,8,0,12);
 await rightClick(`${secondExpr}.querySelector('button')`);await name('Renamed');await click(button('Save'));
 const beforeResize=await state();await drag(`${secondExpr}.querySelector('[aria-label="Resize group nw"]')`,10,20);
 assert.deepEqual((await state()).positions,beforeResize.positions);
 await ev(`document.documentElement.dataset.papergraphTheme='light'`);await pause(300);
 await writeFile('.utmp/zones-light.png',Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const saved=await state();await cdp('Page.reload');await wait(`!!document.querySelector('#fixture-state')`);await pause(400);await ev(`document.querySelector('#restore-fixture').click()`);await pause(800);
 s=await state();assert.deepEqual(s.zones,saved.zones);assert.deepEqual(s.positions,saved.positions);
 console.log('PASS rename, resize, reopen with independent notes');
 await drag(`${secondExpr}.querySelector('button')`,8,0,12);
 await rightClick(`${secondExpr}.querySelector('button')`);await click(button('Delete group'));await click(button('Delete'));
 s=await state();assert.equal(s.zones.length,1);assert.equal(Object.keys(s.positions).length,3);
 console.log('PASS deletion preserves papers and other zone notes');
 // The first zone's notes button/NE handle are under the later zone's body,
 // then under its header. Actual mouse hits must still reach selected controls.
 const overlapZones = [
   {id:'overlap-back',name:'Behind',color:'teal',notes:'Behind notes',x:40,y:40,width:22,height:22},
   {id:'overlap-front',name:'Front',color:'violet',notes:'Front notes',x:52,y:36,width:24,height:26},
 ];
 const behind = `document.querySelector('[data-zone-id="overlap-back"]')`;
 const front = `document.querySelector('[data-zone-id="overlap-front"]')`;
 const assertHit = async expression => {
   assert.equal(await ev(`(()=>{const e=${expression},r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),true,'control receives the pointer above overlapping zones');
 };
 for (const frontY of [36,40]) {
   overlapZones[1].y=frontY;
   await ev(`localStorage.setItem('zones-fixture',${JSON.stringify(JSON.stringify({zones:overlapZones,positions:initial.positions}))});document.querySelector('#restore-fixture').click()`);
   await pause(800);
   await click(`${behind}.querySelector('button')`);
   const notesButton = `${behind}.querySelector('[aria-label="Open group notes"]')`;
   await assertHit(notesButton);
   await assertHit(`${behind}.querySelector('[aria-label="Resize group ne"]')`);
   const beforeNotes = await state();
   await click(notesButton);
   await wait(`document.querySelector('textarea[aria-label="Notes: Behind"]')?.value==='Behind notes'`);
   assert.deepEqual(await state(),beforeNotes,'opening notes never moves either zone');
   await click(button('Close'));
   // Raising the selected controls must not raise its entire background.
   await assertHit(`${front}.querySelector('button')`);
   await click(`${front}.querySelector('button')`);
   await click(`${front}.querySelector('[aria-label="Open group notes"]')`);
   await wait(`document.querySelector('textarea[aria-label="Notes: Front"]')?.value==='Front notes'`);
   await click(button('Close'));
   await assertHit(`document.querySelector('[data-article-id="B"]')`);
 }
 await click(`${behind}.querySelector('button')`);
 const beforeOverlapResize = await state();
 await drag(`${behind}.querySelector('[aria-label="Resize group ne"]')`,15,-15);
 assert.ok((await state()).zones[0].width>beforeOverlapResize.zones[0].width);
 assert.deepEqual((await state()).positions,beforeOverlapResize.positions);
 console.log('PASS overlapping bodies/headers keep notes, resize handles, other headers and articles clickable');
 await ev(`document.querySelector('#dense-fixture').click()`);await pause(200);
 assert.equal(await ev(`document.querySelectorAll('[data-graph-node]').length`),153);
 const visibleDenseId = await ev(`(()=>{for(const e of document.querySelectorAll('[data-article-id^="dense-"]')){const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(x>370&&x<1300&&y>100&&y<800&&document.elementFromPoint(x,y)?.closest('[data-article-id]')===e)return e.dataset.articleId;}})()`);
 assert.ok(visibleDenseId,'dense graph has an unobscured node');
 const denseBefore=await state();await drag(`document.querySelector('[data-article-id="${visibleDenseId}"]')`,25,20);
 assert.equal((await state()).writes,denseBefore.writes+1);
 console.log('PASS drag with 153 nodes and 152 relations');
 await ev(`document.querySelector('#readonly-fixture').click()`);await pause(100);
 assert.equal(await ev(`document.querySelectorAll('[aria-label="Edit zone"],.papergraph-zone-handle').length`),0);
 assert.equal(await ev(`[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Create group'))`),false);
 console.log('PASS read-only workspace controls');
 await cdp('Browser.close');
} finally {clearInterval(keepAlive);ws?.close();browser.kill();await unlink(route);await rmdir(path.dirname(route));}
