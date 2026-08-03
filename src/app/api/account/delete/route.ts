import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getSupabaseServerStorageClient } from "@/lib/supabase-client";
import { paperGraphAssetBucket } from "@/lib/supabase-storage";

export const runtime = "nodejs";

const assetDirectory = join(process.cwd(), "data", "images");

type StoragePathRow = {
  storage_path: string | null;
};

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function getStoredNameFromStoragePath(storagePath: string) {
  return storagePath.split("/").filter(Boolean).at(-1) ?? "";
}

async function deleteLocalAssetMirror(storagePath: string) {
  const storedName = getStoredNameFromStoragePath(storagePath);

  if (!/^[a-z0-9._-]+$/i.test(storedName)) {
    return;
  }

  await unlink(join(assetDirectory, storedName)).catch(() => undefined);
}

export async function DELETE(request: Request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
      return NextResponse.json(
        { error: "A chave privada do Supabase não está configurada no servidor." },
        { status: 500 },
      );
    }

    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return NextResponse.json({ error: "Sessão Supabase inválida." }, { status: 401 });
    }

    const userClient = getSupabaseServerStorageClient(accessToken);
    const serviceClient = getSupabaseServerStorageClient();

    if (!userClient || !serviceClient) {
      return NextResponse.json({ error: "Supabase não está configurado." }, { status: 500 });
    }

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Sessão Supabase inválida." }, { status: 401 });
    }

    const { data: storageRows, error: storageRowsError } = await serviceClient.rpc(
      "list_user_account_deletion_storage_paths",
      {
        target_user_id: user.id,
      },
    );

    if (storageRowsError) {
      throw new Error(storageRowsError.message);
    }

    const storagePaths = [
      ...new Set(
        ((storageRows ?? []) as StoragePathRow[])
          .map((row) => row.storage_path)
          .filter((storagePath): storagePath is string => Boolean(storagePath)),
      ),
    ];

    const { error: cleanupError } = await serviceClient.rpc("delete_user_account_data", {
      target_user_id: user.id,
    });

    if (cleanupError) {
      throw new Error(cleanupError.message);
    }

    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      throw new Error(deleteUserError.message);
    }

    for (let index = 0; index < storagePaths.length; index += 100) {
      const batch = storagePaths.slice(index, index + 100);
      await serviceClient.storage.from(paperGraphAssetBucket).remove(batch);
    }

    await Promise.all(storagePaths.map(deleteLocalAssetMirror)).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível eliminar a conta." },
      { status: 500 },
    );
  }
}
