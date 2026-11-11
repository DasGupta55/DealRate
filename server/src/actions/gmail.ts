// Gmail reply tracking — connection management.
//
// Sending already works through the creator's session token
// (gmail.send, granted on demand). Reading replies needs more:
// the gmail.readonly scope AND a stored refresh token, because the
// scheduled sync runs in the background when the creator is not
// using the app. The refresh token is encrypted with AES-256-GCM
// (key = Netlify env var TOKEN_ENCRYPTION_KEY) before it is stored,
// and it is never sent to the client or logged. The creator grants
// it from the app ("Enable reply tracking"), which re-runs Google
// sign-in with gmail.readonly + offline access; the client then
// passes the session's provider_refresh_token here once, and the
// server stores only the encrypted form.
//
// A revoked/expired token marks the stored row invalid (the sync
// stops for that creator and the app shows a reconnect warning);
// previously synced messages are never deleted.

import { z } from "zod";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import { decryptToken, encryptToken } from "../lib/crypto";
import {
  getGoogleUserinfoEmail,
  isGmailAuthError,
  refreshGoogleAccessToken,
} from "../lib/gmail";
import { runGmailSync } from "../lib/gmailSync";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
} from "../lib/db";
import { userIdArg } from "./common";

export const saveGmailTokenSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  refreshToken: z.string().min(1),
  scopes: z.string().optional(),
});

export async function saveGmailToken(
  ctx: ActionCtx,
  args: z.infer<typeof saveGmailTokenSchema>,
): Promise<{ ok: true; email: string }> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  if (!ctx.env.tokenEncryptionKey) {
    throw new Error(
      "Reply tracking is not set up on the server yet (TOKEN_ENCRYPTION_KEY is missing).",
    );
  }
  // Verify the refresh token is real before storing it: exchange it
  // once for an access token and confirm the account matches.
  const accessToken = await refreshGoogleAccessToken(
    args.refreshToken,
    ctx.env.googleClientId,
    ctx.env.googleClientSecret,
  );
  const email = await getGoogleUserinfoEmail(accessToken);
  if (email.toLowerCase() !== (verified.email ?? "").toLowerCase()) {
    throw new Error(
      "gmail_mismatch: the Gmail account does not match the signed-in account",
    );
  }
  const encrypted = encryptToken(args.refreshToken, ctx.env.tokenEncryptionKey);
  const { error } = await db.from("gmail_tokens").upsert(
    {
      owner_id: args.userId,
      email,
      encrypted_refresh_token: encrypted,
      scopes: args.scopes ?? "gmail.readonly",
      invalid: false,
      invalid_reason: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );
  dbThrow(error, "saveGmailToken");
  return { ok: true, email };
}

export const getGmailStatusSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export interface GmailStatusOut {
  connected: boolean;
  email: string | null;
  invalid: boolean;
  invalidReason: string | null;
  lastSyncAt: string | null;
}

export async function getGmailStatus(
  ctx: ActionCtx,
  args: z.infer<typeof getGmailStatusSchema>,
): Promise<GmailStatusOut> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { data, error } = await db
    .from("gmail_tokens")
    .select("email, invalid, invalid_reason, last_sync_at")
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "getGmailStatus");
  const row = (data ?? null) as {
    email: string | null;
    invalid: boolean;
    invalid_reason: string | null;
    last_sync_at: string | null;
  } | null;
  if (!row) {
    return { connected: false, email: null, invalid: false, invalidReason: null, lastSyncAt: null };
  }
  return {
    connected: true,
    email: row.email,
    invalid: row.invalid,
    invalidReason: row.invalid_reason,
    lastSyncAt: row.last_sync_at,
  };
}

export const disconnectGmailSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export async function disconnectGmail(
  ctx: ActionCtx,
  args: z.infer<typeof disconnectGmailSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { error } = await db
    .from("gmail_tokens")
    .delete()
    .eq("owner_id", args.userId);
  dbThrow(error, "disconnectGmail");
  return { ok: true };
}

export const syncGmailNowSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  gmailToken: z.string().optional(),
});

/** Manual sync with the creator's current session token (no stored
 *  refresh token needed). Runs the same reply detection as the
 *  scheduled sync, for this creator only. Used by the "Check for
 *  replies now" button and by testing. */
export async function syncGmailNow(
  ctx: ActionCtx,
  args: z.infer<typeof syncGmailNowSchema>,
): Promise<{ checked: number; newMessages: number; error: string | null }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const token = (args.gmailToken ?? "").trim();
  if (!token) {
    return {
      checked: 0,
      newMessages: 0,
      error: "Sign in with Google first, then tap Check for replies again.",
    };
  }
  // Reuse the shared sync by running it for this one user through a
  // thin wrapper: decrypt is not needed (we already have a live
  // access token), so the per-user sync is done inline here via the
  // same helpers the scheduled sync uses.
  const { runGmailSyncForUser } = await import("../lib/gmailSyncUser");
  try {
    const result = await runGmailSyncForUser(db, ctx.env, args.userId, token);
    return { checked: result.checked, newMessages: result.newMessages, error: result.error };
  } catch (e) {
    if (isGmailAuthError(e)) {
      return {
        checked: 0,
        newMessages: 0,
        error:
          "Gmail permission expired or not granted — allow Gmail reading, then try again.",
      };
    }
    throw e;
  }
}

export const runGmailSyncSchema = z.object({});

export async function runGmailSyncAction(
  ctx: ActionCtx,
  _args: z.infer<typeof runGmailSyncSchema>,
): Promise<{ users: number; totalNew: number }> {
  const db = requireDb(ctx);
  const result = await runGmailSync(db, ctx.env);
  return { users: result.users.length, totalNew: result.totalNew };
}
