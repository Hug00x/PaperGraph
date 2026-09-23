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

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error("Cannot embed empty text");
  const config = embeddingConfig();
  try {
    const response = await fetch(`${config.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.PAPERGRAPH_MANAGED_EMBEDDINGS === "1"
        ? { Authorization: `Bearer ${process.env.PAPERGRAPH_EMBEDDING_TOKEN}` } : {}) },
      body: JSON.stringify({ model: config.model, input: text, truncate: false }),
      signal: AbortSignal.timeout(120000),
    });
    if (response.status === 503 && process.env.PAPERGRAPH_MANAGED_EMBEDDINGS === "1") {
      throw new Error("Semantic search is being prepared");
    }
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const payload = await response.json();
    const vector: unknown = payload.embeddings?.[0];
    if (!Array.isArray(vector) || vector.length !== 1024 ||
        !vector.every((value) => typeof value === "number" && Number.isFinite(value)) ||
        !vector.some((value) => value !== 0)) {
      throw new Error("Ollama must return a nonzero vector of 1024 finite numbers");
    }
    return vector;
  } catch (error) {
    if (error instanceof Error && error.message === "Semantic search is being prepared") throw error;
    console.error("Embedding service unavailable", { model: config.model, cause: error instanceof Error ? error.message : "Unknown error" });
    throw new Error("Embedding service unavailable", { cause: error });
  }
}
