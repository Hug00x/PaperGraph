import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { validateProfilePhoto, isProfileAvatarPath, saveProfileAvatar, getWorkspaceAvatarUrls, deleteProfileAvatarFiles } from "../src/lib/profile-avatar.ts";

const owner = "00000000-0000-0000-0000-000000000001";
const viewer = "00000000-0000-0000-0000-000000000002";
const outsider = "00000000-0000-0000-0000-000000000003";
const workspace = "00000000-0000-0000-0000-000000000004";
const previousPath = `${owner}/${workspace}.webp`;

test("photos accept supported images within the limit and reject unsafe paths", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) validateProfilePhoto({ type, size: 5 * 1024 * 1024 });
  for (const file of [{ type: "image/svg+xml", size: 100 }, { type: "image/png", size: 0 }, { type: "image/png", size: 5 * 1024 * 1024 + 1 }]) {
    assert.throws(() => validateProfilePhoto(file), /avatar-invalid/);
  }
  assert.equal(isProfileAvatarPath(previousPath, owner), true);
  assert.equal(isProfileAvatarPath(previousPath, viewer), false);
  assert.equal(isProfileAvatarPath(`${owner}/../photo.webp`, owner), false);
});

function client({ uploadError = null, profileError = null } = {}) {
  const events = [];
  const bucket = {
    upload: async (path) => { events.push(["upload", path]); return { error: uploadError }; },
    remove: async (paths) => { events.push(["remove", paths]); return { error: null }; },
  };
  return { events, supabase: {
    storage: { from: () => bucket },
    from: () => ({ upsert: async (row) => { events.push(["profile", row]); return { error: profileError }; } }),
  } };
}

test("replacement saves the new reference before removing the old photo; removal preserves other profile fields", async () => {
  const { supabase, events } = client();
  const path = await saveProfileAvatar(supabase, owner, new Blob(["photo"]), previousPath);
  assert.equal(isProfileAvatarPath(path, owner), true);
  assert.deepEqual(events.map(event => event[0]), ["upload", "profile", "remove"]);
  assert.equal(events[1][1].avatar_path, path);
  assert.equal("display_name" in events[1][1], false);
  assert.deepEqual(events[2][1], [previousPath]);
  events.length = 0;
  assert.equal(await saveProfileAvatar(supabase, owner, null, previousPath), null);
  assert.deepEqual(events.map(event => event[0]), ["profile", "remove"]);
  assert.equal(events[0][1].avatar_path, null);
});

test("failed uploads and failed profile writes preserve the previous avatar", async () => {
  const upload = client({ uploadError: { message: "offline" } });
  await assert.rejects(saveProfileAvatar(upload.supabase, owner, new Blob(["photo"]), previousPath), /offline/);
  assert.deepEqual(upload.events.map(event => event[0]), ["upload"]);
  const profile = client({ profileError: { message: "denied" } });
  await assert.rejects(saveProfileAvatar(profile.supabase, owner, new Blob(["photo"]), previousPath), /denied/);
  assert.deepEqual(profile.events[2], ["remove", [profile.events[0][1]]]);
  assert.notEqual(profile.events[0][1], previousPath);
});

test("member URL mapping ignores foreign paths and uses initials when signing fails", async () => {
  const supabase = {
    rpc: async () => ({ data: [{ user_id: owner, avatar_path: previousPath }, { user_id: viewer, avatar_path: previousPath }], error: null }),
    storage: { from: () => ({ createSignedUrls: async paths => {
      assert.deepEqual(paths, [previousPath]);
      return { data: [{ path: previousPath, signedUrl: "https://example.test/photo" }], error: null };
    } }) },
  };
  assert.deepEqual([...await getWorkspaceAvatarUrls(supabase, workspace)], [[owner, "https://example.test/photo"]]);
  supabase.rpc = async () => ({ data: null, error: { message: "not allowed" } });
  assert.equal((await getWorkspaceAvatarUrls(supabase, workspace)).size, 0);
});

test("account deletion removes all avatar files in batches, including abandoned uploads", async () => {
  let files = Array.from({ length: 205 }, (_, index) => ({ id: String(index), name: `${index}.webp` }));
  const batches = [];
  const supabase = { storage: { from: () => ({
    list: async (prefix, { limit }) => { assert.equal(prefix, owner); return { data: files.slice(0, limit), error: null }; },
    remove: async paths => { batches.push(paths.length); files = files.filter(file => !paths.includes(`${owner}/${file.name}`)); return { error: null }; },
  }) } };
  await deleteProfileAvatarFiles(supabase, owner);
  assert.deepEqual(batches, [100, 100, 5]);
});

test("avatar migration restricts reads to workspace peers and changes to the profile owner", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
      create table public.profiles(id uuid primary key, display_name text);
      create table public.workspace_members(workspace_id uuid, user_id uuid);
      create function public.is_workspace_member(w uuid) returns boolean language sql stable security definer as $$
        select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid()) $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id text primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      alter table public.profiles enable row level security;
      create policy profiles_owner on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
      grant usage on schema public,auth,storage to authenticated,anon;
      grant select,insert,update,delete on storage.objects,public.profiles to authenticated;
      grant select on storage.objects to anon;
      insert into public.profiles values ('${owner}','Owner'),('${viewer}','Viewer'),('${outsider}','Outsider');
      insert into public.workspace_members values ('${workspace}','${owner}'),('${workspace}','${viewer}');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/202610020001_profile_avatars.sql", import.meta.url), "utf8"));
    await db.exec(`set role authenticated; set test.user_id='${owner}';
      insert into storage.objects values ('photo','papergraph-avatars','${previousPath}');
      update public.profiles set avatar_path='${previousPath}' where id='${owner}';`);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
    await db.exec(`set test.user_id='${viewer}'`);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
    assert.equal((await db.query("select * from public.list_workspace_member_avatars($1)", [workspace])).rows[0].avatar_path, previousPath);
    assert.equal((await db.query("delete from storage.objects returning *")).rows.length, 0);
    assert.equal((await db.query("update storage.objects set name='changed' returning *")).rows.length, 0);
    await assert.rejects(db.query("insert into storage.objects values ('attack','papergraph-avatars',$1)", [previousPath]), /row-level security/);
    await assert.rejects(db.query("update public.profiles set avatar_path=$1 where id=$2", [previousPath, viewer]), /profiles_avatar_path_check/);
    await db.exec(`set test.user_id='${outsider}'`);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    await assert.rejects(db.query("select * from public.list_workspace_member_avatars($1)", [workspace]), /not allowed/);
    await db.exec("set role anon; set test.user_id=''");
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    await assert.rejects(db.query("select * from public.list_workspace_member_avatars($1)", [workspace]), /permission denied/);
    await db.exec(`set role authenticated; set test.user_id='${owner}'`);
    assert.equal((await db.query("delete from storage.objects returning *")).rows.length, 1);
  } finally { await db.close(); }
});
