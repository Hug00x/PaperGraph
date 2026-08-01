import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkspaceImageAsset } from "@/lib/workspace-data";

export const paperGraphAssetBucket = "papergraph-assets";

export function getWorkspaceAssetStoragePath(userId: string, articleId: string | undefined, storedName: string) {
  return `${userId}/${articleId ?? "workspace"}/${storedName}`;
}

export async function uploadWorkspaceAssetToSupabase(
  supabase: SupabaseClient,
  userId: string,
  imageAsset: WorkspaceImageAsset,
  file: File,
) {
  const storagePath = getWorkspaceAssetStoragePath(userId, imageAsset.articleId, imageAsset.storedName);
  const { error } = await supabase.storage.from(paperGraphAssetBucket).upload(storagePath, file, {
    contentType: imageAsset.mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...imageAsset,
    storagePath,
  };
}
