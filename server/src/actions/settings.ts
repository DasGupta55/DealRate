// updateSettings — owner-gated (gap §5.5 closed).
//
// In the source this action had NO auth at all (no userId, no token),
// which was only tolerable inside Muse where only the owner could reach
// the artifact. On a public deployment it requires a verified Google
// sign-in whose email is the owner's. The client never sends a userId
// for this action, so the caller is resolved from the verified token
// (never trusted from the request body). The validation rules and the
// insert/update behaviour are otherwise verbatim from the source: on the
// first validation failure it returns { ok: false, error } with no
// partial write.

import { z } from "zod";
import {
  OWNER_EMAIL_SERVER,
  requireVerifiedUser,
  verifyToken,
  type VerifiedUser,
} from "../lib/auth";
import { forbidden, unauthorized } from "../lib/errors";
import {
  dbThrow,
  getSettings,
  requireDb,
  type ActionCtx,
} from "../lib/db";
import { userIdArg } from "./common";

export const updateSettingsSchema = z.object({
  userId: userIdArg.optional(),
  accessToken: z.string().optional(),
  plan: z.enum(["free", "pro"]).optional(),
  paymentMode: z.enum(["manual", "automatic"]).optional(),
  inrRate: z.number().positive().max(1000).optional(),
  supabaseUrl: z.string().optional(),
  supabaseAnonKey: z.string().optional(),
  clearSupabase: z.boolean().optional(),
  payLinkInrMonthly: z.string().optional(),
  payLinkInrAnnual: z.string().optional(),
  payLinkUsdMonthly: z.string().optional(),
  payLinkUsdAnnual: z.string().optional(),
});

export async function updateSettings(
  ctx: ActionCtx,
  args: z.infer<typeof updateSettingsSchema>,
): Promise<{ ok: boolean; error: string | null }> {
  // Auth first (fail closed before touching the database): resolve the
  // caller from the verified token when the client did not send a userId
  // — never trust an id from the request body.
  const token = args.accessToken ?? ctx.accessToken;
  let verified: VerifiedUser;
  if (args.userId) {
    verified = await requireVerifiedUser(ctx, args.userId, token);
  } else {
    const t = await verifyToken(ctx.env, token);
    if (!t) throw unauthorized();
    verified = t;
  }
  if (
    !verified.email ||
    verified.email.toLowerCase() !== OWNER_EMAIL_SERVER
  ) {
    throw forbidden("Only the app owner can update settings.");
  }
  const db = requireDb(ctx);
  // Validation for Supabase fields
  if (args.supabaseUrl !== undefined && args.supabaseUrl.trim() !== "") {
    const u = args.supabaseUrl.trim();
    if (!u.includes("supabase.co") || !u.startsWith("https://")) {
      return {
        ok: false,
        error:
          "That doesn't look like a Supabase project URL. It should look like https://your-project.supabase.co",
      };
    }
  }
  if (args.supabaseAnonKey !== undefined && args.supabaseAnonKey.trim() !== "") {
    const k = args.supabaseAnonKey.trim();
    if (
      k.startsWith("sb_secret_") ||
      k.toLowerCase().includes("service_role")
    ) {
      return {
        ok: false,
        error:
          "Never enter the secret or service_role key. Use the legacy anon public key — it starts with eyJ.",
      };
    }
    if (k.startsWith("sb_publishable_")) {
      return {
        ok: false,
        error:
          "That's the new publishable key (sb_publishable_). This app needs the legacy anon public key — in Supabase go to API Keys → View legacy API keys → anon public. It starts with eyJ.",
      };
    }
    if (!k.startsWith("eyJ")) {
      return {
        ok: false,
        error:
          "That key doesn't start with eyJ. Copy the legacy anon public key from Supabase → Project Settings → API Keys → View legacy API keys → anon public.",
      };
    }
    if (k.length < 100) {
      return {
        ok: false,
        error:
          "That key looks too short. Copy the full legacy anon public key — it's a very long key starting with eyJ.",
      };
    }
  }
  // Payment links are plain URLs the owner pastes in (e.g. a Razorpay or
  // Stripe payment link) — no API key or secret is ever accepted.
  const payLinkArgs = {
    payLinkInrMonthly: args.payLinkInrMonthly,
    payLinkInrAnnual: args.payLinkInrAnnual,
    payLinkUsdMonthly: args.payLinkUsdMonthly,
    payLinkUsdAnnual: args.payLinkUsdAnnual,
  } as const;
  for (const [field, value] of Object.entries(payLinkArgs)) {
    if (
      value !== undefined &&
      value.trim() !== "" &&
      !/^https:\/\//i.test(value.trim())
    ) {
      return {
        ok: false,
        error: `The ${field} payment link must start with https:// — paste the full payment page link.`,
      };
    }
  }
  const existing = await getSettings(db);
  if (!existing) {
    const { error } = await db.from("settings").insert({
      id: 1,
      plan: args.plan ?? "free",
      payment_mode: args.paymentMode ?? "automatic",
      inr_rate: args.inrRate ?? 83.5,
      supabase_url: args.clearSupabase
        ? null
        : args.supabaseUrl?.trim() || null,
      supabase_anon_key: args.clearSupabase
        ? null
        : args.supabaseAnonKey?.trim() || null,
      pay_link_inr_monthly: args.payLinkInrMonthly?.trim() || null,
      pay_link_inr_annual: args.payLinkInrAnnual?.trim() || null,
      pay_link_usd_monthly: args.payLinkUsdMonthly?.trim() || null,
      pay_link_usd_annual: args.payLinkUsdAnnual?.trim() || null,
    });
    dbThrow(error, "updateSettings insert");
  } else {
    const patch: Record<string, unknown> = {};
    if (args.plan !== undefined) patch.plan = args.plan;
    if (args.paymentMode !== undefined) patch.payment_mode = args.paymentMode;
    if (args.inrRate !== undefined) patch.inr_rate = args.inrRate;
    if (args.payLinkInrMonthly !== undefined) {
      patch.pay_link_inr_monthly = args.payLinkInrMonthly.trim() || null;
    }
    if (args.payLinkInrAnnual !== undefined) {
      patch.pay_link_inr_annual = args.payLinkInrAnnual.trim() || null;
    }
    if (args.payLinkUsdMonthly !== undefined) {
      patch.pay_link_usd_monthly = args.payLinkUsdMonthly.trim() || null;
    }
    if (args.payLinkUsdAnnual !== undefined) {
      patch.pay_link_usd_annual = args.payLinkUsdAnnual.trim() || null;
    }
    if (args.clearSupabase) {
      patch.supabase_url = null;
      patch.supabase_anon_key = null;
    } else {
      if (args.supabaseUrl !== undefined) {
        patch.supabase_url = args.supabaseUrl.trim() || null;
      }
      if (
        args.supabaseAnonKey !== undefined &&
        args.supabaseAnonKey.trim() !== ""
      ) {
        patch.supabase_anon_key = args.supabaseAnonKey.trim();
      }
    }
    const { error } = await db
      .from("settings")
      .update(patch)
      .eq("id", 1);
    dbThrow(error, "updateSettings update");
  }
  return { ok: true, error: null };
}
