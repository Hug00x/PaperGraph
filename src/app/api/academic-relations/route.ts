import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { refreshAcademicRelations } from "@/lib/academic/papers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return NextResponse.json({ error: "Invalid Supabase session" }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Invalid Supabase session" }, { status: 401 });
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload.workspaceId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.workspaceId) ||
        !Array.isArray(payload.articleIds) || payload.articleIds.length > 1000 ||
        !payload.articleIds.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 256)) {
      return NextResponse.json({ error: "Invalid workspace or article IDs (maximum 1000)" }, { status: 400 });
    }
    const access = await supabase.rpc("can_edit_workspace", { workspace_uuid: payload.workspaceId });
    if (access.error) throw new Error(access.error.message);
    if (!access.data) return NextResponse.json({ error: "Workspace is read-only" }, { status: 403 });
    return NextResponse.json(await refreshAcademicRelations(supabase, payload.workspaceId,
      [...new Set<string>(payload.articleIds)], payload.language === "en" ? "en" : "pt"));
  } catch (error) {
    console.error("Academic relations failed", error);
    return NextResponse.json({ error: "Semantic search unavailable. Check the database migration and server logs." }, { status: 503 });
  }
}
