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

// Google provider (OAuth) access token of the current Supabase session,
// if the user signed in with Google and granted extra scopes
// (gmail.send). Used for one-click Gmail sending: the token goes to the
// server, which calls the Gmail API with it. Returns null when signed
// out, when the session has no provider token (signed in before the
// Gmail scope was requested), or when the refresh fails — the caller
// then shows the re-sign-in message and the .eml fallback.
export async function getGoogleProviderToken(): Promise<string | null> {
  if (!cachedClient) return null;
  try {
    const { data } = await cachedClient.auth.getSession();
    if (data.session?.provider_token) return data.session.provider_token;
    const { data: refreshed } = await cachedClient.auth.refreshSession();
    return refreshed.session?.provider_token ?? null;
  } catch {
    return null;
  }
}

/** Incremental Gmail permission: re-runs Google sign-in asking for the
 *  gmail.send scope on top of the basic profile scopes. Sign-in itself
 *  never asks for it, so the unverified-app warning never appears at
 *  sign-in — it appears here, only when the creator taps Send and
 *  chooses to allow it. Redirects to Google and back to the app; the
 *  new session's provider_token then carries gmail.send. */
export async function requestGmailSendScope(): Promise<void> {
  if (!cachedClient) return;
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  await cachedClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.send",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
}

/** Gmail reply tracking permission: re-runs Google sign-in asking for
 *  gmail.readonly (read the inbox to find brand replies) on top of
 *  the basic profile scopes and gmail.send. access_type offline +
 *  prompt consent make Google issue a refresh token, which the app
 *  then stores encrypted on the server so the scheduled sync can
 *  check the inbox in the background. The refresh token lives in the
 *  Supabase session (provider_refresh_token); the client reads it
 *  once after sign-in and hands it to the server — it is never shown
 *  in the UI. */
export async function requestGmailReadScope(): Promise<void> {
  if (!cachedClient) return;
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  await cachedClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
}

/** The Google refresh token from the current Supabase session, when
 *  one was issued (only after a sign-in with access_type offline).
 *  Returns null when there is none — the creator has not granted
 *  reply tracking yet. */
export async function getGoogleProviderRefreshToken(): Promise<string | null> {
  if (!cachedClient) return null;
  try {
    const { data } = await cachedClient.auth.getSession();
    if (data.session?.provider_refresh_token) return data.session.provider_refresh_token;
    const { data: refreshed } = await cachedClient.auth.refreshSession();
    return refreshed.session?.provider_refresh_token ?? null;
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
