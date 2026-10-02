import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserUuid } from "./browser-uuid.ts";

export const profileAvatarBucket = "papergraph-avatars";
export const maxProfilePhotoBytes = 5 * 1024 * 1024;
export const avatarUrlLifetime = 60 * 60;

export function validateProfilePhoto(file: Pick<File, "size" | "type">) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("avatar-invalid-type");
  }
  if (!file.size || file.size > maxProfilePhotoBytes) {
    throw new Error("avatar-invalid-size");
  }
}

export function isProfileAvatarPath(path: string, userId: string) {
  return path.startsWith(`${userId}/`) && /^[0-9a-f-]{36}\/[^/]+\.webp$/i.test(path);
}

export async function getProfileAvatarUrl(supabase: SupabaseClient, path: string | null) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(profileAvatarBucket).createSignedUrl(path, avatarUrlLifetime);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function deleteProfileAvatarFiles(supabase: SupabaseClient, userId: string) {
  const bucket = supabase.storage.from(profileAvatarBucket);
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: 100 });
    if (error) throw new Error(error.message);
    const paths = (data ?? []).filter(item => item.id).map(item => `${userId}/${item.name}`);
    if (!paths.length) return;
    const removed = await bucket.remove(paths);
    if (removed.error) throw new Error(removed.error.message);
  }
}

export async function saveProfileAvatar(
  supabase: SupabaseClient,
  userId: string,
  photo: Blob | null,
  previousPath: string | null,
) {
  const path = photo ? `${userId}/${createBrowserUuid()}.webp` : null;
  const bucket = supabase.storage.from(profileAvatarBucket);
  if (photo && path) {
    const { error } = await bucket.upload(path, photo, { contentType: "image/webp", upsert: false });
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("profiles").upsert({
    id: userId, avatar_path: path, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) {
    if (path) await bucket.remove([path]).catch(() => undefined);
    throw new Error(error.message);
  }
  // Only discard the previous photo once the profile points to the new one.
  if (previousPath && isProfileAvatarPath(previousPath, userId)) {
    await bucket.remove([previousPath]).catch(() => undefined);
  }
  return path;
}

export async function getWorkspaceAvatarUrls(supabase: SupabaseClient, workspaceId: string) {
  const urls = new Map<string, string>();
  const { data, error } = await supabase.rpc("list_workspace_member_avatars", { target_workspace_id: workspaceId });
  if (error || !Array.isArray(data)) return urls;
  const rows = data.filter((row): row is { user_id: string; avatar_path: string } =>
    typeof row?.user_id === "string" && typeof row?.avatar_path === "string" &&
    isProfileAvatarPath(row.avatar_path, row.user_id));
  if (!rows.length) return urls;
  const signed = await supabase.storage.from(profileAvatarBucket)
    .createSignedUrls(rows.map(row => row.avatar_path), avatarUrlLifetime);
  if (signed.error) return urls;
  const byPath = new Map((signed.data ?? []).map(item => [item.path, item.signedUrl]));
  rows.forEach(row => {
    const url = byPath.get(row.avatar_path);
    if (url) urls.set(row.user_id, url);
  });
  return urls;
}

export async function prepareProfilePhoto(file: File) {
  validateProfilePhoto(file);
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("avatar-invalid-image");
    const side = Math.min(image.width, image.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("avatar-invalid-image")), "image/webp", 0.85);
    });
  } finally {
    image.close();
  }
}
