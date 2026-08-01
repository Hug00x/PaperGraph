import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import type { WorkspaceImageAsset } from "@/lib/workspace-data";

export const runtime = "nodejs";

const assetDirectory = join(process.cwd(), "data", "images");
const maxAssetSize = 50 * 1024 * 1024;
const acceptedAssetTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);
const acceptedAssetExtensions = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".pdf", "application/pdf"],
]);

function createSafeAssetName(originalName: string, mimeType: string) {
  const extension = acceptedAssetTypes.get(mimeType) ?? extname(originalName).toLowerCase();
  const baseName =
    originalName
      .replace(/\.[^/.]+$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ficheiro";

  return `${baseName}-${randomUUID()}${extension}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("asset") ?? formData.get("image");
    const articleId = formData.get("articleId");
    const normalizedArticleId = typeof articleId === "string" && articleId.trim() ? articleId.trim() : null;

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ error: "Escolhe um ficheiro para carregar." }, { status: 400 });
    }

    const uploadedFileType =
      acceptedAssetTypes.has(uploadedFile.type)
        ? uploadedFile.type
        : acceptedAssetExtensions.get(extname(uploadedFile.name).toLowerCase());

    if (!uploadedFileType) {
      return NextResponse.json(
        { error: "Formato não suportado. Usa PNG, JPG, WEBP ou PDF." },
        { status: 400 },
      );
    }

    if (uploadedFile.size > maxAssetSize) {
      return NextResponse.json(
        { error: "O ficheiro é demasiado grande. O limite é 50 MB." },
        { status: 400 },
      );
    }

    const storedName = createSafeAssetName(uploadedFile.name, uploadedFileType);
    const assetBuffer = Buffer.from(await uploadedFile.arrayBuffer());

    await mkdir(assetDirectory, { recursive: true });
    await writeFile(join(assetDirectory, storedName), assetBuffer);

    const asset: WorkspaceImageAsset = {
      id: randomUUID(),
      articleId: normalizedArticleId ?? undefined,
      originalName: uploadedFile.name,
      storedName,
      mimeType: uploadedFileType,
      size: uploadedFile.size,
      uploadedAt: "agora",
    };

    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível carregar o ficheiro." },
      { status: 500 },
    );
  }
}
