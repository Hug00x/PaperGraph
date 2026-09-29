"use client";
import { useEffect, useMemo, useState } from "react";
import { AnnotatedPdfViewer } from "@/components/annotated-pdf-viewer";
import { ArticleViewerPane } from "@/components/article-viewer-pane";
import type { WorkspaceImageAsset } from "@/lib/workspace-data";

function makePdf(replacement: boolean) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    "",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Rotate 90 /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const index of [3, 5]) {
    const stream = `BT /F1 18 Tf 50 720 Td (${replacement ? "Replacement document" : "Scientific research highlights"}) Tj 0 -30 Td (Second line of selectable PDF text.) Tj ET`;
    objects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10,"0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(pdf).buffer;
}

export default function Fixture() {
  const [readonly, setReadonly] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [imported, setImported] = useState(false);
  const buffer = useMemo(() => makePdf(replacement), [replacement]);
  if (imported) return <ImportedPdfFixture />;
  return <main className="papergraph-app flex h-screen flex-col p-4">
    <div className="flex gap-4"><button id="readonly" onClick={() => setReadonly((v) => !v)}>Read only</button><button id="replace" onClick={() => setReplacement((v) => !v)}>Replace PDF</button><button id="imported" onClick={() => setImported(true)}>Imported PDF</button></div>
    <AnnotatedPdfViewer buffer={buffer} articleId="highlight-test" canEdit={!readonly} language="en" />
  </main>;
}

function ImportedPdfFixture() {
  const [ready, setReady] = useState(false);
  const [polls, setPolls] = useState(0);
  const [requests, setRequests] = useState(0);
  const [replacement, setReplacement] = useState(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/images/import-fixture")) {
        setRequests((value) => value + 1);
        return new Response(makePdf(url.includes("replacement")), { headers: { "Content-Type": "application/pdf" } });
      }
      return originalFetch(input, init);
    };
    const mounted = setTimeout(() => setReady(true), 0);
    const timer = setInterval(() => setPolls((value) => value + 1), 5000);
    return () => { window.fetch = originalFetch; clearInterval(timer); clearTimeout(mounted); };
  }, []);
  const assets = useMemo<WorkspaceImageAsset[]>(() => {
    const items = [{ id: "fixture-asset", articleId: "import-fixture", originalName: "paper.pdf", storedName: "import-fixture.pdf", storagePath: replacement ? "import-fixture-replacement.pdf" : "import-fixture.pdf", mimeType: "application/pdf", size: 100, uploadedAt: "2026-09-29" },
      { id: "other-asset", articleId: "import-fixture", originalName: "image.png", storedName: "image.png", mimeType: "image/png", size: 100, uploadedAt: "2026-09-29" }];
    return polls % 2 ? items.reverse() : items;
  }, [polls, replacement]);
  return <main className="papergraph-app flex h-screen flex-col p-4">
    <output id="import-state">{JSON.stringify({ requests, polls })}</output>
    <button id="replace-import" onClick={() => setReplacement(true)}>Replace imported file</button>
    {ready ? <ArticleViewerPane article={{ id: "import-fixture", title: "Imported paper", author: "Researcher", source: "\\includepdf{import-fixture.pdf}", status: "Published", tags: ["pdf", "imported"], updatedAt: String(polls) }} imageAssets={assets} canAnnotate language="en" /> : null}
  </main>;
}
