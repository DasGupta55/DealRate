// Pro checkout + manual payments + account actions. Amounts are INR only
// and read from the backend config (PRO_PRICING_INR) — nothing the client
// sends can change the price. Pro starts only after a verified payment.

import { z } from "zod";
import { PRO_PRICING_INR, type ProBilling } from "../lib/pricing";
import {
  OWNER_EMAIL_SERVER,
  activateProPayment,
  requireVerifiedUser,
  userProStatus,
} from "../lib/auth";
import { forbidden } from "../lib/errors";
import {
  createOrder,
  getRazorpayStatus,
  verifyPaymentSignature,
  type RazorpayMode,
} from "../lib/razorpay";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type ManualPaymentRow,
  type ProPaymentRow,
} from "../lib/db";
import { billingEnum, userIdArg } from "./common";

export const getProCheckoutInfoSchema = z.object({});

export interface ProCheckoutInfoOut {
  configured: boolean;
  mode: RazorpayMode;
  keyId: string | null;
  webhookConfigured: boolean;
  prices: {
    billing: string;
    amountInr: number;
    wasInr: number;
    smallestUnit: number;
    days: number;
  }[];
}

export async function getProCheckoutInfo(
  ctx: ActionCtx,
  _args: z.infer<typeof getProCheckoutInfoSchema>,
): Promise<ProCheckoutInfoOut> {
  const prices = (Object.keys(PRO_PRICING_INR) as ProBilling[]).map(
    (billing) => ({
      billing,
      amountInr: PRO_PRICING_INR[billing].amountInr,
      wasInr: PRO_PRICING_INR[billing].wasInr,
      smallestUnit: PRO_PRICING_INR[billing].amountInr * 100,
      days: PRO_PRICING_INR[billing].days,
    }),
  );
  // No DB needed; keys are env-var-backed. Never throws for a missing
  // provider — it reports not-configured.
  const status = getRazorpayStatus(ctx.env);
  return {
    configured: status.configured,
    mode: status.mode,
    keyId: status.keyId,
    webhookConfigured: status.webhookConfigured,
    prices,
  };
}

export const createProOrderSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  billing: billingEnum,
});

export interface CreateProOrderOut {
  ok: boolean;
  orderId: string | null;
  keyId: string | null;
  amountPaise: number;
  amountInr: number;
  currency: string;
  billing: string;
  mode: RazorpayMode;
  reason: "created" | "not_configured" | "provider_error" | null;
  message: string;
}

export async function createProOrder(
  ctx: ActionCtx,
  args: z.infer<typeof createProOrderSchema>,
): Promise<CreateProOrderOut> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const cfg = PRO_PRICING_INR[args.billing];
  const amountPaise = cfg.amountInr * 100;
  const base = {
    amountPaise,
    amountInr: cfg.amountInr,
    currency: "INR",
    billing: args.billing,
  };
  try {
    const result = await createOrder(ctx.env, {
      smallestUnit: amountPaise,
      billing: args.billing,
      userId: args.userId,
    });
    if (result.ok && result.orderId) {
      const { error } = await db.from("pro_payments").insert({
        owner_id: args.userId,
        billing: args.billing,
        amount_paise: amountPaise,
        currency: "INR",
        razorpay_order_id: result.orderId,
        status: "pending",
      });
      dbThrow(error, "createProOrder pending insert");
      // The Key ID comes back through the status contract (the
      // create-order contract deliberately carries no key material).
      const keyId = getRazorpayStatus(ctx.env).keyId;
      if (!keyId) {
        return {
          ...base,
          ok: false,
          orderId: null,
          keyId: null,
          mode: result.mode,
          reason: "provider_error",
          message:
            "Checkout couldn't be prepared just now. No charge was made — please try again in a moment.",
        };
      }
      return {
        ...base,
        ok: true,
        orderId: result.orderId,
        keyId,
        mode: result.mode,
        reason: "created",
        message: "Order created.",
      };
    }
    const reason =
      result.reason === "not_configured" ? "not_configured" : "provider_error";
    return {
      ...base,
      ok: false,
      orderId: null,
      keyId: null,
      mode: result.mode,
      reason,
      message:
        reason === "not_configured"
          ? "Pro checkout isn't open yet — the payment keys haven't been added. Use “Notify me when Pro opens” and we'll email you."
          : "The payment couldn't be started just now. No charge was made — please try again in a moment.",
    };
  } catch {
    return {
      ...base,
      ok: false,
      orderId: null,
      keyId: null,
      mode: "not_configured",
      reason: "provider_error",
      message:
        "The payment couldn't be started just now. No charge was made — please try again in a moment.",
    };
  }
}

export const verifyProPaymentSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});

export async function verifyProPayment(
  ctx: ActionCtx,
  args: z.infer<typeof verifyProPaymentSchema>,
): Promise<{
  ok: boolean;
  proExpiresAt: string | null;
  billing: string | null;
  message: string;
}> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const { data, error } = await db
    .from("pro_payments")
    .select("*")
    .eq("razorpay_order_id", args.orderId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "verifyProPayment lookup");
  const row = (data ?? null) as ProPaymentRow | null;
  if (!row) {
    return {
      ok: false,
      proExpiresAt: null,
      billing: null,
      message:
        "We couldn't find that payment order on your account. If money left your account, it will be refunded by Razorpay — Pro was not switched on.",
    };
  }
  let verified = false;
  try {
    verified = verifyPaymentSignature(ctx.env, {
      orderId: args.orderId,
      paymentId: args.paymentId,
      signature: args.signature,
    }).verified;
  } catch {
    verified = false;
  }
  if (!verified) {
    const { error: updateError } = await db
      .from("pro_payments")
      .update({ status: "failed", razorpay_payment_id: args.paymentId })
      .eq("id", row.id);
    dbThrow(updateError, "verifyProPayment failed update");
    return {
      ok: false,
      proExpiresAt: null,
      billing: null,
      message:
        "That payment couldn't be verified, so Pro was not switched on. If money left your account, Razorpay refunds unverified payments automatically.",
    };
  }
  const { expiresAt } = await activateProPayment(db, {
    userId: args.userId,
    billing: row.billing === "annual" ? "annual" : "monthly",
    orderId: args.orderId,
    paymentId: args.paymentId,
    amountPaise: row.amount_paise,
  });
  return {
    ok: true,
    proExpiresAt: expiresAt.toISOString(),
    billing: row.billing,
    message:
      "Payment verified — Pro is on. Your plan and renewal date are on the Account tab, and the payment is saved on your Invoices tab.",
  };
}

export const submitManualPaymentSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  billing: billingEnum,
  txnId: z.string().min(4).max(120),
});

export async function submitManualPayment(
  ctx: ActionCtx,
  args: z.infer<typeof submitManualPaymentSchema>,
): Promise<{ ok: true; status: string }> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const txnId = args.txnId.trim();
  if (!txnId) {
    throw new Error(
      "Enter the Razorpay payment ID or UPI transaction ID from your payment.",
    );
  }
  // One open claim per transaction ID per user: resubmitting the same ID
  // returns the existing pending row instead of stacking duplicates.
  const { data, error } = await db
    .from("manual_payments")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("txn_id", txnId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "submitManualPayment lookup");
  if (!data) {
    const { error: insertError } = await db
      .from("manual_payments")
      .insert({
        owner_id: args.userId,
        username: verified.email ?? args.userId,
        billing: args.billing,
        txn_id: txnId,
        status: "pending",
      });
    dbThrow(insertError, "submitManualPayment insert");
  }
  return { ok: true, status: "pending" };
}

export const listManualPaymentsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export async function listManualPayments(
  ctx: ActionCtx,
  args: z.infer<typeof listManualPaymentsSchema>,
): Promise<{
  payments: {
    id: number;
    username: string;
    ownerId: string | null;
    billing: string;
    txnId: string;
    status: string;
    createdAt: string;
    accountProActive: boolean;
    accountProExpiresAt: string | null;
  }[];
}> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  if (!verified.email || verified.email.toLowerCase() !== OWNER_EMAIL_SERVER) {
    throw forbidden("This admin list is only available to the app owner.");
  }
  const { data, error } = await db
    .from("manual_payments")
    .select("*")
    .order("id", { ascending: false })
    .limit(50);
  dbThrow(error, "listManualPayments");
  const rows = (data ?? []) as ManualPaymentRow[];
  const sorted = [...rows].sort(
    (a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
      b.id - a.id,
  );
  const out = [];
  for (const r of sorted) {
    const pro = r.owner_id ? await userProStatus(db, r.owner_id) : null;
    out.push({
      id: r.id,
      username: r.username,
      ownerId: r.owner_id,
      billing: r.billing,
      txnId: r.txn_id,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      accountProActive: !!pro,
      accountProExpiresAt: pro ? pro.expiresAt.toISOString() : null,
    });
  }
  return { payments: out };
}

export const reviewManualPaymentSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
  decision: z.enum(["approve", "reject"]),
});

export async function reviewManualPayment(
  ctx: ActionCtx,
  args: z.infer<typeof reviewManualPaymentSchema>,
): Promise<{ ok: true; status: string; proExpiresAt: string | null }> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  if (!verified.email || verified.email.toLowerCase() !== OWNER_EMAIL_SERVER) {
    throw forbidden("Only the app owner can review payments.");
  }
  const { data, error } = await db
    .from("manual_payments")
    .select("*")
    .eq("id", args.id)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "reviewManualPayment lookup");
  const sub = (data ?? null) as ManualPaymentRow | null;
  if (!sub) throw new Error("That payment submission no longer exists.");
  if (sub.status !== "pending") {
    return { ok: true, status: sub.status, proExpiresAt: null };
  }
  if (args.decision === "reject") {
    const { error: updateError } = await db
      .from("manual_payments")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", sub.id);
    dbThrow(updateError, "reviewManualPayment reject");
    return { ok: true, status: "rejected", proExpiresAt: null };
  }
  if (!sub.owner_id) {
    throw new Error(
      "This submission has no account attached, so Pro cannot be switched on for it.",
    );
  }
  const billing = (sub.billing === "annual" ? "annual" : "monthly") as ProBilling;
  const { expiresAt } = await activateProPayment(db, {
    userId: sub.owner_id,
    billing,
    orderId: `manual-${sub.id}`,
    paymentId: sub.txn_id,
    amountPaise: PRO_PRICING_INR[billing].amountInr * 100,
  });
  const { error: updateError } = await db
    .from("manual_payments")
    .update({ status: "approved", reviewed_at: new Date().toISOString() })
    .eq("id", sub.id);
  dbThrow(updateError, "reviewManualPayment approve");
  return { ok: true, status: "approved", proExpiresAt: expiresAt.toISOString() };
}

export const cancelProSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export async function cancelPro(
  ctx: ActionCtx,
  args: z.infer<typeof cancelProSchema>,
): Promise<{ ok: true; proExpiresAt: string | null }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  const pro = await userProStatus(db, args.userId);
  if (!pro) return { ok: true, proExpiresAt: null };
  const { error } = await db
    .from("pro_payments")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("owner_id", args.userId)
    .eq("status", "verified");
  dbThrow(error, "cancelPro");
  return { ok: true, proExpiresAt: pro.expiresAt.toISOString() };
}

export const deleteAccountDataSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
});

export async function deleteAccountData(
  ctx: ActionCtx,
  args: z.infer<typeof deleteAccountDataSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  // All 8 user tables, by owner_id. Settings is untouched; the
  // Supabase/Google account itself is not deleted by this action.
  const tables = [
    "profiles",
    "calculations",
    "brands",
    "deals",
    "invoices",
    "reminders",
    "pro_payments",
    "manual_payments",
  ] as const;
  const results = await Promise.all(
    tables.map((table) =>
      db.from(table).delete().eq("owner_id", args.userId),
    ),
  );
  for (let i = 0; i < results.length; i++) {
    dbThrow(results[i]?.error ?? null, `deleteAccountData ${tables[i]}`);
  }
  return { ok: true };
}
