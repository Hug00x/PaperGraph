import type { SupabaseClient } from "@supabase/supabase-js";

type CollaborationStateRow = {
  article_id: string;
  state_base64: string;
  updated_at: string | null;
  workspace_id: string;
};

function assertSupabaseResult(error: { message: string } | null, fallbackMessage: string) {
  if (error) {
    throw new Error(error.message || fallbackMessage);
  }
}

export async function loadArticleCollaborationStateFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  articleId: string,
) {
  const { data, error } = await supabase
    .from("article_collaboration_states")
    .select("workspace_id,article_id,state_base64,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("article_id", articleId)
    .maybeSingle();

  assertSupabaseResult(error, "Could not load article collaboration state.");

  return (data as CollaborationStateRow | null)?.state_base64 ?? null;
}

export async function createArticleCollaborationStateInSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  articleId: string,
  stateBase64: string,
) {
  const { data, error } = await supabase
    .from("article_collaboration_states")
    .insert({
      article_id: articleId,
      state_base64: stateBase64,
      updated_at: new Date().toISOString(),
      workspace_id: workspaceId,
    })
    .select("state_base64")
    .maybeSingle();

  if (!error) {
    return (data as Pick<CollaborationStateRow, "state_base64"> | null)?.state_base64 ?? stateBase64;
  }

  if (!/duplicate key|23505/i.test(error.message)) {
    throw new Error(error.message || "Could not create article collaboration state.");
  }

  const existingState = await loadArticleCollaborationStateFromSupabase(supabase, workspaceId, articleId);

  if (!existingState) {
    throw new Error("Could not create article collaboration state.");
  }

  return existingState;
}

export async function saveArticleCollaborationStateToSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  articleId: string,
  stateBase64: string,
) {
  const { error } = await supabase
    .from("article_collaboration_states")
    .upsert(
      {
        article_id: articleId,
        state_base64: stateBase64,
        updated_at: new Date().toISOString(),
        workspace_id: workspaceId,
      },
      { onConflict: "workspace_id,article_id" },
    );

  assertSupabaseResult(error, "Could not save article collaboration state.");
}

export async function deleteArticleCollaborationStateFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
  articleId: string,
) {
  const { error } = await supabase
    .from("article_collaboration_states")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("article_id", articleId);

  assertSupabaseResult(error, "Could not delete article collaboration state.");
}
