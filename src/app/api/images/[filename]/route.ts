import { readFile, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const assetDirectory = join(process.cwd(), "data", "images");
const contentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".pdf", "application/pdf"],
]);

type ImageRouteParams = {
  params: Promise<{
    filename: string;
  }>;
};

export async function GET(_request: Request, { params }: ImageRouteParams) {
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
    return NextResponse.json({ error: "Ficheiro não encontrado." }, { status: 404 });
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
    return NextResponse.json({ error: "Ficheiro não encontrado." }, { status: 404 });
  }
}
