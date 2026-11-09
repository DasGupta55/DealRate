// Auth / access model — ported from the source, with the standalone gaps
// closed (spec §5.5):
//  - No "owner setup mode" pass-through: when SUPABASE_URL /
//    SUPABASE_ANON_KEY are unset, or the token is missing/invalid, or the
//    token's subject is not the claimed userId, or the sign-in provider is
//    not Google, verification FAILS CLOSED (returns null).
//  - Google-only sign-in: an email-and-password account is rejected even
//    when it is a real account on this project.
//  - Per-user isolation is `owner_id` filtering in every query; NULL-owner
//    rows are never auto-claimed.

import { forbidden, unauthorized, type HttpError } from "./errors";
import type { Env } from "./env";
import {
  PRO_PRICING_INR,
  todayKolkata,
  type ProBilling,
} from "./pricing";
import {
  dbThrow,
  getSettings,
  requireDb,
  type ActionCtx,
  type Db,
  type ProPaymentRow,
} from "./db";

export const OWNER_EMAIL_SERVER = "iampartha160920@gmail.com";

export interface VerifiedUser {
  id: string;
  email: string | null;
}

export const isGuestId = (id: string): boolean => id.startsWith("guest-");
export const isDemoId = (id: string): boolean => id.startsWith("demo-");
export const isPublicId = (id: string): boolean =>
  isGuestId(id) || isDemoId(id);

/**
 * Validate a Supabase access token against the project's Auth API and
 * confirm its subject is exactly the claimed userId. Returns null on any
 * failure (fail closed) — env unset, token missing, non-OK response,
 * subject mismatch, or a non-Google provider.
 */
export async function verifyUserToken(
  env: Env,
  userId: string,
  accessToken?: string,
): Promise<VerifiedUser | null> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  if (!accessToken) return null;
  const base = env.supabaseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: unknown;
      email?: unknown;
      app_metadata?: { provider?: unknown; providers?: unknown };
    };
    if (typeof u?.id !== "string" || u.id !== userId) return null;
    const meta = u.app_metadata ?? {};
    const isGoogle =
      meta.provider === "google" ||
      (Array.isArray(meta.providers) && meta.providers.includes("google"));
    if (!isGoogle) return null;
    const email = typeof u.email === "string" ? u.email : null;
    return { id: userId, email };
  } catch {
    return null;
  }
}

/** Throw a 401 when the caller's session cannot be verified. */
export async function requireVerifiedUser(
  ctx: ActionCtx,
  userId: string,
  accessToken?: string,
): Promise<VerifiedUser> {
  const verified = await verifyUserToken(
    ctx.env,
    userId,
    accessToken ?? ctx.accessToken,
  );
  if (!verified) throw unauthorized();
  return verified;
}

/**
 * Validate a Supabase access token without a claimed user id: returns the
 * token's own subject + email (Google provider only), or null. Used by
 * actions the client calls without sending a userId (updateSettings) so
 * the caller is still resolved from the verified token, never trusted
 * from the request body.
 */
export async function verifyToken(
  env: Env,
  accessToken?: string,
): Promise<VerifiedUser | null> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return null;
  if (!accessToken) return null;
  const base = env.supabaseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: unknown;
      email?: unknown;
      app_metadata?: { provider?: unknown; providers?: unknown };
    };
    if (typeof u?.id !== "string") return null;
    const meta = u.app_metadata ?? {};
    const isGoogle =
      meta.provider === "google" ||
      (Array.isArray(meta.providers) && meta.providers.includes("google"));
    if (!isGoogle) return null;
    const email = typeof u.email === "string" ? u.email : null;
    return { id: u.id, email };
  } catch {
    return null;
  }
}

export interface ProStatus {
  billing: ProBilling;
  startsAt: Date | null;
  expiresAt: Date;
  daysLeft: number;
  cancelled: boolean;
}

/**
 * A user's own Pro subscription, from their verified Razorpay payments:
 * the latest expiry across their verified pro_payments rows. Null when
 * they have never paid (or it has lapsed). A cancelled subscription still
 * counts until expiry — there is no auto-renew anywhere.
 */
export async function userProStatus(
  db: Db,
  userId: string,
): Promise<ProStatus | null> {
  const { data, error } = await db
    .from("pro_payments")
    .select("*")
    .eq("owner_id", userId)
    .eq("status", "verified");
  dbThrow(error, "userProStatus");
  const rows = (data ?? []) as ProPaymentRow[];
  let best: {
    billing: ProBilling;
    startsAt: Date | null;
    expiresAt: Date;
    cancelled: boolean;
  } | null = null;
  for (const r of rows) {
    if (!r.pro_expires_at) continue;
    const expiresAt = new Date(r.pro_expires_at);
    if (!best || expiresAt.getTime() > best.expiresAt.getTime()) {
      best = {
        billing: (r.billing === "annual" ? "annual" : "monthly") as ProBilling,
        startsAt: r.pro_starts_at
          ? new Date(r.pro_starts_at)
          : r.verified_at
            ? new Date(r.verified_at)
            : null,
        expiresAt,
        cancelled: !!r.cancelled_at,
      };
    }
  }
  if (!best) return null;
  const msLeft = best.expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return null;
  return { ...best, daysLeft: Math.ceil(msLeft / 86400000) };
}

/**
 * Pro gate: Brand Finder, deal management and invoicing require an ACTIVE
 * Pro subscription. Passes on the legacy workspace-wide `settings.plan`
 * flag OR the caller's own active Pro. Otherwise throws a 403.
 */
export async function requireProPlan(
  ctx: ActionCtx,
  userId?: string,
): Promise<void> {
  const db = requireDb(ctx);
  const settings = await getSettings(db);
  if (settings?.plan === "pro") return;
  if (userId && (await userProStatus(db, userId))) return;
  throw forbidden(
    "This is a Pro feature — it needs an active Pro plan. Tap Explore Pro on the Plan tab to see what Pro includes.",
  );
}

/** Owner gate: the verified Google email must be the app owner's. */
export function requireOwner(verified: VerifiedUser): void {
  if (!verified.email || verified.email.toLowerCase() !== OWNER_EMAIL_SERVER) {
    throw forbidden("Only the app owner can do this.");
  }
}

/**
 * Marks a Razorpay payment as verified and unlocks Pro for its owner.
 * Idempotent by payment id: an already-processed payment returns the
 * existing expiry and never creates a second invoice or extends Pro
 * twice. Renewing early extends from the current expiry, otherwise
 * from now. Each newly verified payment also saves a paid invoice row,
 * so the payment appears on the user's Invoices tab.
 */
export async function activateProPayment(
  db: Db,
  args: {
    userId: string;
    billing: ProBilling;
    orderId: string;
    paymentId: string;
    amountPaise: number;
  },
): Promise<{ expiresAt: Date; alreadyProcessed: boolean }> {
  const dupRes = await db
    .from("pro_payments")
    .select("*")
    .eq("razorpay_payment_id", args.paymentId)
    .eq("status", "verified")
    .limit(1)
    .maybeSingle();
  dbThrow(dupRes.error, "activateProPayment duplicate check");
  const dupRow = (dupRes.data ?? null) as ProPaymentRow | null;
  if (dupRow?.pro_expires_at) {
    return {
      expiresAt: new Date(dupRow.pro_expires_at),
      alreadyProcessed: true,
    };
  }
  const days = PRO_PRICING_INR[args.billing].days;
  const current = await userProStatus(db, args.userId);
  const base =
    current && current.expiresAt.getTime() > Date.now()
      ? current.expiresAt
      : new Date();
  const expiresAt = new Date(base.getTime() + days * 86400000);
  const nowIso = new Date().toISOString();
  // Prefer updating the pending row created at order time.
  const pendingRes = await db
    .from("pro_payments")
    .select("*")
    .eq("razorpay_order_id", args.orderId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(pendingRes.error, "activateProPayment pending lookup");
  const pending = (pendingRes.data ?? null) as ProPaymentRow | null;
  if (pending) {
    const { error } = await db
      .from("pro_payments")
      .update({
        status: "verified",
        razorpay_payment_id: args.paymentId,
        pro_starts_at: base.toISOString(),
        pro_expires_at: expiresAt.toISOString(),
        verified_at: nowIso,
      })
      .eq("id", pending.id);
    dbThrow(error, "activateProPayment verify update");
  } else {
    const { error } = await db.from("pro_payments").insert({
      owner_id: args.userId,
      billing: args.billing,
      amount_paise: args.amountPaise,
      currency: "INR",
      razorpay_order_id: args.orderId,
      razorpay_payment_id: args.paymentId,
      status: "verified",
      pro_starts_at: base.toISOString(),
      pro_expires_at: expiresAt.toISOString(),
      verified_at: nowIso,
    });
    dbThrow(error, "activateProPayment verify insert");
  }
  const today = todayKolkata();
  const countRes = await db
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", args.userId);
  dbThrow(countRes.error, "activateProPayment invoice count");
  const num = `INV-${today.slice(0, 4)}-${String((countRes.count ?? 0) + 1).padStart(3, "0")}`;
  const { error: invError } = await db.from("invoices").insert({
    owner_id: args.userId,
    deal_id: null,
    brand_name: "DealRate — Pro",
    brand_email: null,
    invoice_number: num,
    amount: args.amountPaise / 100,
    currency: "INR",
    description: `Pro subscription — ${args.billing === "monthly" ? "Monthly (30 days)" : "Annual (365 days)"} · Razorpay payment ${args.paymentId}`,
    issue_date: today,
    due_date: today,
    status: "paid",
  });
  dbThrow(invError, "activateProPayment invoice insert");
  return { expiresAt, alreadyProcessed: false };
}

/**
 * The sender address for a user's mail comes ONLY from their verified
 * Google sign-in session. The daily overdue check has no live session, so
 * it reuses the from-address of the owner's most recent saved draft —
 * itself written only under a verified sign-in. Null when the owner never
 * saved a draft while signed in.
 */
export async function lastSessionSender(
  db: Db,
  userId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("reminders")
    .select("*")
    .eq("owner_id", userId)
    .order("id", { ascending: false })
    .limit(20);
  dbThrow(error, "lastSessionSender");
  const rows = (data ?? []) as { from_email: string | null }[];
  const hit = rows.find((r) => r.from_email);
  return hit?.from_email ?? null;
}

// Re-exported so callers can use the source's exact type without importing
// the errors module directly.
export type { HttpError };
