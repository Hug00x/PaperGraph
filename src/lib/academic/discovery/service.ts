import { embeddingConfig, generateEmbeddings, isValidEmbedding, paperText, textHash } from "../embedding.ts";
import { discoveryConfig as config } from "./config.ts";
import { uniqueNewPapers } from "./identity.ts";
import { openAlexDiscovery } from "./openalex-provider.ts";
import { cosineSimilarity, rankRecommendations } from "./ranking.ts";
import type { PaperDiscoveryProvider, RecommendationResult, ScientificIdentity, ScientificPaper } from "./types.ts";

export class ExpiringCache<T> {
  private entries = new Map<string, { value: T; until: number }>();
  constructor(privateLimit: number) { this.limit = privateLimit; }
  private limit: number;
  get(key: string) {
    const found = this.entries.get(key);
    if (!found || found.until <= Date.now()) { this.entries.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, found); return found.value;
  }
  set(key: string, value: T, ttl: number) {
    this.entries.delete(key); this.entries.set(key, { value, until: Date.now() + ttl });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
}
type StoredEmbedding = { embedding?: unknown; embedding_model?: string | null; embedding_input_hash?: string | null };
type Options = { scope: string; seed: ScientificPaper; existing: ScientificIdentity[]; stored?: StoredEmbedding;
  signal?: AbortSignal; refresh?: boolean; onStage?: (stage: "discovering" | "reranking") => void };
export class RecommendationService {
  private results = new ExpiringCache<Omit<RecommendationResult, "cached">>(config.cacheEntries);
  private vectors = new ExpiringCache<number[]>(config.embeddingCacheEntries);
  private provider: PaperDiscoveryProvider;
  private embed: typeof generateEmbeddings;
  constructor(provider: PaperDiscoveryProvider = openAlexDiscovery, embed: typeof generateEmbeddings = generateEmbeddings) {
    this.provider = provider; this.embed = embed;
  }
  async recommend({ scope, seed, existing, stored, signal, refresh, onStage }: Options): Promise<RecommendationResult> {
    const model = embeddingConfig().model;
    const key = textHash(`${scope}:${config.version}:${model}:${JSON.stringify(seed)}`);
    const cached = refresh ? undefined : this.results.get(key);
    const finish = (result: Omit<RecommendationResult, "cached">, wasCached: boolean) => ({ ...result, cached: wasCached,
      papers: uniqueNewPapers(result.papers, [seed, ...existing]).slice(0, config.displayCount) });
    if (cached) return finish(cached, true);
    signal?.throwIfAborted();
    onStage?.("discovering");
    const raw = await this.provider.findRelatedPaperCandidates(seed, signal);
    const candidates = uniqueNewPapers(raw, [seed, ...existing]);
    console.info("[Recommendations] Candidates", { received: raw.length, removed: raw.length - candidates.length });
    let similarities: number[] | undefined;
    if (candidates.length) {
      onStage?.("reranking");
      const localSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(config.rerankTimeoutMs)]);
      try {
        const all = [seed, ...candidates];
        const keys = all.map((paper) => `${scope}:${model}:${textHash(paperText(paper))}`);
        const vectors = keys.map((cacheKey) => this.vectors.get(cacheKey));
        let saved: unknown = stored?.embedding;
        if (typeof saved === "string") { try { saved = JSON.parse(saved); } catch { saved = null; } }
        if (stored?.embedding_model === model && stored.embedding_input_hash === textHash(paperText(seed)) && isValidEmbedding(saved)) vectors[0] = saved;
        const missing = all.map((_, index) => index).filter((index) => !vectors[index]);
        for (let offset = 0; offset < missing.length; offset += config.batchSize) {
          localSignal.throwIfAborted();
          const batch = missing.slice(offset, offset + config.batchSize);
          const embeddings = await this.embed(batch.map((index) => paperText(all[index])), localSignal);
          if (embeddings.length !== batch.length || !embeddings.every(isValidEmbedding)) throw new Error("Invalid batch");
          batch.forEach((index, i) => {
            vectors[index] = embeddings[i]; this.vectors.set(keys[index], embeddings[i], config.embeddingCacheTtlMs);
          });
        }
        similarities = candidates.map((_, index) => cosineSimilarity(vectors[0]!, vectors[index + 1]!));
      } catch {
        signal?.throwIfAborted();
        console.info("[Recommendations] Local reranking unavailable; retaining provider order");
      }
    }
    signal?.throwIfAborted();
    const result = { papers: rankRecommendations(seed, candidates, similarities), reranking: similarities ? "local" as const : "unavailable" as const };
    this.results.set(key, result, similarities ? config.cacheTtlMs : config.fallbackTtlMs);
    return finish(result, false);
  }
}
export const recommendationService = new RecommendationService();
