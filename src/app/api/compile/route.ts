import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getPaperGraphAssetDirectory } from "@/lib/server-paths";
import { getSupabaseServerStorageClient } from "@/lib/supabase-client";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const imageDirectoryName = "papergraph-images";
const storageBucket = "papergraph-assets";
const maxLatexSourceSize = 2 * 1024 * 1024;
const maxImageAssets = 200;

function getProjectPath(...segments: string[]) {
  return join(/*turbopackIgnore: true*/ process.cwd(), ...segments);
}

const uploadedImagesDirectory = getPaperGraphAssetDirectory();

type CompileRequestBody = {
  articleId?: string;
  imageAssets?: WorkspaceImageAsset[];
  title?: string;
  source?: string;
};

type WorkspaceImageAsset = {
  articleId?: string;
  originalName: string;
  storedName: string;
  storagePath?: string;
};

function resolveTectonicPath() {
  const configuredTectonicPath = process.env.PAPERGRAPH_TECTONIC_PATH?.trim();

  if (configuredTectonicPath && existsSync(configuredTectonicPath)) {
    return configuredTectonicPath;
  }

  const binaryCandidates = [
    getProjectPath("node_modules", "@node-latex-compiler", "bin-win32-x64", "bin", "tectonic.exe"),
  ];

  try {
    const packageJsonPath = require.resolve("@node-latex-compiler/bin-win32-x64/package.json");
    binaryCandidates.push(join(dirname(packageJsonPath), "bin", "tectonic.exe"));
  } catch {
    // Fall back to the physical node_modules path above.
  }

  return binaryCandidates.find((binaryPath) => existsSync(binaryPath)) ?? null;
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

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}

function resolveCompileImagePath(compileDirectory: string, imagePath: string) {
  const normalizedPath = imagePath.replace(/\\/g, "/").replace(/^\.?\//, "");

  if (!normalizedPath || normalizedPath.split("/").includes("..") || isAbsolute(normalizedPath)) {
    return null;
  }

  const resolvedPath = resolve(compileDirectory, ...normalizedPath.split("/"));
  const relativePath = relative(resolve(compileDirectory), resolvedPath);

  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)
    ? resolvedPath
    : null;
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/([{}#$%&_])/g, String.raw`\$1`)
    .replace(/\^/g, String.raw`\textasciicircum{}`)
    .replace(/~/g, String.raw`\textasciitilde{}`);
}

function createMissingPreviewBox(label: string, assetPath: string) {
  return [
    String.raw`\begingroup`,
    String.raw`\setlength{\fboxsep}{5pt}`,
    `\\fbox{\\parbox{0.82\\linewidth}{\\footnotesize\\raggedright ${label}: ${escapeLatexText(
      assetPath.trim(),
    )}}}`,
    String.raw`\endgroup`,
  ].join("\n");
}

function getLatexSourceLine(source: string, lineNumber: number) {
  return source.split(/\r?\n/)[lineNumber - 1]?.trim();
}

function hasEmptyMathEnvironment(source: string) {
  return /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?)\}\s*\\end\{\1\}/.test(source);
}

function getLatexCompileHint(detail: string, source: string, lineNumber: number) {
  const sourceLine = getLatexSourceLine(source, lineNumber) ?? "";

  if (/Missing \$ inserted/i.test(detail)) {
    if (hasEmptyMathEnvironment(source)) {
      return String.raw`Parece haver um bloco de equacao vazio. Escreve uma formula entre \begin{equation} e \end{equation}, ou remove esse bloco.`;
    }

    if (sourceLine.includes("_")) {
      return String.raw`Se usaste "_" em texto normal, escreve "\_" ou coloca a expressao dentro de $...$.`;
    }

    if (sourceLine.includes("^")) {
      return String.raw`Se usaste "^" em texto normal, escreve "\textasciicircum{}" ou coloca a expressao dentro de $...$.`;
    }

    return String.raw`Confirma se ha simbolos matematicos fora de $...$ ou um ambiente de matematica mal fechado.`;
  }

  if (/file .* not found|not found/i.test(detail)) {
    return "Confirma se o ficheiro foi carregado neste artigo e se o nome no LaTeX esta correto.";
  }

  return null;
}

function formatLatexCompileError(error: unknown, source: string) {
  if (!(error instanceof Error)) {
    return "A compilacao LaTeX falhou.";
  }

  const commandError = error as Error & { stderr?: string; stdout?: string };
  const rawOutput = [commandError.stderr, commandError.stdout, commandError.message]
    .filter(Boolean)
    .join("\n");
  const latexErrorMatch = rawOutput.match(/error:\s+article\.tex:(\d+):\s*([^\r\n]+)/i);

  if (latexErrorMatch) {
    const lineNumber = Number(latexErrorMatch[1]);
    const detail = latexErrorMatch[2].trim();
    const sourceLine = getLatexSourceLine(source, lineNumber);
    const hint = getLatexCompileHint(detail, source, lineNumber);
    const messageParts = [`Erro LaTeX na linha ${lineNumber}: ${detail}.`];

    if (sourceLine) {
      messageParts.push(`Linha ${lineNumber}: ${sourceLine}`);
    }

    if (hint) {
      messageParts.push(hint);
    }

    return messageParts.join(" ");
  }

  const cleanedOutput = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("Command failed:") &&
        !line.startsWith("Fontconfig error:"),
    )
    .slice(0, 4)
    .join(" ");

  return cleanedOutput || error.message || "A compilacao LaTeX falhou.";
}

function rewriteMissingImageReferences(source: string, compileDirectory: string) {
  return source.replace(
    /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g,
    (fullMatch, imagePath: string) => {
      const resolvedImagePath = resolveCompileImagePath(compileDirectory, imagePath.trim());

      if (resolvedImagePath && existsSync(/*turbopackIgnore: true*/ resolvedImagePath)) {
        return fullMatch;
      }

      return createMissingPreviewBox("Imagem em falta na preview", imagePath);
    },
  );
}

function rewriteMissingPdfIncludes(source: string, compileDirectory: string) {
  return source.replace(
    /\\includepdf(?:\[[\s\S]*?\])?\{([^}]+)\}/g,
    (fullMatch, pdfPath: string) => {
      const resolvedPdfPath = resolveCompileImagePath(compileDirectory, pdfPath.trim());

      if (resolvedPdfPath && existsSync(/*turbopackIgnore: true*/ resolvedPdfPath)) {
        return fullMatch;
      }

      return [
        String.raw`\clearpage`,
        String.raw`\begin{center}`,
        createMissingPreviewBox("PDF externo em falta na preview", pdfPath),
        String.raw`\end{center}`,
        String.raw`\clearpage`,
      ].join("\n");
    },
  );
}

async function readWorkspaceImageAssets(requestImageAssets?: WorkspaceImageAsset[]) {
  return Array.isArray(requestImageAssets) ? requestImageAssets.slice(0, maxImageAssets) : [];
}

async function downloadStorageAssetToLocalFile(imageAsset: WorkspaceImageAsset, localFilePath: string, accessToken?: string) {
  const storagePath = imageAsset.storagePath;

  if (!storagePath) {
    return false;
  }

  if (!accessToken) {
    return false;
  }

  const supabase = getSupabaseServerStorageClient(accessToken);

  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase.storage.from(storageBucket).download(storagePath);

  if (error || !data) {
    return false;
  }

  await mkdir(uploadedImagesDirectory, { recursive: true });
  await writeFile(localFilePath, Buffer.from(await data.arrayBuffer()));

  return true;
}

async function copyUploadedImagesToCompileDirectory(
  compileDirectory: string,
  articleId?: string,
  accessToken?: string,
  requestImageAssets?: WorkspaceImageAsset[],
) {
  const compileImageDirectory = join(compileDirectory, imageDirectoryName);

  await mkdir(compileImageDirectory, { recursive: true });

  if (existsSync(uploadedImagesDirectory)) {
    await cp(uploadedImagesDirectory, compileImageDirectory, {
      recursive: true,
      force: true,
    });
  }

  const imageAssets = (await readWorkspaceImageAssets(requestImageAssets)).filter(
    (imageAsset) => !articleId || !imageAsset.articleId || imageAsset.articleId === articleId,
  );

  await Promise.all(
    imageAssets.map(async (imageAsset) => {
      const originalName = getSafeFileName(imageAsset.originalName);
      const storedName = getSafeFileName(imageAsset.storedName);

      if (!originalName || !storedName) {
        return;
      }

      const uploadedImagePath = join(/*turbopackIgnore: true*/ uploadedImagesDirectory, storedName);

      if (!existsSync(/*turbopackIgnore: true*/ uploadedImagePath)) {
        const wasDownloaded = await downloadStorageAssetToLocalFile(imageAsset, uploadedImagePath, accessToken);

        if (!wasDownloaded) {
          return;
        }
      }

      await Promise.all([
        // These are user assets in a temporary runtime directory, not build inputs.
        cp(uploadedImagePath, join(/*turbopackIgnore: true*/ compileImageDirectory, storedName), { force: true }),
        cp(uploadedImagePath, join(/*turbopackIgnore: true*/ compileDirectory, originalName), { force: true }),
        cp(uploadedImagePath, join(/*turbopackIgnore: true*/ compileImageDirectory, originalName), { force: true }),
      ]);
    }),
  );
}

async function compileLatexToPdf(
  source: string,
  tectonicPath: string,
  articleId?: string,
  accessToken?: string,
  requestImageAssets?: WorkspaceImageAsset[],
) {
  const compileDirectory = await mkdtemp(join(tmpdir(), "papergraph-latex-"));
  const texPath = join(compileDirectory, "article.tex");
  const pdfPath = join(compileDirectory, "article.pdf");

  try {
    await copyUploadedImagesToCompileDirectory(compileDirectory, articleId, accessToken, requestImageAssets);
    const sourceWithImagePlaceholders = rewriteMissingImageReferences(source, compileDirectory);
    const sourceForCompile = rewriteMissingPdfIncludes(sourceWithImagePlaceholders, compileDirectory);
    await writeFile(texPath, sourceForCompile, "utf8");

    try {
      await execFileAsync(tectonicPath, [texPath, `--outdir=${compileDirectory}`], {
        cwd: compileDirectory,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 8,
        timeout: 45000,
      });
    } catch (error) {
      throw new Error(formatLatexCompileError(error, sourceForCompile));
    }

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
    const accessToken = getBearerToken(request);

    if (!source) {
      return NextResponse.json({ error: "Falta o código LaTeX." }, { status: 400 });
    }

    if (Buffer.byteLength(source, "utf8") > maxLatexSourceSize) {
      return NextResponse.json({ error: "O código LaTeX excede o limite de 2 MB." }, { status: 413 });
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

    const pdfBuffer = await compileLatexToPdf(
      createLatexSourceForCompile(source),
      tectonicPath,
      articleId,
      accessToken,
      body.imageAssets,
    );

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
