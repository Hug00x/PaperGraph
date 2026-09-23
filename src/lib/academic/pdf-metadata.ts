// Browser/server shared extraction. No network or model is needed to read metadata.
export type PdfMetadata = { title: string | null; doi: string | null; abstract: string | null };
export type PdfTextItem = { str: string; height: number; transform: number[]; hasEOL?: boolean };

function clean(text: string) {
  return text.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2").replace(/\s+/g, " ").trim();
}

export function decodeImportedPdfText(source: string) {
  const match = source.match(/^% papergraph-import-text:([a-zA-Z0-9+/=]+)$/m);
  try { return match ? new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))) : ""; }
  catch { return ""; }
}

export function extractPdfMetadata(text: string, title: string | null = null): PdfMetadata {
  // Only identify the document's DOI in front matter, never in its bibliography.
  const front = text.split(/\f|\b(?:references|bibliography|referências)\b/i)[0].slice(0, 6000);
  const doi = front.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0]
    .replace(/[).,;:]+$/, "").toLowerCase() ?? null;
  const heading = /(?:^|[\s—–.:])(?:abstract|resumo)\s*(?:[—–:\-.]\s*)?/i.exec(text.slice(0, 14000));
  let abstract: string | null = null;
  if (heading) {
    const rest = text.slice(heading.index + heading[0].length, heading.index + heading[0].length + 8000);
    // Works with both legacy flattened text and new line-preserving extraction.
    const end = rest.search(/(?:\b(?:keywords|key words|index terms|palavras[- ]chave)\s*[:—–-]?|(?:^|\s)(?:1[.\s]+|I[.\s]+)?(?:introduction|introdução|background)\b|\n\s*\d+\.?\s+[A-Z])/im);
    if (end >= 0) {
      const candidate = clean(rest.slice(0, end));
      if (candidate.length >= 80 && candidate.length <= 6000) abstract = candidate;
    } else {
      // Only accept a bounded paragraph; don't silently embed the entire paper.
      const paragraph = rest.split(/\n\s*\n/)[0];
      if (paragraph.length < rest.length && clean(paragraph).length >= 80 && paragraph.length <= 6000) abstract = clean(paragraph);
    }
  }
  return { title: title ? clean(title) : null, doi, abstract };
}

export function titleFromPdfItems(items: PdfTextItem[]): string | null {
  const lines: Array<{ text: string; height: number; y: number }> = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    const previous = lines.find((line) => Math.abs(line.y - y) < 3);
    if (previous && Math.abs(previous.y - y) < 3) {
      previous.text += ` ${item.str}`;
      previous.height = Math.max(previous.height, Math.abs(item.height));
    } else lines.push({ text: item.str, height: Math.abs(item.height), y });
  }
  const front = lines.sort((a, b) => b.y - a.y).slice(0, 40);
  const cutoff = front.findIndex((line) => /^\s*(abstract|resumo)\b/i.test(line.text));
  const candidates = (cutoff >= 0 ? front.slice(0, cutoff) : front).filter((line) =>
    line.text.trim().length > 8 && !/doi|https?:|www\.|@|copyright|proceedings|journal|arxiv|university|universidade/i.test(line.text));
  const biggest = candidates.reduce((best, line) => line.height > (best?.height ?? 0) ? line : best, null as typeof lines[number] | null);
  if (!biggest || biggest.height < 10) return null;
  const index = front.indexOf(biggest);
  const selected = [biggest.text];
  for (let i = index + 1; i < front.length && selected.length < 4; i++) {
    const line = front[i];
    if (Math.abs(line.height - biggest.height) > 1.5 || Math.abs(line.y - front[i - 1].y) > biggest.height * 2.5 || !candidates.includes(line)) break;
    selected.push(line.text);
  }
  const title = clean(selected.join(" ")).replace(/[*†‡]+$/g, "").trim();
  return title.length >= 15 && title.length <= 350 ? title : null;
}

export function importedPdfMetadata(source: string): PdfMetadata {
  const fallback = extractPdfMetadata(decodeImportedPdfText(source));
  const match = source.match(/^% papergraph-import-metadata:([a-zA-Z0-9+/=]+)$/m);
  if (!match) return fallback;
  try {
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))));
    return {
      title: typeof value.title === "string" && value.title.length <= 350 ? value.title : null,
      doi: typeof value.doi === "string" && /^10\.\d{4,9}\//.test(value.doi) ? value.doi : fallback.doi,
      abstract: typeof value.abstract === "string" && value.abstract.length >= 80 && value.abstract.length <= 6000 ? value.abstract : fallback.abstract,
    };
  } catch { return fallback; }
}
