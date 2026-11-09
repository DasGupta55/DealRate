// Supabase client loader — uses the @supabase/supabase-js npm package
// (bundled with the app), replacing the CDN ESM dynamic import used in the
// artifact. The anon key is designed to be public; real protection is
// Supabase Row Level Security on the user's project. Never put the
// service_role / secret key here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
let cachedKey = "";
let loadPromise: Promise<SupabaseClient> | null = null;

export async function getSupabaseClient(url: string, anonKey: string): Promise<SupabaseClient> {
  // Build-time env vars win; the passed-in values (OWNER_CONFIG / the saved
  // settings from the Owner screen) are the fallback. The Owner screen still
  // lets the owner paste the legacy anon key, which reaches here via the
  // saved settings when no env var is set.
  const effectiveUrl = import.meta.env.VITE_SUPABASE_URL || url;
  const effectiveKey = import.meta.env.VITE_SUPABASE_ANON_KEY || anonKey;
  const cacheId = `${effectiveUrl}::${effectiveKey}`;
  if (cachedClient && cachedKey === cacheId) return cachedClient;
  if (loadPromise && cachedKey === cacheId) return loadPromise;
  cachedKey = cacheId;
  loadPromise = (async () => {
    const client = createClient(effectiveUrl, effectiveKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: `sb-${effectiveUrl.replace(/https?:\/\//, "").split(".")[0]}-auth`,
      },
    });
    cachedClient = client;
    return client;
  })();
  return loadPromise;
}

// Access token of the current Supabase session, if a client has been created
// and a session exists. Used by the API client (./api) to attach the
// `Authorization: Bearer <token>` header. Returns null when signed out or
// when no client exists yet (e.g. guest browsing before any sign-in attempt).
export async function getCurrentAccessToken(): Promise<string | null> {
  if (!cachedClient) return null;
  try {
    const { data } = await cachedClient.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// No-op now: @supabase/supabase-js is bundled with the app, so there is no
// separate library download to warm up. Kept so existing callers (App.tsx)
// need no change.
export function preloadSupabaseLibrary(): void {
  return;
}

export function resetSupabaseClient() {
  cachedClient = null;
  cachedKey = "";
  loadPromise = null;
}

export const DEFAULT_SUPABASE_URL = "https://athtnktzxtmtaquvpmvl.supabase.co";
