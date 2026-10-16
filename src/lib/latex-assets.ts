import type { WorkspaceImageAsset } from "./workspace-data.ts";

export const latexImageDirectory = "papergraph-images";

export function formatBytes(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeLatexText(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/~/g, "\\textasciitilde{}");
}

export function getImageUrl(imageAsset: WorkspaceImageAsset) {
  const storagePath = imageAsset.storagePath ?? imageAsset.storedName;

  return `/api/images/${encodeURIComponent(imageAsset.storedName)}?path=${encodeURIComponent(storagePath)}`;
}

export function isPdfAsset(imageAsset: WorkspaceImageAsset) {
  return imageAsset.mimeType === "application/pdf" || imageAsset.storedName.toLowerCase().endsWith(".pdf");
}

export function getAssetKindLabel(imageAsset: WorkspaceImageAsset) {
  return isPdfAsset(imageAsset) ? "PDF" : "IMG";
}

function getImageCaption(imageAsset: WorkspaceImageAsset) {
  return imageAsset.originalName.replace(/\.[^/.]+$/, "");
}

function createImageLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return [
    "",
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[width=0.85\\linewidth]{${latexImageDirectory}/${imageAsset.storedName}}`,
    `  \\caption{${escapeLatexText(getImageCaption(imageAsset))}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}

function createPdfLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return [
    "",
    "\\includepdf[",
    "    pages=-,",
    "    pagecommand={\\thispagestyle{empty}}",
    `]{${latexImageDirectory}/${imageAsset.storedName}}`,
    "",
  ].join("\n");
}

export function createAssetLatexSnippet(imageAsset: WorkspaceImageAsset) {
  return isPdfAsset(imageAsset) ? createPdfLatexSnippet(imageAsset) : createImageLatexSnippet(imageAsset);
}

function ensureLatexPackage(documentSource: string, packageName: string) {
  const packagePattern = new RegExp(`\\\\usepackage(?:\\[[^\\]]+\\])?\\{${packageName}\\}`);

  if (packagePattern.test(documentSource)) {
    return documentSource;
  }

  const packageLine = `\\usepackage{${packageName}}\n`;
  const beginDocumentIndex = documentSource.search(/\\begin\{document\}/);

  if (beginDocumentIndex === -1) {
    return `${packageLine}${documentSource}`;
  }

  return `${documentSource.slice(0, beginDocumentIndex).trimEnd()}\n${packageLine}\n${documentSource.slice(
    beginDocumentIndex,
  )}`;
}

export function ensureAssetPackages(documentSource: string, imageAsset: WorkspaceImageAsset) {
  return ensureLatexPackage(documentSource, isPdfAsset(imageAsset) ? "pdfpages" : "graphicx");
}

export function getDefaultImageInsertionIndex(documentSource: string) {
  const endDocumentIndex = documentSource.lastIndexOf("\\end{document}");

  return endDocumentIndex === -1 ? documentSource.length : endDocumentIndex;
}

