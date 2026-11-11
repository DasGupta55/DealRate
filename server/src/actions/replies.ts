// Deal conversation, AI reply assistant, one-click approval and
// content submission.
//
// The conversation is the deal's email thread: the pitch sent from
// DealRate plus every brand reply the sync saved. The creator reads
// it here, asks AI for a reply draft (which they edit and approve
// before anything is sent), and — when the brand clearly accepts —
// approves the collaboration with one click. After approval the
// creator submits the published content links, and from a submitted
// deal they can create an invoice pre-filled from the agreed price.
//
// Nothing here sends mail without the creator tapping Send, nothing
// is auto-approved, and the agreed price is only ever changed by the
// creator (through approval or by editing the deal).

import { z } from "zod";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import {
  getGoogleUserinfoEmail,
  gmailAuthResult,
  isGmailAuthError,
  sendGmailMessage,
} from "../lib/gmail";
import { draftBrandReply } from "../lib/replyAi";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type DealMessageRow,
  type DealRow,
} from "../lib/db";
import { dealStageEnum, userIdArg } from "./common";

async function loadDeal(
  db: ReturnType<typeof requireDb>,
  userId: string,
  dealId: number,
): Promise<DealRow> {
  const { data, error } = await db
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "deal");
  const deal = (data ?? null) as DealRow | null;
  if (!deal) throw new Error("Deal not found");
  return deal;
}

export interface DealMessageOut {
  id: number;
  direction: string;
  fromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  classification: string | null;
  aiSummary: string | null;
  statedPrice: number | null;
  deliverables: string | null;
  conditions: string | null;
}

function toMessageOut(r: DealMessageRow): DealMessageOut {
  return {
    id: r.id,
    direction: r.direction,
    fromEmail: r.from_email,
    toEmail: r.to_email,
    subject: r.subject,
    bodyText: r.body_text,
    receivedAt: r.received_at,
    classification: r.classification,
    aiSummary: r.ai_summary,
    statedPrice: r.stated_price,
    deliverables: r.deliverables,
    conditions: r.conditions,
  };
}

// ---------- Conversation ----------

export const listDealMessagesSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
});

export async function listDealMessages(
  ctx: ActionCtx,
  args: z.infer<typeof listDealMessagesSchema>,
): Promise<{ messages: DealMessageOut[] }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await loadDeal(db, args.userId, args.dealId);
  const { data, error } = await db
    .from("deal_messages")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("deal_id", args.dealId)
    .order("received_at", { ascending: true });
  dbThrow(error, "listDealMessages");
  return { messages: ((data ?? []) as DealMessageRow[]).map(toMessageOut) };
}

// ---------- AI reply assistant ----------

export const generateReplyDraftSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
  instruction: z.string().max(500).optional(),
});

export async function generateReplyDraft(
  ctx: ActionCtx,
  args: z.infer<typeof generateReplyDraftSchema>,
): Promise<{ subject: string; body: string }> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const deal = await loadDeal(db, args.userId, args.dealId);
  const { data, error } = await db
    .from("deal_messages")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("deal_id", args.dealId)
    .order("received_at", { ascending: true });
  dbThrow(error, "generateReplyDraft messages");
  const messages = (data ?? []) as DealMessageRow[];
  const conversation = messages.map((m) => ({
    from: m.direction === "inbound" ? deal.brand_name : "You",
    body: m.body_text ?? "",
  }));
  const profile = verified.name ?? "";
  return await draftBrandReply(ctx.env, {
    creatorName: profile || verified.email || "Creator",
    channelName: null,
    channelUrl: null,
    brandName: deal.brand_name,
    deliverable: deal.deliverable,
    agreedPrice: deal.agreed_price,
    currency: deal.currency,
    conversation,
    instruction: args.instruction ?? null,
  });
}

export const sendDealReplySchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
  gmailToken: z.string().min(1),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

export async function sendDealReply(
  ctx: ActionCtx,
  args: z.infer<typeof sendDealReplySchema>,
): Promise<{ status: string; message: string }> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const deal = await loadDeal(db, args.userId, args.dealId);
  if (!deal.brand_email) {
    return { status: "needs_email", message: "This deal has no brand email saved." };
  }
  let gmailEmail: string;
  try {
    gmailEmail = await getGoogleUserinfoEmail(args.gmailToken);
  } catch (err) {
    if (isGmailAuthError(err)) return gmailAuthResult(err) as { status: string; message: string };
    throw err;
  }
  if (gmailEmail.toLowerCase() !== (verified.email ?? "").toLowerCase()) {
    throw new Error("gmail_mismatch: the Gmail token does not match the signed-in account");
  }
  let sent: { messageId: string; threadId: string | null };
  try {
    sent = await sendGmailMessage(args.gmailToken, {
      to: deal.brand_email,
      subject: args.subject,
      body: args.body,
    });
  } catch (err) {
    if (isGmailAuthError(err)) return gmailAuthResult(err) as { status: string; message: string };
    throw err;
  }
  await db.from("deal_messages").upsert(
    {
      owner_id: args.userId,
      deal_id: deal.id,
      gmail_message_id: sent.messageId,
      gmail_thread_id: sent.threadId ?? deal.pitch_gmail_thread_id,
      direction: "outbound",
      from_email: verified.email,
      to_email: deal.brand_email,
      subject: args.subject,
      body_text: args.body,
      received_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,gmail_message_id" },
  );
  // A reply keeps the conversation in Negotiating when the deal was
  // waiting on the brand, so the stage reflects real back-and-forth.
  if (deal.stage === "reply_received") {
    await db
      .from("deals")
      .update({ stage: "negotiating" })
      .eq("id", deal.id)
      .eq("owner_id", args.userId);
  }
  return { status: "sent", message: `Reply sent to ${deal.brand_email}.` };
}

// ---------- One-click approval ----------

export const approveDealSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
  sourceMessageId: z.number().int().positive().optional(),
  approvedPrice: z.number().positive(),
  currency: z.string().min(1).max(10),
  deliverables: z.string().max(500).optional(),
  conditions: z.string().max(1000).optional(),
});

export async function approveDeal(
  ctx: ActionCtx,
  args: z.infer<typeof approveDealSchema>,
): Promise<{ ok: true; stage: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const deal = await loadDeal(db, args.userId, args.dealId);
  // Only a deal the brand actually replied to (or is negotiating)
  // can be approved this way — a cold prospect cannot be approved
  // by accident.
  if (
    deal.stage !== "reply_received" &&
    deal.stage !== "negotiating" &&
    deal.stage !== "approved"
  ) {
    throw new Error(
      "This deal cannot be approved yet — the brand has not replied. Approve only after the brand accepts the collaboration.",
    );
  }
  const { error: approvalError } = await db.from("deal_approvals").insert({
    owner_id: args.userId,
    deal_id: deal.id,
    source_message_id: args.sourceMessageId ?? null,
    approved_price: args.approvedPrice,
    currency: args.currency,
    deliverables: args.deliverables ?? deal.deliverable,
    conditions: args.conditions ?? null,
  });
  dbThrow(approvalError, "approveDeal approval");
  const { error: updateError } = await db
    .from("deals")
    .update({
      stage: "content_production",
      agreed_price: args.approvedPrice,
      currency: args.currency,
    })
    .eq("id", deal.id)
    .eq("owner_id", args.userId);
  dbThrow(updateError, "approveDeal deal");
  await db.from("notifications").insert({
    owner_id: args.userId,
    deal_id: deal.id,
    type: "deal_approved",
    title: `Deal approved: ${deal.brand_name}`,
    body: `Collaboration approved at ${args.approvedPrice} ${args.currency}. Time to create the content.`,
  });
  return { ok: true, stage: "content_production" };
}

// ---------- Content submission ----------

export const submitContentSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
  contentUrl: z.string().url().max(500),
  platform: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  publishedAt: z.string().max(20).optional(),
});

export async function submitContent(
  ctx: ActionCtx,
  args: z.infer<typeof submitContentSchema>,
): Promise<{ ok: true; stage: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const deal = await loadDeal(db, args.userId, args.dealId);
  if (deal.stage !== "approved" && deal.stage !== "content_production" && deal.stage !== "content_submitted") {
    throw new Error(
      "Content can only be submitted after the collaboration is approved.",
    );
  }
  const { error } = await db.from("content_submissions").insert({
    owner_id: args.userId,
    deal_id: deal.id,
    content_url: args.contentUrl,
    platform: args.platform ?? null,
    notes: args.notes ?? null,
    published_at: args.publishedAt ?? null,
  });
  dbThrow(error, "submitContent");
  await db
    .from("deals")
    .update({ stage: "content_submitted" })
    .eq("id", deal.id)
    .eq("owner_id", args.userId);
  return { ok: true, stage: "content_submitted" };
}

export const listContentSubmissionsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
});

export interface ContentSubmissionOut {
  id: number;
  contentUrl: string;
  platform: string | null;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export async function listContentSubmissions(
  ctx: ActionCtx,
  args: z.infer<typeof listContentSubmissionsSchema>,
): Promise<{ submissions: ContentSubmissionOut[] }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await loadDeal(db, args.userId, args.dealId);
  const { data, error } = await db
    .from("content_submissions")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("deal_id", args.dealId)
    .order("created_at", { ascending: true });
  dbThrow(error, "listContentSubmissions");
  return {
    submissions: ((data ?? []) as {
      id: number;
      content_url: string;
      platform: string | null;
      notes: string | null;
      published_at: string | null;
      created_at: string;
    }[]).map((r) => ({
      id: r.id,
      contentUrl: r.content_url,
      platform: r.platform,
      notes: r.notes,
      publishedAt: r.published_at,
      createdAt: r.created_at,
    })),
  };
}

// ---------- Create invoice from a submitted deal ----------

export const createInvoiceFromDealSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
});

export async function createInvoiceFromDeal(
  ctx: ActionCtx,
  args: z.infer<typeof createInvoiceFromDealSchema>,
): Promise<{ invoiceId: number; invoiceNumber: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const deal = await loadDeal(db, args.userId, args.dealId);
  if (
    deal.stage !== "content_submitted" &&
    deal.stage !== "invoiced" &&
    deal.stage !== "paid"
  ) {
    throw new Error(
      "Submit the content first — an invoice is created from a submitted deal.",
    );
  }
  if (!deal.agreed_price || deal.agreed_price <= 0) {
    throw new Error("This deal has no agreed price saved, so there is nothing to invoice.");
  }
  if (!deal.brand_email) {
    throw new Error("This deal has no brand email saved, so the invoice has no recipient.");
  }
  // Reuse the existing invoice numbering + creation path so the
  // invoice is identical to one made from the Invoices tab.
  const { createInvoice } = await import("./invoices");
  const today = new Date().toISOString().slice(0, 10);
  const { data: subs } = await db
    .from("content_submissions")
    .select("content_url")
    .eq("owner_id", args.userId)
    .eq("deal_id", deal.id)
    .order("created_at", { ascending: true });
  const urls = ((subs ?? []) as { content_url: string }[]).map((s) => s.content_url);
  const description = [
    `${deal.deliverable} — ${deal.brand_name}`,
    urls.length > 0 ? `Content: ${urls.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(". ");
  const created = await createInvoice(ctx, {
    userId: args.userId,
    accessToken: args.accessToken,
    dealId: deal.id,
    brandName: deal.brand_name,
    brandEmail: deal.brand_email,
    amount: deal.agreed_price,
    currency: deal.currency,
    description,
    issueDate: today,
    dueInDays: 30,
  });
  return { invoiceId: created.id, invoiceNumber: created.invoiceNumber };
}

export const updateDealStageSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().int().positive(),
  stage: dealStageEnum,
});

export async function updateDealStage(
  ctx: ActionCtx,
  args: z.infer<typeof updateDealStageSchema>,
): Promise<{ ok: true; stage: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  await loadDeal(db, args.userId, args.dealId);
  const { error } = await db
    .from("deals")
    .update({ stage: args.stage })
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  dbThrow(error, "updateDealStage");
  return { ok: true, stage: args.stage };
}
