import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

function pdf(title, abstract) {
  const escape = (s) => s.replace(/[\\()]/g, "\\$&");
  const content = `BT /F1 18 Tf 60 750 Td (${escape(title)}) Tj /F1 10 Tf 0 -30 Td (Validation Author) Tj 0 -30 Td (Abstract) Tj 0 -20 Td (${escape(abstract)}) Tj 0 -30 Td (1. Introduction) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let output = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return output;
}

export async function testPdfImport({ evaluate, call, profile, user, workspaceId, until }) {
  const files = ["first.pdf", "broken.pdf", "second.pdf", "duplicate.pdf"].map((name) => path.join(profile, name));
  const first = pdf("Sequential PDF Import Validation Alpha", "A study of adaptive tutoring and learner feedback in educational systems.");
  await Promise.all([
    writeFile(files[0], first), writeFile(files[1], "This is not a valid PDF"),
    writeFile(files[2], pdf("Sequential PDF Import Validation Beta", "A study of galaxy dynamics and measurements of gravitational fields.")),
    writeFile(files[3], first),
  ]);
  const before = await user.from("articles").select("id").eq("workspace_id", workspaceId);
  assert.equal(before.error, null);
  const document = await call("DOM.getDocument");
  const input = await call("DOM.querySelector", { nodeId: document.root.nodeId, selector: 'input[type="file"][multiple]' });
  assert.ok(input.nodeId, "Multi-file selector must exist");
  await call("DOM.setFileInputFiles", { nodeId: input.nodeId, files });
  await until(async () => evaluate("document.body.textContent.includes('2 importados · 1 duplicados · 1 falharam')"), "PDF batch complete", 240000);
  const stored = await user.from("articles").select("id,title,abstract,source,embedding_model,embedding_input_hash,authors").eq("workspace_id", workspaceId);
  assert.equal(stored.error, null);
  assert.equal(stored.data.length, before.data.length + 2, "No earlier imports lost and no duplicate inserted");
  const imported = stored.data.filter((row) => row.source.includes("papergraph-pdf-sha256:"));
  assert.equal(imported.length, 2);
  for (const row of imported) {
    assert.ok(row.abstract && row.embedding_input_hash);
    assert.equal(row.embedding_model, "bge-m3");
  }
  assert.notEqual(imported[0].abstract, imported[1].abstract);
  assert.notEqual(imported[0].embedding_input_hash, imported[1].embedding_input_hash);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Repetir ficheiros que falharam')).click()");
  await until(async () => evaluate("document.body.textContent.includes('2 importados · 1 duplicados · 1 falharam')"), "only failed PDF retried");
  assert.equal((await user.from("articles").select("id").eq("workspace_id", workspaceId)).data.length, stored.data.length);
  const evidence = { multiplePdfsImported: true, corruptPdfIsolated: true, duplicateSkipped: true,
    separateAbstractsAndEmbeddings: true, retryDoesNotDuplicateSuccessfulImports: true };
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(profile, "pdf-import.png"), Buffer.from(screenshot.data, "base64"));
  await writeFile(path.join(profile, "pdf-import-result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
