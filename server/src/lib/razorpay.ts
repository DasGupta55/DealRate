// Razorpay — direct REST + HMAC in the API server (the API server IS the
// host side; there is no separate privileged layer in the standalone).
//
// Secrets live only in server environment variables (RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET) and are read here on each
// call. They are never returned, never logged, and never leave the server —
// with one exception: the Key ID is returned by getRazorpayStatus because
// Razorpay Checkout needs it in the browser (it is the public identifier,
// not a secret). Swapping test keys for live keys later means changing
// only the environment variables.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "./env";
import type { ProBilling } from "./pricing";

export type RazorpayMode = "test" | "live" | "not_configured";

export interface RazorpayStatus {
  configured: boolean;
  mode: RazorpayMode;
  /** Public Key ID (Checkout needs it client-side). Null when unconfigured. */
  keyId: string | null;
  webhookConfigured: boolean;
}

export interface RazorpayOrderResult {
  ok: boolean;
  orderId: string | null;
  mode: RazorpayMode;
  reason: "created" | "not_configured" | "provider_error";
}

function readKeys(env: Env): { keyId: string; keySecret: string } | null {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) return null;
  return { keyId: env.razorpayKeyId, keySecret: env.razorpayKeySecret };
}

function keyMode(keyId: string): "test" | "live" {
  return keyId.startsWith("rzp_live_") ? "live" : "test";
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(expectedHex: string, given: string): boolean {
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(given.trim(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getRazorpayStatus(env: Env): RazorpayStatus {
  const keys = readKeys(env);
  const webhookConfigured = !!env.razorpayWebhookSecret;
  if (!keys) {
    return {
      configured: false,
      mode: "not_configured",
      keyId: null,
      webhookConfigured,
    };
  }
  return {
    configured: true,
    mode: keyMode(keys.keyId),
    keyId: keys.keyId,
    webhookConfigured,
  };
}

/** Fetch an order's notes (used by the webhook when the payment payload
 *  carries no buyer notes). Exported for webhook.ts; keys stay server-side. */
export async function fetchRazorpayOrder(
  env: Env,
  orderId: string,
): Promise<{ notes?: Record<string, unknown> } | null> {
  const keys = readKeys(env);
  if (!keys) return null;
  const auth = Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString(
    "base64",
  );
  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as { notes?: Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function createOrder(
  env: Env,
  args: { smallestUnit: number; billing: ProBilling; userId: string },
): Promise<RazorpayOrderResult> {
  const keys = readKeys(env);
  if (!keys) {
    return {
      ok: false,
      orderId: null,
      mode: "not_configured",
      reason: "not_configured",
    };
  }
  const mode = keyMode(keys.keyId);
  try {
    const auth = Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString(
      "base64",
    );
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: args.smallestUnit,
        currency: "INR",
        receipt: `bpt_pro_${args.billing}_${Date.now()}`,
        notes: {
          product: "DealRate — Pro",
          billing: args.billing,
          userId: args.userId,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = (await res.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (!res.ok || !payload || typeof payload.id !== "string") {
      return { ok: false, orderId: null, mode, reason: "provider_error" };
    }
    return { ok: true, orderId: payload.id, mode, reason: "created" };
  } catch {
    return { ok: false, orderId: null, mode, reason: "provider_error" };
  }
}

// Razorpay's checkout signature check: HMAC_SHA256 of
// "<order_id>|<payment_id>" with the Key Secret, compared against the
// signature Checkout returned. Pro unlocks only when this returns
// verified: true.
export function verifyPaymentSignature(
  env: Env,
  args: { orderId: string; paymentId: string; signature: string },
): { verified: boolean; configured: boolean } {
  const keys = readKeys(env);
  if (!keys) return { verified: false, configured: false };
  const expected = hmacHex(keys.keySecret, `${args.orderId}|${args.paymentId}`);
  return { verified: safeEqualHex(expected, args.signature), configured: true };
}

// Webhook signature check: HMAC_SHA256 of the exact raw request body with
// the webhook secret, compared against the X-Razorpay-Signature header.
export function verifyWebhookSignature(
  env: Env,
  args: { rawBody: string; signature: string },
): { verified: boolean; configured: boolean } {
  const secret = env.razorpayWebhookSecret;
  if (!secret) return { verified: false, configured: false };
  const expected = hmacHex(secret, args.rawBody);
  return { verified: safeEqualHex(expected, args.signature), configured: true };
}
