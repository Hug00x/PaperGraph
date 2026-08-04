import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const paperGraphAssetBucket = "papergraph-assets";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

type StoragePathRow = {
  storage_path: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
    status,
  });
}

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function getDefaultKeyFromJson(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Record<string, string>;

    return parsedValue.default ?? Object.values(parsedValue).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function getSupabasePublishableKey() {
  return (
    Deno.env.get("PAPERGRAPH_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    getDefaultKeyFromJson(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))
  );
}

function getSupabasePrivateKey() {
  return (
    Deno.env.get("PAPERGRAPH_SERVICE_ROLE_KEY") ??
    Deno.env.get("PAPERGRAPH_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    getDefaultKeyFromJson(Deno.env.get("SUPABASE_SECRET_KEYS"))
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = getSupabasePublishableKey();
    const serviceRoleKey = getSupabasePrivateKey();
    const accessToken = getBearerToken(request);

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "A função delete-account não está configurada." }, 500);
    }

    if (!accessToken) {
      return jsonResponse({ error: "Sessão Supabase inválida." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Sessão Supabase inválida." }, 401);
    }

    const { data: storageRows, error: storageRowsError } = await serviceClient.rpc(
      "list_user_account_deletion_storage_paths",
      {
        target_user_id: user.id,
      },
    );

    if (storageRowsError) {
      throw new Error(storageRowsError.message);
    }

    const storagePaths = [
      ...new Set(
        ((storageRows ?? []) as StoragePathRow[])
          .map((row) => row.storage_path)
          .filter((storagePath): storagePath is string => Boolean(storagePath)),
      ),
    ];

    const { error: cleanupError } = await serviceClient.rpc("delete_user_account_data", {
      target_user_id: user.id,
    });

    if (cleanupError) {
      throw new Error(cleanupError.message);
    }

    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      throw new Error(deleteUserError.message);
    }

    for (let index = 0; index < storagePaths.length; index += 100) {
      const batch = storagePaths.slice(index, index + 100);
      const { error: removeError } = await serviceClient.storage
        .from(paperGraphAssetBucket)
        .remove(batch);

      if (removeError) {
        throw new Error(removeError.message);
      }
    }

    return jsonResponse({ ok: true, storagePaths });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Não foi possível eliminar a conta." },
      500,
    );
  }
});
