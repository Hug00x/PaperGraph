import test from "node:test";
import assert from "node:assert/strict";
import { pdfImportJobs, finishPdfImportJob, runPdfImportJob, retryPdfImportJobs, isFatalPdfImportError } from "../src/lib/pdf-import-queue.ts";

const pdf = (name) => new File(["%PDF-1.4 fixture"], name, { type: "application/pdf" });

test("bad files are rejected before extraction/upload and do not reach the importer", async () => {
  let calls = 0;
  const importer = async () => { calls++; return { status: "imported" }; };
  await assert.rejects(runPdfImportJob(new File(["text"], "bad.txt"), importer), /invalid-type/);
  await assert.rejects(runPdfImportJob(new File([], "empty.pdf"), importer), /empty/);
  await assert.rejects(runPdfImportJob({ name: "large.pdf", type: "application/pdf", size: 50 * 1024 * 1024 + 1 }, importer), /too-large/);
  assert.equal(calls, 0);
  assert.deepEqual(await runPdfImportJob(pdf("valid.PDF"), importer), { status: "imported" });
});

test("a failed file leaves other jobs available and retry never repeats successful or duplicate files", async () => {
  let jobs = pdfImportJobs([pdf("one.pdf"), pdf("broken.pdf"), pdf("two.pdf"), pdf("duplicate.pdf")]);
  jobs = finishPdfImportJob(jobs, 0, { status: "imported", warning: "OpenAlex unavailable" });
  jobs = finishPdfImportJob(jobs, 1, { status: "failed", message: "Invalid PDF", fatal: false });
  assert.equal(jobs[2].status, "pending");
  jobs = finishPdfImportJob(jobs, 2, { status: "imported" });
  jobs = finishPdfImportJob(jobs, 3, { status: "skipped" });
  const retried = retryPdfImportJobs(jobs);
  assert.deepEqual(retried.map((j) => j.status), ["imported", "pending", "imported", "skipped"]);
  assert.equal(retried[0].message, "OpenAlex unavailable");
  assert.equal(retried[1].file, jobs[1].file);
});

test("workspace conflicts stop the remaining queue and cannot be blindly retried", () => {
  let jobs = pdfImportJobs([pdf("one.pdf"), pdf("two.pdf"), pdf("three.pdf")]);
  jobs = finishPdfImportJob(jobs, 0, { status: "imported" });
  const conflict = new Error("workspace-save-conflict");
  jobs = finishPdfImportJob(jobs, 1, { status: "failed", message: conflict.message, fatal: isFatalPdfImportError(conflict) });
  assert.deepEqual(jobs.map((j) => j.status), ["imported", "failed", "cancelled"]);
  assert.deepEqual(retryPdfImportJobs(jobs), jobs);
  assert.equal(isFatalPdfImportError(new Error("Invalid PDF structure")), false);
  assert.equal(isFatalPdfImportError(new Error("Workspace changed")), true);
});
