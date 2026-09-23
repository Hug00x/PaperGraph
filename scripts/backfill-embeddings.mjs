import { createClient } from "@supabase/supabase-js";
import { paperColumns, preparePaper } from "../src/lib/academic/papers.ts";

// A user token respects RLS; an administrator can use a server-only service key.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const key = token ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  : process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const workspaceId = process.argv[2];
if (!url || !key || !workspaceId) {
  console.error("Usage: npm run embeddings:backfill -- <workspace-uuid>. Set Supabase URL and a server key or user access token.");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
});
let after = null;
let processed = 0;
let failed = 0;
while (true) {
  let query = supabase.from("articles").select(paperColumns)
    .eq("workspace_id", workspaceId).order("id").limit(50);
  if (after !== null) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data.length) break;
  for (const paper of data) {
    const result = await preparePaper(supabase, workspaceId, paper);
    processed++;
    if (result.warnings.length) {
      failed++;
      console.warn(paper.id, result.warnings.join(" "));
    }
  }
  after = data.at(-1).id;
  console.log(`Processed ${processed}; warnings ${failed}`);
}
console.log(`Backfill complete: ${processed} checked, ${failed} with warnings. Valid embeddings were reused.`);
process.exitCode = failed ? 1 : 0;
