import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeHighlightRects, pdfDocumentKey } from '../src/lib/pdf-highlights.ts';

test('selection geometry stays relative across zoom, clips to page and excludes empty rectangles', () => {
  const normal = normalizeHighlightRects([
    { left: 20, top: 40, right: 60, bottom: 50 },
    { left: 20, top: 40, right: 60, bottom: 50 },
    { left: -10, top: 0, right: 10, bottom: 10 },
    { left: 100, top: 50, right: 100, bottom: 60 },
  ], { left: 0, top: 0, width: 100, height: 200 });
  assert.equal(normal.length, 2);
  const zoomed = normalizeHighlightRects([{ left: 140, top: 180, right: 220, bottom: 200 }], { left: 100, top: 100, width: 200, height: 400 });
  assert.deepEqual(normal[0], zoomed[0]);
  assert.equal(normal[1].x, 0);
});

test('document identity is stable for identical bytes and changes for replacement PDFs', async () => {
  const bytes = (s) => new TextEncoder().encode(s).buffer;
  assert.equal(await pdfDocumentKey(bytes('pdf A')), await pdfDocumentKey(bytes('pdf A')));
  assert.notEqual(await pdfDocumentKey(bytes('pdf A')), await pdfDocumentKey(bytes('pdf B')));
});

for (const articleType of ['text', 'uuid']) test(`highlight persistence and RLS (${articleType} article IDs)`, async () => {
  const db = new PGlite();
  const owner = '00000000-0000-0000-0000-000000000001';
  const viewer = '00000000-0000-0000-0000-000000000002';
  const outsider = '00000000-0000-0000-0000-000000000003';
  const workspace = '00000000-0000-0000-0000-000000000004';
  const second = '00000000-0000-0000-0000-000000000005';
  const article = '00000000-0000-0000-0000-000000000006';
  try {
    await db.exec(`
      create role authenticated; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user_id', true),'')::uuid$$;
      create table public.workspaces(id uuid primary key);
      create table public.articles(workspace_id uuid references public.workspaces(id), id ${articleType}, primary key(workspace_id,id));
      create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select w='${workspace}' and auth.uid() in ('${owner}','${viewer}')$$;
      create function public.can_edit_workspace(w uuid) returns boolean language sql stable as $$select w='${workspace}' and auth.uid()='${owner}'$$;
      insert into auth.users values ('${owner}'),('${viewer}'),('${outsider}');
      insert into public.workspaces values ('${workspace}'),('${second}');
      insert into public.articles values ('${workspace}','${article}'),('${second}','${article}');
      grant usage on schema public,auth to authenticated;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/202609280003_pdf_highlights.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202609290001_pdf_highlight_colors.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set test.user_id='${owner}'`);
    const add = async (workspaceId = workspace, rects = [{x:0.1,y:0.2,width:0.3,height:0.05}]) => db.query(`insert into public.pdf_highlights(workspace_id,article_id,document_key,page_number,selected_text,rects) values ($1,$2,$3,1,'Selected passage',$4) returning id`, [workspaceId,article,'a'.repeat(64),JSON.stringify(rects)]);
    const id = (await add()).rows[0].id;
    assert.equal((await db.query('select color from public.pdf_highlights')).rows[0].color, 'yellow');
    await db.query("update public.pdf_highlights set color='green' where id=$1", [id]);
    assert.equal((await db.query('select color from public.pdf_highlights')).rows[0].color, 'green');
    await assert.rejects(db.query("update public.pdf_highlights set color='invalid' where id=$1", [id]), /check constraint/);
    await assert.rejects(db.query("update public.pdf_highlights set selected_text='changed' where id=$1", [id]), /permission denied/);
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length, 1);
    await assert.rejects(add(second), /row-level security/);
    await assert.rejects(add(workspace, [{x:-1,y:0,width:1,height:1}]), /check constraint/);
    await assert.rejects(add(workspace, [{x:0,y:0,width:0,height:1}]), /check constraint/);
    await assert.rejects(add(workspace, [{x:0,y:0,width:2,height:1}]), /check constraint/);
    await db.exec(`set test.user_id='${viewer}'`);
    assert.equal((await db.query("update public.pdf_highlights set color='pink' returning id")).rows.length, 0);
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length, 1);
    await assert.rejects(add(), /row-level security/);
    assert.equal((await db.query('delete from public.pdf_highlights returning id')).rows.length, 0);
    await db.exec(`set test.user_id='${outsider}'`);
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length, 0);
    await assert.rejects(add(), /row-level security/);
    await db.exec(`set test.user_id='${owner}'`);
    assert.equal((await db.query('delete from public.pdf_highlights where id=$1 returning id', [id])).rows.length, 1);
    await add();
    await db.exec(`reset role; delete from public.articles where workspace_id='${workspace}'`);
    assert.equal((await db.query('select * from public.pdf_highlights')).rows.length, 0);
  } finally { await db.close(); }
});
