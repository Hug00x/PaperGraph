export const openAlexConfig = { baseUrl: "https://api.openalex.org", timeoutMs: 15000,
  intervalMs: 350, semanticIntervalMs: 1000, attempts: 2, maxWaitMs: 5000 };
export class DiscoveryError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function waitFor(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(0, ms));
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 1500;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(350, delay) : 1500;
}
// One queue shared by discovery and the existing metadata pipeline.
export class OpenAlexClient {
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private nextSemanticAt = 0;
  fetch(url: string, options: { signal?: AbortSignal; semantic?: boolean } = {}) {
    const result = this.queue.then(() => this.request(url, options));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async request(url: string, { signal, semantic = false }: { signal?: AbortSignal; semantic?: boolean }) {
    const target = new URL(url);
    if (target.origin !== openAlexConfig.baseUrl || !target.pathname.startsWith("/works")) throw new DiscoveryError("invalid-request");
    const headers: Record<string, string> = {};
    if (process.env.OPENALEX_API_KEY) headers.Authorization = `Bearer ${process.env.OPENALEX_API_KEY}`;
    for (let attempt = 0; attempt < openAlexConfig.attempts; attempt++) {
      signal?.throwIfAborted();
      const delay = Math.max(this.nextRequestAt, semantic ? this.nextSemanticAt : 0) - Date.now();
      if (delay > openAlexConfig.maxWaitMs) throw new DiscoveryError("rate-limit");
      if (delay > 0) await waitFor(delay, signal);
      this.nextRequestAt = Date.now() + openAlexConfig.intervalMs;
      if (semantic) this.nextSemanticAt = Date.now() + openAlexConfig.semanticIntervalMs;
      let response: Response;
      try {
        response = await fetch(target, { headers, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(openAlexConfig.timeoutMs)]) });
      } catch (error) {
        signal?.throwIfAborted();
        throw new DiscoveryError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network");
      }
      if (response.status === 429 || response.status >= 500) {
        this.nextRequestAt = Date.now() + retryAfterMs(response.headers.get("retry-after"));
        await response.body?.cancel();
        if (attempt + 1 < openAlexConfig.attempts) continue;
        throw new DiscoveryError(response.status === 429 ? "rate-limit" : "provider-unavailable");
      }
      if ([401, 403].includes(response.status)) throw new DiscoveryError("provider-access");
      if (!response.ok && response.status !== 404) {
        console.info("[OpenAlex] Request failed", { status: response.status });
        throw new DiscoveryError("provider-unavailable");
      }
      return response;
    }
    throw new DiscoveryError("provider-unavailable");
  }
}
export const openAlexClient = new OpenAlexClient();
