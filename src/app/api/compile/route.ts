import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const imageDirectoryName = "papergraph-images";
const missingImageFileName = "papergraph-missing-image.png";
const uploadedImagesDirectory = join(process.cwd(), "data", "images");
const placeholderImagePath = join(process.cwd(), "public", "papergraph-icon.png");
const workspacePath = join(process.cwd(), "data", "workspace.json");

type CompileRequestBody = {
  articleId?: string;
  title?: string;
  source?: string;
};

type WorkspaceImageAsset = {
  articleId?: string;
  originalName: string;
  storedName: string;
};

function resolveTectonicPath() {
  const binaryPath = join(
    process.cwd(),
    "node_modules",
    "@node-latex-compiler",
    "bin-win32-x64",
    "bin",
    "tectonic.exe",
  );

  return existsSync(binaryPath) ? binaryPath : null;
}

function moveXcolorBeforeOtherPackages(source: string) {
  const xcolorPattern = /^[ \t]*\\usepackage(?:\[[^\]]*\])?\{xcolor\}[ \t]*(?:\r?\n)?/gm;
  const xcolorMatches = [...source.matchAll(xcolorPattern)];

  if (xcolorMatches.length === 0) {
    return source;
  }

  const hasTableOption = xcolorMatches.some((match) => /\[[^\]]*\btable\b[^\]]*\]/.test(match[0]));
  const xcolorLine = `\\usepackage${hasTableOption ? "[table]" : ""}{xcolor}\n`;
  const sourceWithoutXcolor = source.replace(xcolorPattern, "");

  return sourceWithoutXcolor.replace(
    /(\\documentclass(?:\[[^\]]*\])?\{[^}]+\}[ \t]*(?:\r?\n)?)/,
    `$1${xcolorLine}`,
  );
}

function createLatexSourceForCompile(source: string) {
  return moveXcolorBeforeOtherPackages(source).replace(/\[\[([^\]\r\n]+)\]\]/g, (fullMatch, rawLink: string) => {
    const [rawTarget, ...rawAliasParts] = rawLink.split("|");
    const target = rawTarget.split("#")[0].trim();
    const alias = rawAliasParts.join("|").trim();

    return alias || target || fullMatch;
  });
}

function getSafeFileName(value: string) {
  const safeName = basename(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim();

  return safeName || null;
}

function resolveCompileImagePath(compileDirectory: string, imagePath: string) {
  const normalizedPath = imagePath.replace(/\\/g, "/").replace(/^\.?\//, "");

  if (!normalizedPath || normalizedPath.split("/").includes("..")) {
    return null;
  }

  return join(compileDirectory, ...normalizedPath.split("/"));
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/([{}#$%&_])/g, String.raw`\$1`)
    .replace(/\^/g, String.raw`\textasciicircum{}`)
    .replace(/~/g, String.raw`\textasciitilde{}`);
}

function rewriteMissingImageReferences(
  source: string,
  compileDirectory: string,
  hasMissingImagePlaceholder: boolean,
) {
  if (!hasMissingImagePlaceholder) {
    return source;
  }

  return source.replace(
    /(\\includegraphics(?:\[[^\]]*\])?\{)([^}]+)(\})/g,
    (fullMatch, prefix: string, imagePath: string, suffix: string) => {
      const resolvedImagePath = resolveCompileImagePath(compileDirectory, imagePath.trim());

      if (resolvedImagePath && existsSync(resolvedImagePath)) {
        return fullMatch;
      }

      return `${prefix}${missingImageFileName}${suffix}`;
    },
  );
}

function rewriteMissingPdfIncludes(source: string, compileDirectory: string) {
  return source.replace(
    /\\includepdf(?:\[[\s\S]*?\])?\{([^}]+)\}/g,
    (fullMatch, pdfPath: string) => {
      const resolvedPdfPath = resolveCompileImagePath(compileDirectory, pdfPath.trim());

      if (resolvedPdfPath && existsSync(resolvedPdfPath)) {
        return fullMatch;
      }

      return [
        String.raw`\clearpage`,
        String.raw`\begin{center}`,
        `\\fbox{\\parbox{0.82\\linewidth}{PDF externo em falta na preview: ${escapeLatexText(
          pdfPath.trim(),
        )}}}`,
        String.raw`\end{center}`,
        String.raw`\clearpage`,
      ].join("\n");
    },
  );
}

async function readWorkspaceImageAssets() {
  try {
    const workspace = JSON.parse(await readFile(workspacePath, "utf8")) as {
      imageAssets?: WorkspaceImageAsset[];
    };

    return workspace.imageAssets ?? [];
  } catch {
    return [];
  }
}

async function copyUploadedImagesToCompileDirectory(compileDirectory: string, articleId?: string) {
  const compileImageDirectory = join(compileDirectory, imageDirectoryName);

  await mkdir(compileImageDirectory, { recursive: true });

  if (existsSync(uploadedImagesDirectory)) {
    await cp(uploadedImagesDirectory, compileImageDirectory, {
      recursive: true,
      force: true,
    });
  }

  const imageAssets = (await readWorkspaceImageAssets()).filter(
    (imageAsset) => !articleId || !imageAsset.articleId || imageAsset.articleId === articleId,
  );

  await Promise.all(
    imageAssets.map(async (imageAsset) => {
      const originalName = getSafeFileName(imageAsset.originalName);
      const storedName = getSafeFileName(imageAsset.storedName);

      if (!originalName || !storedName) {
        return;
      }

      const uploadedImagePath = join(uploadedImagesDirectory, storedName);

      if (!existsSync(uploadedImagePath)) {
        return;
      }

      await Promise.all([
        cp(uploadedImagePath, join(compileDirectory, originalName), { force: true }),
        cp(uploadedImagePath, join(compileImageDirectory, originalName), { force: true }),
      ]);
    }),
  );
}

async function writeMissingImagePlaceholder(compileDirectory: string) {
  if (!existsSync(placeholderImagePath)) {
    return false;
  }

  await cp(placeholderImagePath, join(compileDirectory, missingImageFileName), { force: true });
  return true;
}

async function compileLatexToPdf(source: string, tectonicPath: string, articleId?: string) {
  const compileDirectory = await mkdtemp(join(tmpdir(), "papergraph-latex-"));
  const texPath = join(compileDirectory, "article.tex");
  const pdfPath = join(compileDirectory, "article.pdf");

  try {
    await copyUploadedImagesToCompileDirectory(compileDirectory, articleId);
    const hasMissingImagePlaceholder = await writeMissingImagePlaceholder(compileDirectory);
    const sourceWithImagePlaceholders = rewriteMissingImageReferences(
      source,
      compileDirectory,
      hasMissingImagePlaceholder,
    );
    await writeFile(
      texPath,
      rewriteMissingPdfIncludes(sourceWithImagePlaceholders, compileDirectory),
      "utf8",
    );

    await execFileAsync(tectonicPath, [texPath, `--outdir=${compileDirectory}`], {
      cwd: compileDirectory,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
      timeout: 45000,
    });

    if (!existsSync(pdfPath)) {
      throw new Error("O ficheiro PDF não foi gerado.");
    }

    return await readFile(pdfPath);
  } finally {
    await rm(compileDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompileRequestBody;
    const articleId = body.articleId?.trim();
    const source = body.source?.trim();

    if (!source) {
      return NextResponse.json({ error: "Falta o código LaTeX." }, { status: 400 });
    }

    const tectonicPath = resolveTectonicPath();

    if (!tectonicPath) {
      return NextResponse.json(
        {
          error: "O executável Tectonic não foi encontrado em node_modules. Reinstala @node-latex-compiler/bin-win32-x64.",
        },
        { status: 500 },
      );
    }

    const pdfBuffer = await compileLatexToPdf(createLatexSourceForCompile(source), tectonicPath, articleId);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Falha inesperada na compilação.",
      },
      { status: 500 },
    );
  }
}
