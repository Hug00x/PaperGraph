"use client";

import { useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfilePhotoControl } from "@/components/profile-photo-control";
import { UserAvatar } from "@/components/user-avatar";

const userId = "00000000-0000-0000-0000-000000000001";

export default function ProfilePhotoFixture() {
  const [revision, setRevision] = useState(0);
  const [memberUrl, setMemberUrl] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState("");
  const fail = useRef(false);
  const memory = useMemo(() => ({ path: null as string | null, files: new Map<string, string>() }), []);
  const supabase = useMemo(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { avatar_path: memory.path }, error: null }) }) }),
      upsert: async (row: { avatar_path: string | null }) => {
        if (fail.current) return { error: { message: "fixture: failed save" } };
        memory.path = row.avatar_path;
        return { error: null };
      },
    }),
    storage: { from: () => ({
      upload: async (path: string, photo: Blob) => {
        const image = await createImageBitmap(photo);
        setImageInfo(`${image.width}x${image.height}:${photo.type}`);
        image.close();
        memory.files.set(path, URL.createObjectURL(photo));
        return { error: null };
      },
      remove: async (paths: string[]) => {
        paths.forEach(path => { const url = memory.files.get(path); if (url) URL.revokeObjectURL(url); memory.files.delete(path); });
        return { error: null };
      },
      createSignedUrl: async (path: string) => ({ data: { signedUrl: memory.files.get(path) }, error: null }),
    }) },
  }) as unknown as SupabaseClient, [memory]);

  return (
    <main className="space-y-6 p-6">
      <ProfilePhotoControl key={revision} supabase={supabase} userId={userId} name="Test User" language="pt" disabled={false}
        onChanged={async () => setMemberUrl(memory.path ? memory.files.get(memory.path) ?? null : null)} />
      <div id="member"><UserAvatar name="Test User" url={memberUrl} /></div>
      <p id="image-info">{imageInfo}</p>
      <button id="remount" onClick={() => setRevision(value => value + 1)}>Reopen account</button>
      <button id="fail" onClick={() => { fail.current = !fail.current; }}>Toggle save failure</button>
    </main>
  );
}
