// Deals + pitches: pipeline CRUD, AI pitch generation (Groq, template
// fallback), and pitch drafts. Nothing is ever sent by the server —
// requestSendPitch only saves a ready-to-send draft for the client to
// download as .eml and send from the creator's own Gmail.

import { z } from "zod";
import { DELIVERABLE_LABEL } from "../lib/pricing";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import { chatGroqJson } from "../lib/groq";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type CalculationRow,
  type DealRow,
  type ProfileRow,
} from "../lib/db";
import {
  dealStageEnum,
  userIdArg,
  type PitchDraft,
} from "./common";

export const createDealSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  brandName: z.string().min(1),
  brandEmail: z.string().optional(),
  deliverable: z.string().default("dedicated"),
  agreedPrice: z.number().nonnegative().optional(),
  currency: z.string().default("USD"),
  notes: z.string().optional(),
});

export async function createDeal(
  ctx: ActionCtx,
  args: z.infer<typeof createDealSchema>,
): Promise<{ id: number }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("deals")
    .insert({
      owner_id: args.userId,
      brand_name: args.brandName,
      brand_email: args.brandEmail ?? null,
      deliverable: args.deliverable,
      agreed_price: args.agreedPrice ?? null,
      currency: args.currency,
      notes: args.notes ?? null,
      stage: "prospect",
    })
    .select("id")
    .single();
  dbThrow(error, "createDeal insert");
  if (!data) throw new Error("createDeal: insert returned no rows");
  return { id: (data as { id: number }).id };
}

export const updateDealSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
  stage: dealStageEnum.optional(),
  agreedPrice: z.number().nonnegative().nullable().optional(),
  brandEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function updateDeal(
  ctx: ActionCtx,
  args: z.infer<typeof updateDealSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  // Patch only the fields present in the request (each may be explicitly
  // null to clear, except stage).
  const patch: Record<string, unknown> = {};
  if (args.stage !== undefined) patch.stage = args.stage;
  if (args.agreedPrice !== undefined) patch.agreed_price = args.agreedPrice;
  if (args.brandEmail !== undefined) patch.brand_email = args.brandEmail;
  if (args.notes !== undefined) patch.notes = args.notes;
  const { error } = await db
    .from("deals")
    .update(patch)
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "updateDeal");
  return { ok: true };
}

export const deleteDealSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
});

export async function deleteDeal(
  ctx: ActionCtx,
  args: z.infer<typeof deleteDealSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { error } = await db
    .from("deals")
    .delete()
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "deleteDeal");
  return { ok: true };
}

export const generatePitchSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
});

export async function generatePitch(
  ctx: ActionCtx,
  args: z.infer<typeof generatePitchSchema>,
): Promise<{ subject: string; body: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data: dealData, error: dealError } = await db
    .from("deals")
    .select("*")
    .eq("id", args.dealId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(dealError, "generatePitch deal");
  const deal = (dealData ?? null) as DealRow | null;
  if (!deal) throw new Error("Deal not found");

  const { data: profileData, error: profileError } = await db
    .from("profiles")
    .select("*")
    .eq("owner_id", args.userId)
    .in("status", ["done", "manual"])
    .order("id", { ascending: false })
    .limit(1);
  dbThrow(profileError, "generatePitch profile");
  const profile = ((profileData ?? []) as ProfileRow[])[0];

  const { data: calcData, error: calcError } = await db
    .from("calculations")
    .select("*")
    .eq("owner_id", args.userId)
    .order("id", { ascending: false })
    .limit(1);
  dbThrow(calcError, "generatePitch calculation");
  const calc = ((calcData ?? []) as CalculationRow[])[0];

  const channelName = profile?.title ?? profile?.handle ?? "my channel";
  const avgViews = profile?.avg_views ?? calc?.avg_views ?? null;
  const engagement = profile?.engagement_pct ?? calc?.engagement_pct ?? null;
  const subscribers = profile?.subscribers ?? null;
  const price = deal.agreed_price ?? calc?.price_mid ?? null;
  const currency = deal.currency ?? "USD";
  const deliverableLabel =
    DELIVERABLE_LABEL[deal.deliverable] ?? "Dedicated video";
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

  // Template fallback (used if the AI call throws or returns empty).
  let subject = `Partnership idea: ${channelName} x ${deal.brand_name}`;
  let body = [
    `Hi ${deal.brand_name} team,`,
    ``,
    `I run ${channelName}${subscribers ? ` (${fmt(subscribers)} subscribers)` : ""} on YouTube. My recent videos average ${avgViews ? fmt(avgViews) + " views" : "strong viewership"}${engagement ? ` with ${engagement.toFixed(2)}% engagement (likes + comments)` : ""} — a real, active audience, not just reach.`,
    ``,
    `I'd love to create a ${deliverableLabel.toLowerCase()} featuring ${deal.brand_name}. Based on my channel's actual views and engagement, my rate for this deliverable is ${price ? `${currency} ${fmt(price)}` : "available on request"}. I'm happy to share my media kit and past results.`,
    ``,
    `Open to a quick call this week to discuss fit and timelines?`,
    ``,
    `Best regards`,
  ].join("\n");
  try {
    const ai = await chatGroqJson<{ subject: string; body: string }>(
      ctx.env.groqApiKey ?? "",
      "You write short, human-sounding cold pitch emails. Reply with a single JSON object only, no other text.",
      `Write a short, human-sounding cold pitch email (under 160 words) from a YouTube creator to a brand. Facts you must use exactly: channel "${channelName}"${subscribers ? `, ${fmt(subscribers)} subscribers` : ""}${avgViews ? `, average ${fmt(avgViews)} views on the last 10 videos` : ""}${engagement ? `, ${engagement.toFixed(2)}% engagement` : ""}. Brand: ${deal.brand_name}. Deliverable: ${deliverableLabel}. Rate: ${price ? `${currency} ${fmt(price)}` : "not stated — say rate available on request"}. Tone: confident, specific, no hype words, no placeholders.`,
    );
    if (ai.subject && ai.body) {
      subject = ai.subject;
      body = ai.body;
    }
  } catch {
    // Template above is the fallback; it uses the same real numbers.
  }
  const { error } = await db
    .from("deals")
    .update({
      pitch_subject: subject,
      pitch_body: body,
      stage: deal.stage === "prospect" ? "pitch_ready" : deal.stage,
    })
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  dbThrow(error, "generatePitch update");
  return { subject, body };
}

export const savePitchSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export async function savePitch(
  ctx: ActionCtx,
  args: z.infer<typeof savePitchSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { error } = await db
    .from("deals")
    .update({ pitch_subject: args.subject, pitch_body: args.body })
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  dbThrow(error, "savePitch");
  return { ok: true };
}

export const requestSendPitchSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
});

export async function requestSendPitch(
  ctx: ActionCtx,
  args: z.infer<typeof requestSendPitchSchema>,
): Promise<PitchDraft> {
  const db = requireDb(ctx);
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("deals")
    .select("*")
    .eq("id", args.dealId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "requestSendPitch deal");
  const deal = (data ?? null) as DealRow | null;
  if (!deal) throw new Error("Deal not found");
  const noDraft = { fromEmail: null, draft: null };
  if (!deal.pitch_subject || !deal.pitch_body) {
    return {
      status: "needs_pitch",
      message: "Write the pitch first, then send it.",
      ...noDraft,
    };
  }
  if (!deal.brand_email) {
    return {
      status: "needs_email",
      message:
        "Add the brand's email on this deal first — the pitch needs a recipient.",
      ...noDraft,
    };
  }
  // The sender is the Gmail on the user's verified Google sign-in — never
  // an address typed into the app, and never the app owner's Gmail.
  // Direct in-app sending is not wired, so the pitch is saved as a
  // ready-to-send draft and downloaded as an .eml the user sends from
  // their own account.
  const gmailEmail = verified.email;
  const draftPayload = {
    toEmail: deal.brand_email,
    subject: deal.pitch_subject,
    body: deal.pitch_body,
  };
  const { error: insertError } = await db.from("reminders").insert({
    owner_id: args.userId,
    from_email: gmailEmail,
    deal_id: deal.id,
    kind: "pitch",
    to_email: deal.brand_email,
    subject: deal.pitch_subject,
    body: deal.pitch_body,
    status: "drafted",
  });
  dbThrow(insertError, "requestSendPitch insert");
  return {
    status: gmailEmail ? "drafted" : "draft_no_gmail",
    message: gmailEmail
      ? `Ready to send from your Gmail (${gmailEmail}) — the pitch is saved as a draft and downloaded as an .eml; open it and send it from your own Gmail. It never goes through the app owner's Gmail or anyone else's.`
      : "Saved as a draft and downloaded as an .eml — open it and send it from your own Gmail. Nothing is ever sent through the app owner's Gmail.",
    fromEmail: gmailEmail,
    draft: draftPayload,
  };
}
