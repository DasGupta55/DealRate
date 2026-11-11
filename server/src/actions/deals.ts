// Deals + pitches: pipeline CRUD, AI pitch generation (Groq, template
// fallback), and pitch sending. requestSendPitch only saves a
// ready-to-send draft for the client to download as .eml; sendPitch
// sends in one tap through the Gmail API, using the creator's own
// Google access token (gmail.send scope) — never the app owner's Gmail.

import { z } from "zod";
import { DELIVERABLE_LABEL } from "../lib/pricing";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import {
  getGoogleUserinfoEmail,
  gmailAuthResult,
  isGmailAuthError,
  sendGmailMessage,
} from "../lib/gmail";
import { chatGroqJson } from "../lib/groq";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type BrandRow,
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
): Promise<{ id: number; created: boolean }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  // One deal per brand: if this brand is already in the pipeline,
  // return the existing deal instead of creating a duplicate (also
  // covers double-taps before the dashboard refetches).
  const norm = args.brandName.trim().toLowerCase();
  const { data: existingData, error: existingError } = await db
    .from("deals")
    .select("id, brand_name")
    .eq("owner_id", args.userId);
  dbThrow(existingError, "createDeal existing");
  const existing = ((existingData ?? []) as { id: number; brand_name: string }[]).find(
    (d) => d.brand_name.trim().toLowerCase() === norm,
  );
  if (existing) return { id: existing.id, created: false };
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
  return { id: (data as { id: number }).id, created: true };
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
  const verified = await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  // The creator's real name (from their Google profile) so the pitch
  // signs off with it instead of a "[Your Name]" placeholder.
  const creatorName = verified.name ?? null;
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

  // Brand context (products, campaigns, niche) from the saved brand
  // this deal came from, so the email can reference something real
  // instead of generic praise. Missing details are simply left out —
  // the email never invents them. A failed lookup is not fatal.
  const { data: brandData } = await db
    .from("brands")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("name", deal.brand_name)
    .order("id", { ascending: false })
    .limit(1);
  const brand = ((brandData ?? []) as BrandRow[])[0];

  const channelName = profile?.title ?? profile?.handle ?? "my channel";
  const channelUrl = profile?.handle
    ? `https://www.youtube.com/@${profile.handle.replace(/^@/, "")}`
    : profile?.channel_id
      ? `https://www.youtube.com/channel/${profile.channel_id}`
      : null;
  const niche = calc?.niche ?? brand?.niche ?? null;
  const audienceCountry = calc?.audience_country ?? profile?.yt_country ?? null;
  const avgViews = profile?.avg_views ?? calc?.avg_views ?? null;
  const engagement = profile?.engagement_pct ?? calc?.engagement_pct ?? null;
  const subscribers = profile?.subscribers ?? null;
  const price = deal.agreed_price ?? calc?.price_mid ?? null;
  const currency = deal.currency ?? "USD";
  const deliverableLabel =
    DELIVERABLE_LABEL[deal.deliverable] ?? "Dedicated video";
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const feeText = price ? `${currency} ${fmt(price)}` : null;

  // Full signature: real name, channel, channel link. Never a
  // bracketed placeholder.
  const signatureLines = [creatorName, channelName, channelUrl].filter(
    (x): x is string => Boolean(x),
  );
  const signOff = `Best,\n${signatureLines.join("\n")}`;

  // One verified stat, the strongest available — the email uses at
  // most one number, never a list.
  const statLine = avgViews
    ? `My recent videos average ${fmt(avgViews)} views`
    : engagement
      ? `My channel runs at ${engagement.toFixed(1)}% engagement`
      : subscribers
        ? `My channel has ${fmt(subscribers)} subscribers`
        : null;
  const statsFact = [
    subscribers ? `${fmt(subscribers)} subscribers` : null,
    avgViews ? `average ${fmt(avgViews)} views per recent video` : null,
    engagement ? `${engagement.toFixed(2)}% engagement` : null,
  ]
    .filter((x): x is string => Boolean(x))
    .join(", ");

  // Relevance sentence for the template: ties a real brand detail to
  // the creator's niche and audience, or falls back to a neutral line
  // that claims nothing about the product.
  const brandDetail =
    brand?.notes && brand.notes.length <= 140
      ? brand.notes
      : brand?.niche
        ? `${brand.niche}`
        : null;
  const relevance = brandDetail
    ? `I came across ${deal.brand_name}'s ${brandDetail} — it stood out as something my ${niche ?? "YouTube"} audience would genuinely find useful.`
    : `I make ${niche ?? "YouTube"} videos, and ${deal.brand_name} caught my eye as a brand my viewers would want to hear about.`;

  // --- Template fallback. Same structure and rules as the AI email,
  // so the pitch still reads well when Groq is down. ---
  let subject = `Content idea for ${deal.brand_name} × ${channelName}`;
  let body = [
    `Hi ${deal.brand_name} Partnerships Team,`,
    ``,
    relevance,
    ``,
    `I'd like to make a ${deliverableLabel.toLowerCase()} that puts ${deal.brand_name} into a real ${niche ?? "creator"} workflow — showing how it works, who it's for, and where it fits, instead of a straight advertisement.`,
    ``,
    ...(statLine ? [`${statLine}.`, ``] : []),
    feeText
      ? `My proposed fee for this ${deliverableLabel.toLowerCase()} is ${feeText}.`
      : `My rate for this deliverable is available on request.`,
    ``,
    `Would you be open to discussing this collaboration?`,
    ``,
    signOff,
  ].join("\n");

  // Replace any bracketed name placeholder the AI leaves behind with
  // the creator's real name, so a pitch never goes out signed
  // "[Your Name]".
  const fillName = (text: string): string =>
    creatorName ? text.replace(/\[(?:your\s+)?name\]/gi, creatorName) : text;

  // Final quality test (the brief's checklist, enforced in code):
  // sounds human, relevant to this brand, clear idea, one stat max,
  // exact fee, one simple question, no invented facts, concise.
  // Anything that fails falls back to the template above.
  const BANNED: string[] = [
    "i am reaching out",
    "reaching out to you",
    "amazing brand",
    "love your brand",
    "love your products",
    "overview, usage demonstration",
    "call to action",
    "guarantee",
    "will go viral",
    "guaranteed",
    "limited time",
    "don't miss",
  ];
  const feeForms: string[] = price
    ? [
        `${currency} ${fmt(price)}`,
        `${fmt(price)} ${currency}`,
        ...(currency === "USD" ? [`$${fmt(price)}`] : []),
      ]
    : [];
  const passesGate = (s: string, b: string): boolean => {
    const words = b.trim().split(/\s+/).length;
    if (words < 60 || words > 180) return false;
    if (/\[[^\]\n]+\]/.test(b) || /\[[^\]\n]+\]/.test(s)) return false;
    if (!s.includes(deal.brand_name) || s.length > 80) return false;
    const lower = b.toLowerCase();
    if (BANNED.some((p) => lower.includes(p))) return false;
    if ((b.match(/\?/g) ?? []).length !== 1) return false;
    if (price && !feeForms.some((f) => b.includes(f))) return false;
    if (!price && !lower.includes("available on request")) return false;
    if (creatorName && !b.includes(creatorName)) return false;
    if (channelUrl && !b.includes(channelUrl)) return false;
    return true;
  };

  try {
    const brandContext = brandDetail
      ? `Product/campaign detail from the saved brand: ${brandDetail}.`
      : "No product detail supplied — keep the relevance line to the creator's niche and audience.";
    const ai = await chatGroqJson<{ subject: string; body: string }>(
      ctx.env.groqApiKey ?? "",
      "You write brand outreach emails from a real YouTube creator to a brand. Reply with a single JSON object {subject, body} only — no other text, no explanations.",
      [
        `Write one outreach email, 80–130 words, that sounds personally written by the creator after researching the brand. Specific, confident, human. No hype, no jargon, no emojis.`,
        ``,
        `FACTS — use only these. Never invent a product detail, statistic, or claim that is not listed. Leave out anything missing instead of guessing.`,
        `- Creator: ${creatorName ?? "name not given"}. Channel: "${channelName}"${channelUrl ? ` (${channelUrl})` : ""}. Niche: ${niche ?? "not given"}. Audience: ${audienceCountry ?? "not given"}.`,
        `- Verified stats (use at most ONE, the strongest): ${statsFact || "none available"}.`,
        `- Brand: ${deal.brand_name}. ${brandContext}`,
        `- Deal: ${deliverableLabel} on YouTube. Proposed fee: ${feeText ?? "not set — write 'My rate for this deliverable is available on request.'"} (state the exact amount and currency, tied to the deliverable).`,
        `- Contact name: not available.`,
        ...(deal.notes ? [`- Creator notes: ${deal.notes}`] : []),
        ``,
        `STRUCTURE, in order:`,
        `1. Subject: natural and specific, e.g. "Content idea for ${deal.brand_name} × ${channelName}". No clickbait, no extra punctuation.`,
        `2. Greeting: "Hi ${deal.brand_name} Partnerships Team,"`,
        `3. Why this brand: one or two sentences tying a real product/feature/campaign from the facts to the creator's audience. Never claim the creator used, loved, bought, or recommends the product.`,
        `4. The content idea: a specific ${deliverableLabel.toLowerCase()} concept for this brand and niche — what the video actually shows. Never the generic "overview, usage demonstration, and a call to action".`,
        `5. At most one verified stat.`,
        `6. The fee, exactly as given, tied to the deliverable.`,
        `7. End with ONE simple question, e.g. "Would you be open to discussing this collaboration?"`,
        `8. Sign off exactly:`,
        `Best,`,
        ...(creatorName ? [creatorName] : []),
        channelName,
        ...(channelUrl ? [channelUrl] : []),
        `Never write a bracketed placeholder such as [Your Name].`,
        ``,
        `RULES: 80–130 words. Short paragraphs. Do not write "I am reaching out". No fake compliments ("amazing brand"). No promised timeline, sales, views, or results. Do not write as if a partnership is agreed. Do not sound desperate. One question only.`,
      ].join("\n"),
    );
    if (ai.subject && ai.body) {
      let aiSubject = fillName(ai.subject.trim());
      let aiBody = fillName(ai.body.trim());
      // Repair: if the AI left the signature off, add it before the
      // quality check so a good email is not discarded for that alone.
      if (creatorName && !aiBody.includes(creatorName)) {
        aiBody = `${aiBody}\n\n${signOff}`;
      }
      if (passesGate(aiSubject, aiBody)) {
        subject = aiSubject;
        body = aiBody;
      }
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

export const sendPitchSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
  gmailToken: z.string(),
});

/** One-click pitch send: delivers the saved pitch straight from the
 *  creator's own Gmail via the Gmail API, using the Google access token
 *  the client passes (granted on demand with the gmail.send scope when
 *  the creator taps Send — sign-in itself never asks for it).
 *  The token is verified against the signed-in account before sending;
 *  a 401/403 from Gmail becomes a "sign in again" status, and a token
 *  without the scope becomes gmail_scope_missing, never a send from
 *  the wrong account. */
export async function sendPitch(
  ctx: ActionCtx,
  args: z.infer<typeof sendPitchSchema>,
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
  dbThrow(error, "sendPitch deal");
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
  if (!args.gmailToken.trim()) {
    return {
      status: "gmail_not_connected",
      message:
        "Sign in with Google first, then tap Send again and allow Gmail sending.",
      ...noDraft,
    };
  }
  // Verify the Gmail token belongs to the signed-in account before
  // sending anything with it.
  let gmailEmail: string;
  try {
    gmailEmail = await getGoogleUserinfoEmail(args.gmailToken);
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        ...gmailAuthResult(err),
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
      to: deal.brand_email,
      subject: deal.pitch_subject,
      body: deal.pitch_body,
    });
  } catch (err) {
    if (isGmailAuthError(err)) {
      return {
        ...gmailAuthResult(err),
        fromEmail: verified.email,
        draft: null,
      };
    }
    throw err;
  }
  const { error: insertError } = await db.from("reminders").insert({
    owner_id: args.userId,
    from_email: verified.email,
    deal_id: deal.id,
    kind: "pitch",
    to_email: deal.brand_email,
    subject: deal.pitch_subject,
    body: deal.pitch_body,
    status: "sent",
  });
  dbThrow(insertError, "sendPitch insert");
  const { error: updateError } = await db
    .from("deals")
    .update({
      pitch_sent_at: new Date().toISOString(),
      ...(deal.stage === "prospect" || deal.stage === "pitch_ready"
        ? { stage: "pitched" }
        : {}),
    })
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  dbThrow(updateError, "sendPitch update");
  return {
    status: "sent",
    message: `Pitch sent from your Gmail (${verified.email}) to ${deal.brand_email}.`,
    fromEmail: verified.email,
    draft: null,
  };
}
