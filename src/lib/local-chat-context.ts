import { decodeImportedPdfText } from './academic/pdf-metadata.ts';
import { discoveredMetadata } from './academic/discovery/identity.ts';
import type { WorkspaceArticle, WorkspaceImageAsset } from './workspace-data.ts';

export type LocalPaper = { title: string; text: string; coverage: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// Keep opening context plus question-relevant passages, with stable source labels.
export function selectPassages(text: string, question: string, limit: number) {
  if (text.length <= limit) return { text, partial: false };
  const chunks = text.match(/[\s\S]{1,1800}/g) || [];
  const terms = [...new Set(question.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])];
  const ranked = chunks.map((chunk, index) => ({ index, score: terms.reduce((n, term) => n + (chunk.toLocaleLowerCase().includes(term) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const indices = new Set([0, chunks.length - 1]);
  for (const entry of ranked) { if ((indices.size + 1) * 1850 > limit) break; indices.add(entry.index); }
  return { text: [...indices].sort((a, b) => a - b).map(index => `[Excerpt ${index + 1}]\n${chunks[index]}`).join('\n\n').slice(0, limit), partial: true };
}

export async function localPaperContext(article: WorkspaceArticle, assets: WorkspaceImageAsset[], accessToken: string,
  question: string, limit: number, signal: AbortSignal): Promise<LocalPaper> {
  let text = ''; let coverage = '';
  const imported = /\\includepdf/.test(article.source);
  const filename = article.source.match(/\\includepdf(?:\[[\s\S]*?\])?\{papergraph-images\/([^}]+)\}/)?.[1];
  const asset = filename && assets.find(value => value.storedName === filename);
  if (asset) {
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(asset.storedName)}?path=${encodeURIComponent(asset.storagePath || asset.storedName)}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal,
      });
      if (!response.ok) throw new Error('pdf-unavailable');
      const buffer = await response.arrayBuffer(); signal.throwIfAborted();
      if (buffer.byteLength > 50 * 1024 * 1024) throw new Error('pdf-too-large');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
      task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
      const document = await task.promise;
      const pages: string[] = []; let length = 0;
      for (let page = 1; page <= Math.min(document.numPages, 150); page++) {
        signal.throwIfAborted();
        const content = await (await document.getPage(page)).getTextContent();
        const value = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        pages.push(`[Page ${page}]\n${value}`); length += value.length;
        if (length > 300000) break;
      }
      text = pages.join('\n\n');
      coverage = pages.length === document.numPages ? 'PDF text from all pages (figures and images not read)' : `Partial PDF text: first ${pages.length} of ${document.numPages} pages`;
    } catch { signal.throwIfAborted(); /* Use the previously extracted import text when the PDF is unavailable. */ }
    finally { await task?.destroy(); }
  }
  if (!text.trim()) {
    if (imported) {
      text = decodeImportedPdfText(article.source);
      coverage = 'Partial imported PDF text: up to the first three pages; figures not read';
    } else if (discoveredMetadata(article.source)) {
      text = discoveredMetadata(article.source)?.abstract || article.abstract || '';
      coverage = 'Title and abstract only; full paper unavailable';
    } else {
      text = article.source.replace(/^%.*$/gm, '').trim();
      coverage = text ? 'Available LaTeX source; external files and figures not read' : 'Title and abstract only; full paper unavailable';
    }
  }
  const passages = selectPassages([article.abstract ? `Abstract:\n${article.abstract}` : '', text].filter(Boolean).join('\n\n'), question, limit);
  signal.throwIfAborted();
  return { title: article.title.slice(0, 1000), text: passages.text, coverage: coverage + (passages.partial ? '; selected excerpts, not full text' : '') };
}

export function boundedHistory(messages: ChatMessage[]) {
  const kept: ChatMessage[] = []; let length = 0;
  for (let i = messages.length - 2; i >= 0; i -= 2) {
    const pair = messages.slice(i, i + 2); const size = pair.reduce((n, m) => n + m.content.length, 0);
    if (kept.length >= 18 || length + size > 20000) break;
    kept.unshift(...pair); length += size;
  }
  return kept;
}
