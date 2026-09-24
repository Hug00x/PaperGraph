"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getFriendlyErrorMessage } from "@/lib/friendly-errors";
import { finishPdfImportJob, isFatalPdfImportError, pdfImportJobs, retryPdfImportJobs, runPdfImportJob, type PdfImportJob, type PdfImportResult } from "@/lib/pdf-import-queue";

export function PdfImportControl({ canEdit, language, onImport }: {
  canEdit: boolean; language: "en" | "pt"; onImport: (file: File) => Promise<PdfImportResult>;
}) {
  const [jobs, setJobs] = useState<PdfImportJob[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const importer = useRef(onImport);
  const active = useRef(false);
  const mounted = useRef(true);
  const en = language === "en";
  const pending = jobs.find((job) => job.status === "pending");
  const busy = Boolean(pending);
  useLayoutEffect(() => { importer.current = onImport; }, [onImport]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const next = jobs.find((job) => job.status === "pending");
    if (!next || active.current) return;
    active.current = true;
    // One job per committed render. The next file sees the parent's newly saved
    // workspace, not the stale snapshot from the start of the batch.
    void Promise.resolve().then(() => {
      if (!mounted.current) return null;
      if (!canEdit) throw new Error("pdf-import-read-only");
      return runPdfImportJob(next.file, importer.current);
    }).then((result) => {
      active.current = false;
      if (mounted.current && result) setJobs((current) => finishPdfImportJob(current, next.id, result));
    }).catch((error: unknown) => {
      active.current = false;
      if (mounted.current) setJobs((current) => finishPdfImportJob(current, next.id, {
        status: "failed", message: getFriendlyErrorMessage(error, language, { context: "import" }), fatal: isFatalPdfImportError(error),
      }));
    });
  }, [jobs, canEdit, language]);

  return <>
    <input ref={input} type="file" multiple accept="application/pdf,.pdf" className="hidden" disabled={!canEdit || busy}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (canEdit && !busy && files.length) setJobs(pdfImportJobs(files));
      }} />
    <button type="button" disabled={!canEdit || busy} onClick={() => input.current?.click()}
      className="mt-2 rounded-full border border-[var(--border)] bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
      {pending ? `${en ? "Importing" : "A importar"} ${jobs.indexOf(pending) + 1}/${jobs.length}` : en ? "Import PDFs" : "Importar PDFs"}
    </button>
    {jobs.length > 0 && <div className="mt-2 rounded-[14px] border border-[var(--border)] px-3 py-2 text-xs">
      <p role="status" aria-live="polite">{pending ? pending.file.name : en
        ? `${jobs.filter((j) => j.status === "imported").length} imported · ${jobs.filter((j) => j.status === "skipped").length} duplicates · ${jobs.filter((j) => j.status === "failed").length} failed`
        : `${jobs.filter((j) => j.status === "imported").length} importados · ${jobs.filter((j) => j.status === "skipped").length} duplicados · ${jobs.filter((j) => j.status === "failed").length} falharam`}</p>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {jobs.map((job) => <li key={job.id} className="break-words text-[var(--muted)]">
          {job.file.name} — {({ pending: en ? "Waiting" : "Em fila", imported: en ? "Imported" : "Importado", skipped: en ? "Already in library" : "Já existe na biblioteca", failed: en ? "Failed" : "Falhou", cancelled: en ? "Queue stopped" : "Fila interrompida" })[job.status]}
          {job.message && <p className="mt-1 text-amber-200">{job.message}</p>}
        </li>)}
      </ul>
      {!busy && canEdit && jobs.some((job) => job.status === "failed" && job.retryable) && <button type="button" className="mt-2 underline" onClick={() => setJobs(retryPdfImportJobs)}>
        {en ? "Retry failed files" : "Repetir ficheiros que falharam"}
      </button>}
    </div>}
  </>;
}
