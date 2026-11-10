// Invoices + reminders + the daily overdue check. requestInvoiceReminder
// only saves a draft for the client to download as .eml; sendInvoice and
// sendInvoiceReminder send in one tap through the Gmail API, using the
// creator's own Google access token (gmail.send scope) — never the app
// owner's Gmail.

import { z } from "zod";
import { addDays, todayKolkata } from "../lib/pricing";
import {
  OWNER_EMAIL_SERVER,
  lastSessionSender,
  requireProPlan,
  requireVerifiedUser,
} from "../lib/auth";
import { forbidden } from "../lib/errors";
import {
  getGmailProfileEmail,
  isGmailAuthError,
  sendGmailMessage,
} from "../lib/gmail";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type Db,
  type InvoiceRow,
  type ReminderRow,
} from "../lib/db";
import {
  invoiceStatusEnum,
  userIdArg,
  type PitchDraft,
} from "./common";

export const createInvoiceSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number().optional(),
  brandName: z.string().min(1),
  brandEmail: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  description: z.string().default(""),
  issueDate: z.string().optional(),
  dueInDays: z.number().int().min(0).max(365).default(30),
});

export async function createInvoice(
  ctx: ActionCtx,
  args: z.infer<typeof createInvoiceSchema>,
): Promise<{ id: number; invoiceNumber: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const issue = args.issueDate ?? todayKolkata();
  const countRes = await db
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", args.userId);
  dbThrow(countRes.error, "createInvoice count");
  // Count-based, not a sequence: deleting invoices can reuse a number;
  // Pro invoices from activateProPayment share the same counter.
  const num = `INV-${issue.slice(0, 4)}-${String((countRes.count ?? 0) + 1).padStart(3, "0")}`;
  const { data, error } = await db
    .from("invoices")
    .insert({
      owner_id: args.userId,
      deal_id: args.dealId ?? null,
      brand_name: args.brandName,
      brand_email: args.brandEmail ?? null,
      invoice_number: num,
      amount: args.amount,
      currency: args.currency,
      description: args.description,
      issue_date: issue,
      due_date: addDays(issue, args.dueInDays),
      status: "draft",
    })
    .select("id")
    .single();
  dbThrow(error, "createInvoice insert");
  if (!data) throw new Error("createInvoice: insert returned no rows");
  if (args.dealId) {
    const { error: dealError } = await db
      .from("deals")
      .update({ stage: "invoiced" })
      .eq("id", args.dealId)
      .eq("owner_id", args.userId);
    dbThrow(dealError, "createInvoice deal stage");
  }
  return { id: (data as { id: number }).id, invoiceNumber: num };
}

export const updateInvoiceStatusSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
  status: invoiceStatusEnum,
});

export async function updateInvoiceStatus(
  ctx: ActionCtx,
  args: z.infer<typeof updateInvoiceStatusSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { error } = await db
    .from("invoices")
    .update({ status: args.status })
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "updateInvoiceStatus");
  if (args.status === "paid") {
    const { data, error: readError } = await db
      .from("invoices")
      .select("*")
      .eq("id", args.id)
      .eq("owner_id", args.userId)
      .limit(1)
      .maybeSingle();
    dbThrow(readError, "updateInvoiceStatus read");
    const inv = (data ?? null) as InvoiceRow | null;
    if (inv?.deal_id) {
      const { error: dealError } = await db
        .from("deals")
        .update({ stage: "paid" })
        .eq("id", inv.deal_id)
        .eq("owner_id", args.userId);
      dbThrow(dealError, "updateInvoiceStatus deal stage");
    }
  }
  return { ok: true };
}

export const deleteInvoiceSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
});

export async function deleteInvoice(
  ctx: ActionCtx,
  args: z.infer<typeof deleteInvoiceSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { error } = await db
    .from("invoices")
    .delete()
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "deleteInvoice");
  return { ok: true };
}

export const requestInvoiceReminderSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  invoiceId: z.number(),
});

export async function requestInvoiceReminder(
  ctx: ActionCtx,
  args: z.infer<typeof requestInvoiceReminderSchema>,
): Promise<PitchDraft> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("invoices")
    .select("*")
    .eq("id", args.invoiceId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "requestInvoiceReminder invoice");
  const inv = (data ?? null) as InvoiceRow | null;
  if (!inv) throw new Error("Invoice not found");
  const noDraft = { fromEmail: null, draft: null };
  if (!inv.brand_email) {
    return {
      status: "needs_email",
      message:
        "This invoice has no brand email saved, so a reminder can't be addressed. Add the brand email by recreating the invoice from the deal.",
      ...noDraft,
    };
  }
  const subject = `Payment reminder: invoice ${inv.invoice_number} (${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")})`;
  const body = [
    `Hi ${inv.brand_name} team,`,
    ``,
    `A friendly reminder that invoice ${inv.invoice_number} for ${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")} (${inv.description || "content collaboration"}) was issued on ${inv.issue_date} and was due on ${inv.due_date}. It is currently unpaid.`,
    ``,
    `Could you please process the payment, or let me know if you need the invoice re-sent or any details from my side?`,
    ``,
    `Thank you,`,
    `Looking forward to working together again.`,
  ].join("\n");
  const draftPayload = { toEmail: inv.brand_email, subject, body };
  const gmailEmail = verified.email;
  const { error: insertError } = await db.from("reminders").insert({
    owner_id: args.userId,
    from_email: gmailEmail,
    invoice_id: inv.id,
    kind: "invoice_reminder",
    to_email: inv.brand_email,
    subject,
    body,
    status: "drafted",
  });
  dbThrow(insertError, "requestInvoiceReminder insert");
  return {
    status: gmailEmail ? "drafted" : "draft_no_gmail",
    message: gmailEmail
      ? `Reminder ready to send from your Gmail (${gmailEmail}) — saved as a draft and downloaded as an .eml; open it and send it from your own Gmail. It never goes through the app owner's Gmail.`
      : "Reminder saved as a draft and downloaded as an .eml — open it and send it from your own Gmail. Nothing is ever sent through the app owner's Gmail.",
    fromEmail: gmailEmail,
    draft: draftPayload,
  };
}

export const sendInvoiceReminderSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  invoiceId: z.number(),
  gmailToken: z.string(),
});

/** One-click payment-reminder send: same subject/body as
 *  requestInvoiceReminder, delivered straight from the creator's own
 *  Gmail via the Gmail API. The Google access token is verified against
 *  the signed-in account first; a 401/403 becomes a "sign in again"
 *  status. */
export async function sendInvoiceReminder(
  ctx: ActionCtx,
  args: z.infer<typeof sendInvoiceReminderSchema>,
): Promise<PitchDraft> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("invoices")
    .select("*")
    .eq("id", args.invoiceId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "sendInvoiceReminder invoice");
  const inv = (data ?? null) as InvoiceRow | null;
  if (!inv) throw new Error("Invoice not found");
  const noDraft = { fromEmail: null, draft: null };
  if (!inv.brand_email) {
    return {
      status: "needs_email",
      message:
        "This invoice has no brand email saved, so a reminder can't be addressed. Add the brand email by recreating the invoice from the deal.",
      ...noDraft,
    };
  }
  const subject = `Payment reminder: invoice ${inv.invoice_number} (${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")})`;
  const body = [
    `Hi ${inv.brand_name} team,`,
    ``,
    `A friendly reminder that invoice ${inv.invoice_number} for ${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")} (${inv.description || "content collaboration"}) was issued on ${inv.issue_date} and was due on ${inv.due_date}. It is currently unpaid.`,
    ``,
    `Could you please process the payment, or let me know if you need the invoice re-sent or any details from my side?`,
    ``,
    `Thank you,`,
    `Looking forward to working together again.`,
  ].join("\n");
  if (!args.gmailToken.trim()) {
    return {
      status: "gmail_not_connected",
      message:
        "Sign out and sign in again with Google to connect Gmail for one-click sending.",
      ...noDraft,
    };
  }
  let gmailEmail: string;
  try {
    gmailEmail = await getGmailProfileEmail(args.gmailToken);
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        status: "gmail_auth_failed",
        message:
          "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.",
        fromEmail: verified.email,
        draft: null,
      };
    }
    throw err;
  }
  if (gmailEmail.toLowerCase() !== (verified.email ?? "").toLowerCase()) {
    throw new Error(
      "gmail_mismatch: the Gmail token does not match the signed-in account",
    );
  }
  try {
    await sendGmailMessage(args.gmailToken, {
      to: inv.brand_email,
      subject,
      body,
    });
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        status: "gmail_auth_failed",
        message:
          "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.",
        fromEmail: verified.email,
        draft: null,
      };
    }
    throw err;
  }
  const { error: insertError } = await db.from("reminders").insert({
    owner_id: args.userId,
    from_email: verified.email,
    invoice_id: inv.id,
    kind: "invoice_reminder",
    to_email: inv.brand_email,
    subject,
    body,
    status: "sent",
  });
  dbThrow(insertError, "sendInvoiceReminder insert");
  return {
    status: "sent",
    message: `Payment reminder sent from your Gmail (${verified.email}) to ${inv.brand_email}.`,
    fromEmail: verified.email,
    draft: null,
  };
}

export const sendInvoiceSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  invoiceId: z.number(),
  gmailToken: z.string(),
});

/** One-click invoice send: emails the invoice itself straight from the
 *  creator's own Gmail via the Gmail API, then marks the invoice sent.
 *  Body mirrors the invoice download (same lines as the invoiceText
 *  helper) plus a closing line asking for payment by the due date. */
export async function sendInvoice(
  ctx: ActionCtx,
  args: z.infer<typeof sendInvoiceSchema>,
): Promise<PitchDraft> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("invoices")
    .select("*")
    .eq("id", args.invoiceId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "sendInvoice invoice");
  const inv = (data ?? null) as InvoiceRow | null;
  if (!inv) throw new Error("Invoice not found");
  const noDraft = { fromEmail: null, draft: null };
  if (!inv.brand_email) {
    return {
      status: "needs_email",
      message:
        "This invoice has no brand email saved, so it can't be sent. Add the brand email by recreating the invoice from the deal.",
      ...noDraft,
    };
  }
  const amount = Math.round(inv.amount).toLocaleString("en-US");
  const subject = `Invoice ${inv.invoice_number} — ${inv.currency} ${amount} for ${inv.description || "content collaboration"}`;
  const body = [
    `INVOICE ${inv.invoice_number}`,
    verified.email ? `From: ${verified.email}` : null,
    `Billed to: ${inv.brand_name}${inv.brand_email ? ` <${inv.brand_email}>` : ""}`,
    `Amount: ${inv.currency} ${amount}`,
    `Issued: ${inv.issue_date}`,
    `Due: ${inv.due_date}`,
    `Status: ${inv.status}`,
    inv.description ? `For: ${inv.description}` : null,
    ``,
    `Please process the payment by ${inv.due_date}. If anything is blocking it, just reply and I'll help.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
  if (!args.gmailToken.trim()) {
    return {
      status: "gmail_not_connected",
      message:
        "Sign out and sign in again with Google to connect Gmail for one-click sending.",
      ...noDraft,
    };
  }
  let gmailEmail: string;
  try {
    gmailEmail = await getGmailProfileEmail(args.gmailToken);
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        status: "gmail_auth_failed",
        message:
          "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.",
        fromEmail: verified.email,
        draft: null,
      };
    }
    throw err;
  }
  if (gmailEmail.toLowerCase() !== (verified.email ?? "").toLowerCase()) {
    throw new Error(
      "gmail_mismatch: the Gmail token does not match the signed-in account",
    );
  }
  try {
    await sendGmailMessage(args.gmailToken, {
      to: inv.brand_email,
      subject,
      body,
    });
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        status: "gmail_auth_failed",
        message:
          "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.",
        fromEmail: verified.email,
        draft: null,
      };
    }
    throw err;
  }
  const { error: updateError } = await db
    .from("invoices")
    .update({ status: "sent" })
    .eq("id", args.invoiceId)
    .eq("owner_id", args.userId);
  dbThrow(updateError, "sendInvoice update");
  const { error: insertError } = await db.from("reminders").insert({
    owner_id: args.userId,
    from_email: verified.email,
    invoice_id: inv.id,
    kind: "invoice",
    to_email: inv.brand_email,
    subject,
    body,
    status: "sent",
  });
  dbThrow(insertError, "sendInvoice insert");
  return {
    status: "sent",
    message: `Invoice ${inv.invoice_number} sent from your Gmail (${verified.email}) to ${inv.brand_email}.`,
    fromEmail: verified.email,
    draft: null,
  };
}

// ---------- Daily overdue check (shared by the API action + the cron) ----------

export interface OverdueCheckOut {
  checked: number;
  overdue: number;
  remindersQueued: number;
}

/**
 * Flag unpaid past-due invoices `overdue` and save one reminder draft per
 * invoice (max 1 per 7 days). Only `sent`/`overdue` invoices are
 * considered; `draft` and `paid` never are. The "30 days" is not computed
 * here — it comes from createInvoice's default dueInDays: 30. Nothing is
 * sent; drafts only. `onlyUser` scopes to one user; null checks everyone
 * (the scheduled run).
 */
export async function runOverdueCheck(
  db: Db,
  onlyUser: string | null,
): Promise<OverdueCheckOut> {
  const today = todayKolkata();
  const { data, error } = await db
    .from("invoices")
    .select("*")
    .in("status", ["sent", "overdue"]);
  dbThrow(error, "checkOverdueInvoices load");
  const allRows = (data ?? []) as InvoiceRow[];
  const rows = onlyUser
    ? allRows.filter((r) => r.owner_id === onlyUser)
    : allRows;
  const overdueRows = rows.filter((r) => r.due_date < today);
  let queued = 0;
  for (const inv of overdueRows) {
    if (inv.status !== "overdue") {
      const { error: updateError } = await db
        .from("invoices")
        .update({ status: "overdue" })
        .eq("id", inv.id);
      dbThrow(updateError, "checkOverdueInvoices flag");
    }
    if (!inv.brand_email || !inv.owner_id) continue;
    const { data: recentData, error: recentError } = await db
      .from("reminders")
      .select("*")
      .eq("invoice_id", inv.id)
      .eq("kind", "invoice_reminder")
      .order("id", { ascending: false })
      .limit(1);
    dbThrow(recentError, "checkOverdueInvoices recent reminder");
    const last = ((recentData ?? []) as ReminderRow[])[0];
    if (
      last &&
      Date.now() - new Date(last.created_at).getTime() < 7 * 86400000
    ) {
      continue;
    }
    const subject = `Payment reminder: invoice ${inv.invoice_number} is overdue (${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")})`;
    const body = [
      `Hi ${inv.brand_name} team,`,
      ``,
      `Invoice ${inv.invoice_number} for ${inv.currency} ${Math.round(inv.amount).toLocaleString("en-US")} (${inv.description || "content collaboration"}) was issued on ${inv.issue_date} and due on ${inv.due_date}. It is now past due and still unpaid.`,
      ``,
      `Please process the payment at the earliest, or reply if anything is blocking it from your side.`,
      ``,
      `Thank you.`,
    ].join("\n");
    // No live session on the cron path: reuse the from-address of the
    // owner's most recent saved draft (itself written only under a
    // verified sign-in), else null.
    const gmailEmail = await lastSessionSender(db, inv.owner_id);
    const { data: inserted, error: insertError } = await db
      .from("reminders")
      .insert({
        owner_id: inv.owner_id,
        from_email: gmailEmail,
        invoice_id: inv.id,
        kind: "invoice_reminder",
        to_email: inv.brand_email,
        subject,
        body,
        status: "drafted",
      })
      .select("id")
      .single();
    dbThrow(insertError, "checkOverdueInvoices reminder insert");
    if (inserted) queued++;
  }
  return {
    checked: rows.length,
    overdue: overdueRows.length,
    remindersQueued: queued,
  };
}

export const checkOverdueInvoicesSchema = z.object({
  userId: z.string().optional(),
  accessToken: z.string().optional(),
});

/**
 * API action form of the check. Unlike the cron path (CRON_SECRET, checks
 * everyone), the API action is owner-only and scoped to the owner's own
 * user id.
 */
export async function checkOverdueInvoices(
  ctx: ActionCtx,
  args: z.infer<typeof checkOverdueInvoicesSchema>,
): Promise<OverdueCheckOut> {
  const db = requireDb(ctx);
  const userId = args.userId?.trim() ? args.userId.trim() : null;
  if (!userId) {
    throw forbidden(
      "Sign in as the app owner to run the overdue check.",
    );
  }
  const verified = await requireVerifiedUser(ctx, userId, args.accessToken);
  if (
    !verified.email ||
    verified.email.toLowerCase() !== OWNER_EMAIL_SERVER
  ) {
    throw forbidden("Only the app owner can run the overdue check.");
  }
  return runOverdueCheck(db, userId);
}
