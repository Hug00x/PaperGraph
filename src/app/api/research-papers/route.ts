import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizeResult } from '../../../../electron/research-contract.cjs';
import { openAlexDiscovery } from '@/lib/academic/discovery/openalex-provider';
import { prepareRecommendedArticle, workspaceIdentities } from '@/lib/academic/discovery/repository';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!token || !url || !key) return NextResponse.json({ error: 'session' }, { status: 401 });
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!user || error) return NextResponse.json({ error: 'session' }, { status: 401 });
    if (Number(request.headers.get('content-length')) > 8000) return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    const bodyText = await request.text();
    if (bodyText.length > 8000) return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    const body = JSON.parse(bodyText);
    if (!body || typeof body.workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.workspaceId) || typeof body.articleId !== 'string' || body.articleId.length > 256 || !body.articleId)
      return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    const access = await supabase.rpc('can_edit_workspace', { workspace_uuid: body.workspaceId });
    if (access.error || !access.data) return NextResponse.json({ error: 'read-only' }, { status: 403 });
    const seed = await supabase.from('articles').select('id').eq('workspace_id', body.workspaceId).eq('id', body.articleId).maybeSingle();
    if (seed.error || !seed.data) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const candidate = normalizeResult({ summary: 'Canonical resolution', papers: [body.candidate] }).papers[0];
    if (!candidate) return NextResponse.json({ error: 'invalid-request' }, { status: 400 });
    const paper = await openAlexDiscovery.resolveResearchPaper(candidate, request.signal);
    if (!paper) return NextResponse.json({ error: 'unresolved' }, { status: 404 });
    const existing = await workspaceIdentities(supabase, body.workspaceId);
    // Metadata preparation only. Existing workspace persistence performs the write.
    return NextResponse.json(prepareRecommendedArticle(body.workspaceId, paper, existing));
  } catch { return NextResponse.json({ error: 'provider-unavailable' }, { status: 502 }); }
}
