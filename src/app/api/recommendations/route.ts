import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DiscoveryError } from "@/lib/academic/openalex-client";
import { articleIdentity, discoveredMetadata } from "@/lib/academic/discovery/identity";
import { openAlexDiscovery } from "@/lib/academic/discovery/openalex-provider";
import { recommendationService } from "@/lib/academic/discovery/service";
import { prepareRecommendedArticle, scientificSeed, seedColumns, workspaceIdentities, type DiscoveryRow } from "@/lib/academic/discovery/repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "session" }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new DiscoveryError("workspace-unavailable");
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "session" }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body.workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.workspaceId) ||
        typeof body.articleId !== "string" || !body.articleId || body.articleId.length > 256) return NextResponse.json({ error: "invalid-request" }, { status: 400 });
    const { data: row, error: seedError } = await supabase.from("articles").select(seedColumns)
      .eq("workspace_id", body.workspaceId).eq("id", body.articleId).maybeSingle();
    if (seedError) throw new DiscoveryError("workspace-unavailable");
    if (!row) return NextResponse.json({ error: "not-found" }, { status: 404 });
    if (body.action === "publication") {
      const metadata = discoveredMetadata(row.source ?? "");
      if (!metadata) return NextResponse.json({ error: "not-found" }, { status: 404 });
      const paper = await openAlexDiscovery.lookup(metadata.externalId, request.signal);
      return NextResponse.json({ paper: paper ?? metadata });
    }
    if (body.action === "prepare-add") {
      const access = await supabase.rpc("can_edit_workspace", { workspace_uuid: body.workspaceId });
      if (access.error || !access.data) return NextResponse.json({ error: "read-only" }, { status: 403 });
      if (typeof body.externalId !== "string" || !/^https:\/\/openalex.org\/W\d+$/.test(body.externalId)) return NextResponse.json({ error: "invalid-request" }, { status: 400 });
      const paper = await openAlexDiscovery.lookup(body.externalId, request.signal);
      if (!paper) throw new DiscoveryError("not-found");
      const existing = await workspaceIdentities(supabase, body.workspaceId);
      // Returns an import payload only. Persistence uses the existing workspace pipeline.
      return NextResponse.json(prepareRecommendedArticle(body.workspaceId, paper, existing));
    }
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(150000)]);
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (value: unknown) => { if (!signal.aborted) controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n")); };
        try {
          emit({ stage: "discovering" });
          console.info("[Recommendations] Seed", { id: row.id });
          const seed = await scientificSeed(row as DiscoveryRow, signal);
          const existing = await workspaceIdentities(supabase, body.workspaceId);
          const result = await recommendationService.recommend({ scope: `${user.id}:${body.workspaceId}:${row.id}`,
            seed, existing: existing.map(articleIdentity), stored: row, signal, refresh: body.refresh === true,
            onStage: (stage) => emit({ stage }) });
          emit({ result });
        } catch (error) {
          if (!signal.aborted) emit({ error: error instanceof DiscoveryError ? error.code : "provider-unavailable" });
        } finally { if (!cancellation.signal.aborted) controller.close(); }
      }, cancel() { cancellation.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DiscoveryError ? error.code : "provider-unavailable" }, { status: 503 });
  }
}
