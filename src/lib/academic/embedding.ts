import { createHash } from "node:crypto";

export function embeddingConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, ""),
    model: process.env.OLLAMA_EMBEDDING_MODEL || "bge-m3",
  };
}

export function paperText(paper: { title: string; abstract?: string | null }) {
  return `${paper.title}\n\n${paper.abstract ?? ""}`;
}

export function textHash(text: string) {
  return createHash("md5").update(text).digest("hex");
}

const batchReuseCache = new Map<string, { vector: number[]; until: number }>();
const reuseLimits = { entries: 512, ttlMs: 24 * 60 * 60 * 1000 };
function reuseKey(text: string) { const config = embeddingConfig(); return `${config.baseUrl}:${config.model}:${textHash(text)}`; }

async function requestEmbeddings(input: string | string[], signal?: AbortSignal): Promise<number[][]> {
  const inputs = Array.isArray(input) ? input : [input];
  if (!inputs.length || inputs.length > 8 || inputs.some((text) => !text.trim())) throw new Error("Invalid embedding batch");
  signal?.throwIfAborted();
  const config = embeddingConfig();
  try {
    const response = await fetch(`${config.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.PAPERGRAPH_MANAGED_EMBEDDINGS === "1"
        ? { Authorization: `Bearer ${process.env.PAPERGRAPH_EMBEDDING_TOKEN}` } : {}) },
      body: JSON.stringify({ model: config.model, input, truncate: false }),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]),
    });
    if (response.status === 503 && process.env.PAPERGRAPH_MANAGED_EMBEDDINGS === "1") {
      throw new Error("Semantic search is being prepared");
    }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const payload = await response.json();
    const vectors: unknown = payload.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== inputs.length || !vectors.every(isValidEmbedding)) {
      throw new Error("Ollama must return a nonzero vector of 1024 finite numbers");
    }
    return vectors as number[][];
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.message === "Semantic search is being prepared") throw error;
    console.error("Embedding service unavailable", { model: config.model, cause: error instanceof Error ? error.message : "Unknown error" });
    throw new Error("Embedding service unavailable", { cause: error });
  }
}

export function isValidEmbedding(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === 1024 && vector.every((value) => typeof value === "number" && Number.isFinite(value)) && vector.some((value) => value !== 0);
}
let embeddingQueue: Promise<unknown> = Promise.resolve();
function queuedEmbeddings(input: string | string[], signal?: AbortSignal) {
  const result = embeddingQueue.then(() => requestEmbeddings(input, signal));
  embeddingQueue = result.catch(() => undefined);
  return result;
}
export async function generateEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
  signal?.throwIfAborted();
  const cached = batchReuseCache.get(reuseKey(text));
  if (cached && cached.until > Date.now()) return [...cached.vector];
  return (await queuedEmbeddings(text, signal))[0];
}
export async function generateEmbeddings(texts: string[], signal?: AbortSignal) {
  const vectors = await queuedEmbeddings(texts, signal);
  texts.forEach((text, index) => {
    const key = reuseKey(text); batchReuseCache.delete(key);
    batchReuseCache.set(key, { vector: vectors[index], until: Date.now() + reuseLimits.ttlMs });
  });
  while (batchReuseCache.size > reuseLimits.entries) batchReuseCache.delete(batchReuseCache.keys().next().value!);
  return vectors;
}
