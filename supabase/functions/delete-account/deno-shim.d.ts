declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }

  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  type SupabaseResult<T> = Promise<{
    data: T;
    error: { message: string } | null;
  }>;

  type SupabaseClient = {
    auth: {
      getUser(): Promise<{
        data: { user: { id: string } | null };
        error: { message: string } | null;
      }>;
      admin: {
        deleteUser(userId: string): Promise<{ error: { message: string } | null }>;
      };
    };
    rpc<T = unknown>(
      name: string,
      params?: Record<string, unknown>,
    ): SupabaseResult<T>;
    storage: {
      from(bucket: string): {
        remove(paths: string[]): Promise<{ error: { message: string } | null }>;
      };
    };
  };

  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>,
  ): SupabaseClient;
}
