// Gmail reply sync — the scheduled background check that finds brand
// replies to pitches sent through DealRate.
//
// How it works, per creator who connected Gmail for reply tracking:
//   1. Decrypt their stored Google refresh token and exchange it for
//      a fresh access token.
//   2. Run the shared per-user sync (lib/gmailSyncUser): for every
//      deal with a pitch already sent, look for replies in the pitch's
//      Gmail thread (or by searching for mail from the brand), save
//      each new reply once, classify it with AI, notify the creator
//      and move the deal stage.
//   3. A revoked/expired token marks the stored token invalid and
//      stops that creator's sync; previously saved messages are never
//      deleted, and the app shows a reconnect warning.
//
// Nothing is ever sent from here, nothing is auto-approved, and the
// agreed price is never changed by the sync — only the creator does
// that, through the approval card.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { decryptToken } from "./crypto";
import { refreshGoogleAccessToken } from "./gmail";
import { runGmailSyncForUser } from "./gmailSyncUser";

interface TokenRow {
  owner_id: string;
  email: string | null;
  encrypted_refresh_token: string;
  invalid: boolean;
}

export interface SyncUserResult {
  ownerId: string;
  email: string | null;
  checked: number;
  newMessages: number;
  error: string | null;
}

export interface SyncResult {
  users: SyncUserResult[];
  totalNew: number;
}

export async function runGmailSync(
  db: SupabaseClient,
  env: Env,
): Promise<SyncResult> {
  const { data: tokenRows, error: tokenError } = await db
    .from("gmail_tokens")
    .select("owner_id, email, encrypted_refresh_token, invalid")
    .eq("invalid", false);
  if (tokenError) throw new Error(`gmail sync: could not list tokens (${tokenError.message})`);
  const tokens = (tokenRows ?? []) as TokenRow[];
  const results: SyncUserResult[] = [];
  let totalNew = 0;

  for (const token of tokens) {
    const result: SyncUserResult = {
      ownerId: token.owner_id,
      email: token.email,
      checked: 0,
      newMessages: 0,
      error: null,
    };
    results.push(result);
    let accessToken: string;
    try {
      if (!env.tokenEncryptionKey) {
        throw new Error("TOKEN_ENCRYPTION_KEY is not set on the server.");
      }
      const refreshToken = decryptToken(
        token.encrypted_refresh_token,
        env.tokenEncryptionKey,
      );
      accessToken = await refreshGoogleAccessToken(
        refreshToken,
        env.googleClientId,
        env.googleClientSecret,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Token refresh failed";
      result.error = msg;
      // A revoked/expired token is not retried forever — mark it
      // invalid so the app can warn the creator to reconnect.
      if (/gmail_401|invalid_grant|revoked|expired/i.test(msg)) {
        await db
          .from("gmail_tokens")
          .update({ invalid: true, invalid_reason: msg, updated_at: new Date().toISOString() })
          .eq("owner_id", token.owner_id);
      }
      continue;
    }

    try {
      const perUser = await runGmailSyncForUser(db, env, token.owner_id, accessToken);
      result.checked = perUser.checked;
      result.newMessages = perUser.newMessages;
      result.error = perUser.error;
      totalNew += perUser.newMessages;
    } catch (e) {
      result.error = e instanceof Error ? e.message : "Sync failed";
    }

    await db
      .from("gmail_tokens")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("owner_id", token.owner_id);
  }

  return { users: results, totalNew };
}
