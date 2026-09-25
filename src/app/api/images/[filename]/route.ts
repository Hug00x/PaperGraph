import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import { getPaperGraphAssetDirectory } from "@/lib/server-paths";
import { getSupabaseServerStorageClient } from "@/lib/supabase-client";

export const runtime = "nodejs";

const storageBucket = "papergraph-assets";
const assetDirectory = getPaperGraphAssetDirectory();
const contentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
]);

type ImageRouteParams = {
  params: Promise<{
    filename: string;
  }>;
};

function getStoragePath(request: Request, filename: string) {
  const requestUrl = new URL(request.url);
  const storagePath = requestUrl.searchParams.get("path")?.trim();

  if (!storagePath) {
    return filename;
  }

  if (!/^[a-z0-9._/-]+$/i.test(storagePath) || storagePath.split("/").includes("..")) {
    return null;
  }

  return storagePath;
}

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

async function downloadAssetFromStorage(storagePath: string, filename: string, accessToken?: string) {
  if (!accessToken) {
    return null;
  }

  const supabase = getSupabaseServerStorageClient(accessToken);

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.storage.from(storageBucket).download(storagePath);

  if (error || !data) {
    return null;
  }

  const assetBuffer = Buffer.from(await data.arrayBuffer());

  await mkdir(assetDirectory, { recursive: true });
  await writeFile(join(assetDirectory, filename), assetBuffer);

  return assetBuffer;
}

export async function GET(request: Request, { params }: ImageRouteParams) {
  const { filename } = await params;

  if (!/^[a-z0-9._-]+$/i.test(filename)) {
    return NextResponse.json({ error: "Nome de ficheiro inválido." }, { status: 400 });
  }

  const extension = extname(filename).toLowerCase();
  const contentType = contentTypes.get(extension);

  if (!contentType) {
    return NextResponse.json({ error: "Formato de ficheiro inválido." }, { status: 400 });
  }

  try {
    const assetBuffer = await readFile(join(assetDirectory, filename));

    return new NextResponse(new Uint8Array(assetBuffer), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  } catch {
    const storagePath = getStoragePath(request, filename);

    if (!storagePath) {
      return NextResponse.json({ error: "Caminho de ficheiro inválido." }, { status: 400 });
    }

    const assetBuffer = await downloadAssetFromStorage(storagePath, filename, getBearerToken(request));

    if (!assetBuffer) {
      return NextResponse.json({ error: "Ficheiro não encontrado." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(assetBuffer), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  }
}

export async function DELETE(_request: Request, { params }: ImageRouteParams) {
  const { filename } = await params;

  if (!/^[a-z0-9._-]+$/i.test(filename)) {
    return NextResponse.json({ error: "Nome de ficheiro inválido." }, { status: 400 });
  }

  const extension = extname(filename).toLowerCase();

  if (!contentTypes.has(extension)) {
    return NextResponse.json({ error: "Formato de ficheiro inválido." }, { status: 400 });
  }

  try {
    await unlink(join(assetDirectory, filename));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
