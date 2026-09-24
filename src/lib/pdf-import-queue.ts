export type PdfImportResult = { status: "imported" | "skipped"; warning?: string };
export type PdfImportJob = { id: number; file: File; status: "pending" | "imported" | "skipped" | "failed" | "cancelled"; message?: string; retryable?: boolean };

export function pdfImportJobs(files: File[]): PdfImportJob[] {
  return files.map((file, id) => ({ id, file, status: "pending" }));
}

export async function runPdfImportJob(file: File, importer: (file: File) => Promise<PdfImportResult>): Promise<PdfImportResult> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) throw new Error("pdf-import-invalid-type");
  if (!file.size) throw new Error("pdf-import-empty");
  if (file.size > 50 * 1024 * 1024) throw new Error("pdf-import-too-large");
  return importer(file);
}

export function finishPdfImportJob(jobs: PdfImportJob[], id: number, result: PdfImportResult | { status: "failed"; message: string; fatal: boolean }): PdfImportJob[] {
  return jobs.map((job) => {
    if (job.id === id) return result.status === "failed"
      ? { ...job, status: "failed", message: result.message, retryable: !result.fatal }
      : { ...job, status: result.status, message: result.warning };
    if (result.status === "failed" && result.fatal && job.status === "pending") return { ...job, status: "cancelled" };
    return job;
  });
}

export function retryPdfImportJobs(jobs: PdfImportJob[]): PdfImportJob[] {
  return jobs.map((job) => job.status === "failed" && job.retryable ? { ...job, status: "pending", message: undefined } : job);
}

export function isFatalPdfImportError(error: unknown) {
  return error instanceof Error && /workspace-save-conflict|workspace-reload-required|workspace-write-forbidden|Workspace changed|pdf-import-read-only/.test(error.message);
}
