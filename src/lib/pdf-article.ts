import { extractPdfMetadata, titleFromPdfItems, type PdfMetadata, type PdfTextItem } from "./academic/pdf-metadata.ts";
import type { AppLanguage } from "./portuguese-labels.ts";
import type { WorkspaceImageAsset } from "./workspace-data.ts";

export function getTitleFromPdfFileName(fileName: string, language: AppLanguage = "pt") {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || (language === "en" ? "Imported PDF" : "PDF importado");
}

export function getSafePdfDownloadName(title: string) {
  const safeName =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "papergraph-artigo";

  return `${safeName}.pdf`;
}

function encodeImportedPdfText(value: string) {
  if (!value.trim()) {
    return null;
  }

  return btoa(unescape(encodeURIComponent(value.trim().slice(0, 12000))));
}

export async function extractPdfTextForAcademicRelations(pdfFile: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()) });
  try {
    const pdfDocument = await loadingTask.promise;
    const pageTexts: string[] = [];
    let title: string | null = null;
    for (let pageNumber = 1; pageNumber <= Math.min(pdfDocument.numPages, 3); pageNumber++) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is PdfTextItem & typeof item => "str" in item);
      if (pageNumber === 1) title = titleFromPdfItems(items);
      pageTexts.push(items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
    }
    const text = pageTexts.join("\n\f\n").slice(0, 12000);
    return { text, metadata: extractPdfMetadata(text, title) };
  } finally {
    await loadingTask.destroy();
  }
}

export function createImportedPdfSource(pdfAsset: WorkspaceImageAsset, academicText?: string, metadata?: PdfMetadata) {
  const encodedAcademicText = encodeImportedPdfText(academicText ?? "");

  return [
    "\\documentclass[12pt]{article}",
    "\\usepackage{pdfpages}",
    encodedAcademicText ? `% papergraph-import-text:${encodedAcademicText}` : "",
    metadata ? `% papergraph-import-metadata:${btoa(unescape(encodeURIComponent(JSON.stringify(metadata))))}` : "",
    "\\begin{document}",
    "\\includepdf[",
    "    pages=-,",
    "    pagecommand={\\thispagestyle{empty}}",
    `]{papergraph-images/${pdfAsset.storedName}}`,
    "\\end{document}",
  ].filter(Boolean).join("\n");
}
