import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { OllamaManager } from "../electron/ollama-manager.cjs";
import { openAlexDiscovery } from "../src/lib/academic/discovery/openalex-provider.ts";
import { RecommendationService } from "../src/lib/academic/discovery/service.ts";
import { samePaper } from "../src/lib/academic/discovery/identity.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = new OllamaManager({ runtimeDirectory: path.join(root, "build/ollama"), dataDirectory: path.join(root, ".utmp/ollama-clean-test") });
try {
  Object.assign(process.env, await runtime.prepare());
  await runtime.start(); assert.equal(runtime.state.phase, "ready");
  const seed = await openAlexDiscovery.lookup("https://openalex.org/W2626778328");
  assert.ok(seed?.abstract);
  const service = new RecommendationService();
  const result = await service.recommend({ scope: "live-smoke", seed, existing: [], onStage: (stage) => console.log(stage) });
  assert.equal(result.reranking, "local");
  assert.ok(result.papers.length > 0 && result.papers.length <= 10);
  assert.ok(result.papers.every((paper) => !samePaper(seed, paper)));
  const repeat = await service.recommend({ scope: "live-smoke", seed, existing: [result.papers[0]] });
  assert.equal(repeat.cached, true);
  assert.ok(repeat.papers.every((paper) => !samePaper(result.papers[0], paper)));
  const evidence = { seed: seed.externalId, reranking: result.reranking, count: result.papers.length,
    cachedRepeat: repeat.cached, existingFiltered: true, results: result.papers.map((paper) => ({ id: paper.externalId, title: paper.title, score: paper.semanticScore, reasons: paper.reasons })) };
  await writeFile(path.join(root, ".utmp/discovery-live-result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, results: evidence.results.slice(0, 3) }));
} finally { await runtime.stop(); }
