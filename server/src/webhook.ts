// Razorpay webhook endpoint — POST /api/webhooks/razorpay.
//
// Reads the RAW body via req.text() BEFORE any JSON parsing, requires the
// X-Razorpay-Signature header and RAZORPAY_WEBHOOK_SECRET, and verifies the
// HMAC. FAILS CLOSED: no signature, missing secret, or a bad signature
// returns 401 and Pro never changes. (The source skipped verification when
// rawBody/signature were absent — only tolerable because the action was
// unreachable from the internet inside Muse. Do not reproduce that skip
// on this public route.)
//
// For payment.captured: userId + billing come from payment.entity.notes;
// when absent, the order is fetched via the Razorpay API and its notes are
// the authoritative source. User-ID-only matching: the webhook unlocks Pro
// for the buyer in the order notes only; it never trusts an email, name,
// or any other payload field to pick the account. Duplicate payments are
// ignored by payment id (activateProPayment is idempotent).

import { loadEnv } from "./lib/env";
import { createServiceClient } from "./lib/db";
import { activateProPayment } from "./lib/auth";
import {
  fetchRazorpayOrder,
  verifyWebhookSignature,
} from "./lib/razorpay";
import type { ProBilling } from "./lib/pricing";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRazorpayWebhookRequest(
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const env = loadEnv();
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    if (!rawBody || !signature) {
      return json(
        { error: "Missing webhook signature — event rejected, Pro not changed." },
        401,
      );
    }
    const check = verifyWebhookSignature(env, { rawBody, signature });
    if (!check.configured || !check.verified) {
      return json(
        { error: "Webhook signature check failed — event rejected, Pro not changed." },
        401,
      );
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid webhook payload." }, 400);
    }
    const event = payload.event;
    if (typeof event !== "string" || !event) {
      return json({ error: "Invalid webhook payload." }, 400);
    }
    if (event !== "payment.captured") {
      return json(
        {
          ok: true,
          handled: false,
          message: `Event ${event} ignored — only payment.captured unlocks Pro.`,
        },
        200,
      );
    }
    const payment = (payload.payment ?? {}) as Record<string, unknown>;
    const entity = (payment.entity ?? {}) as Record<string, unknown>;
    const paymentId = entity.id;
    const orderId = entity.order_id;
    const amount = entity.amount;
    if (
      typeof paymentId !== "string" ||
      !paymentId ||
      typeof orderId !== "string" ||
      !orderId ||
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return json(
        { error: "Invalid webhook payload: missing payment id, order id or amount." },
        400,
      );
    }
    const notes = (entity.notes ?? {}) as Record<string, unknown>;
    let userId =
      typeof notes.userId === "string" && notes.userId ? notes.userId : null;
    let billing =
      typeof notes.billing === "string" && notes.billing ? notes.billing : null;
    if (!userId || !billing) {
      // Fall back to the order's notes — the authoritative source.
      const order = await fetchRazorpayOrder(env, orderId);
      const orderNotes = (order?.notes ?? {}) as Record<string, unknown>;
      if (!userId && typeof orderNotes.userId === "string") {
        userId = orderNotes.userId;
      }
      if (!billing && typeof orderNotes.billing === "string") {
        billing = orderNotes.billing;
      }
    }
    if (!userId || (billing !== "monthly" && billing !== "annual")) {
      return json(
        { error: "Webhook payment has no buyer in the order notes." },
        400,
      );
    }
    const db = createServiceClient(env);
    if (!db) {
      return json(
        { error: "The database is not configured yet." },
        500,
      );
    }
    const { alreadyProcessed } = await activateProPayment(db, {
      userId,
      billing: billing as ProBilling,
      orderId,
      paymentId,
      amountPaise: amount,
    });
    return json(
      {
        ok: true,
        handled: true,
        message: alreadyProcessed
          ? "Duplicate event — this payment was already processed, nothing changed."
          : "Pro unlocked from the webhook for the buyer in the order notes.",
      },
      200,
    );
  } catch (e) {
    if (e instanceof Error) {
      return json({ error: e.message || "Something went wrong." }, 500);
    }
    return json({ error: "Something went wrong." }, 500);
  }
}
