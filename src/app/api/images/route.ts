import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";
import { getPaperGraphAssetDirectory } from "@/lib/server-paths";
import type { WorkspaceImageAsset } from "@/lib/workspace-data";

export const runtime = "nodejs";

const assetDirectory = getPaperGraphAssetDirectory();
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

function hasExpectedFileSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }

  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/webp") {
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }

  return mimeType === "application/pdf" && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

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

    if (!hasExpectedFileSignature(assetBuffer, uploadedFileType)) {
      return NextResponse.json({ error: "O conteúdo do ficheiro não corresponde ao formato indicado." }, { status: 400 });
    }

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
  } catch {
    return NextResponse.json(
      { error: "Não foi possível guardar o ficheiro no servidor local." },
      { status: 500 },
    );
  }
}
