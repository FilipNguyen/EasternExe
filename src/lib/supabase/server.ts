import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client (service role key). Bypasses RLS.
 * Import only from server components / route handlers / server actions.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local"
    );
  }

  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      // Next.js 14 caches every server-side fetch() by default, including
      // PostgREST calls made by the Supabase SDK. That was serving stale
      // trip/upload rows from the snapshot API even after ingest finished.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
