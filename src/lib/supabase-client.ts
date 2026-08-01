import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }

  return browserClient;
}

export function getSupabaseServerStorageClient(accessToken?: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return null;
  }

  const privateServerKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY;
  const serverKey = accessToken
    ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? privateServerKey
    : privateServerKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!serverKey) {
    return null;
  }

  if (!accessToken && privateServerKey) {
    if (!serviceClient) {
      serviceClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serverKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }

    return serviceClient;
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serverKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}
