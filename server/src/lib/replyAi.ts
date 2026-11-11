// AI brand-reply detection — classify an incoming brand email and
// pull out the terms that matter for the deal.
//
// The 10 categories:
//   interested | more_info | asking_rates | negotiating | accepting |
//   confirming_terms | rejecting | change_deliverables | automated |
//   unrelated
//
// The distinction that matters most is "interested" vs "accepting".
// "We are interested in working with you" is interest, not approval:
// the brand has not agreed to anything yet. "We approve the
// collaboration at ₹25,000 for one dedicated video" is acceptance —
// it names the deliverable AND the price. Only acceptance may show
// the one-click approval card, and even then the creator must confirm;
// nothing is ever auto-approved, and the agreed price is never
// changed without the creator.

import { chatAiJson } from "./ai";
import type { Env } from "./env";

export type ReplyCategory =
  | "interested"
  | "more_info"
  | "asking_rates"
  | "negotiating"
  | "accepting"
  | "confirming_terms"
  | "rejecting"
  | "change_deliverables"
  | "automated"
  | "unrelated";

export interface ReplyAnalysis {
  category: ReplyCategory;
  /** One or two plain sentences the creator can read at a glance. */
  summary: string;
  /** True only when the brand clearly accepts the collaboration at
   *  stated terms (deliverable + price). Interest alone is false. */
  isAcceptance: boolean;
  /** The price the brand states, as a plain number, when the email
   *  names one. Never guessed — null when the email does not state
   *  a price. */
  statedPrice: number | null;
  /** Deliverables the brand mentions (e.g. "one dedicated video"). */
  deliverables: string | null;
  /** Conditions the brand attaches (e.g. "video must go live by
   *  Friday", "payment after 30 days"). */
  conditions: string | null;
}

const CATEGORY_LABELS: Record<ReplyCategory, string> = {
  interested: "Interested",
  more_info: "Requesting more information",
  asking_rates: "Asking for rates",
  negotiating: "Negotiating price",
  accepting: "Accepting the collaboration",
  confirming_terms: "Confirming agreed terms",
  rejecting: "Rejecting the proposal",
  change_deliverables: "Requesting changes to deliverables",
  automated: "Automated reply",
  unrelated: "Unrelated",
};

/** Acceptance is only real when the AI classified the reply as
 *  accepting AND a price is present — either the brand states a price
 *  or it explicitly confirms the creator's agreed price. A bare
 *  "sounds good" with no terms is interest, not acceptance, and must
 *  never show the approval card. Pure logic, so it is unit-testable
 *  without calling the AI. */
export function isRealAcceptance(
  category: string,
  statedPrice: number | null,
  agreedPrice: number | null,
  replyBody: string,
): boolean {
  if (category !== "accepting") return false;
  if (statedPrice !== null) return true;
  if (agreedPrice !== null && /confirm|approve|agree|accept/i.test(replyBody)) return true;
  return false;
}

export async function classifyBrandReply(
  env: Env,
  input: {
    brandName: string;
    pitchSubject: string | null;
    pitchBody: string | null;
    agreedPrice: number | null;
    currency: string;
    deliverable: string;
    replySubject: string;
    replyBody: string;
  },
): Promise<ReplyAnalysis> {
  const system =
    "You read a brand's reply to a creator's sponsorship pitch. Reply with a single JSON object only — no other text, no explanations.";
  const prompt = [
    `A YouTube creator pitched the brand "${input.brandName}" for a paid sponsorship. The pitch subject was "${input.pitchSubject ?? ""}". The proposed deliverable is "${input.deliverable}" and the creator's agreed price is ${input.agreedPrice ?? "not set"} ${input.currency}.`,
    ``,
    `The brand replied. Subject: "${input.replySubject}". Body:`,
    input.replyBody,
    ``,
    `Classify the reply into exactly one category: interested, more_info, asking_rates, negotiating, accepting, confirming_terms, rejecting, change_deliverables, automated, unrelated.`,
    `Rules:`,
    `- "interested" means the brand likes the idea and wants to talk, but has NOT agreed to terms. "We are interested in working with you" is interested, never accepting.`,
    `- "accepting" means the brand clearly approves the collaboration AND states the deliverable and the price (or confirms the creator's stated price). Only then set isAcceptance to true. If the price or the deliverable is missing or unclear, it is not accepting.`,
    `- "negotiating" means the brand asks for a lower price or a different price than proposed.`,
    `- "asking_rates" means the brand asks what the creator charges, without naming a price.`,
    `- "automated" means an out-of-office or auto-generated reply. "unrelated" means the email is not about this sponsorship at all.`,
    `Return JSON: {"category": "<one of the ten>", "summary": "<one or two plain sentences>", "isAcceptance": true/false, "statedPrice": <number or null — only the price the brand actually states in this email, never a guess>, "deliverables": "<what the brand mentions, or null>", "conditions": "<conditions the brand attaches, or null>"}.`,
  ].join("\n");
  const parsed = await chatAiJson<{
    category?: string;
    summary?: string;
    isAcceptance?: boolean;
    statedPrice?: number | null;
    deliverables?: string | null;
    conditions?: string | null;
  }>(env, system, prompt);
  const category = (parsed.category ?? "unrelated") as ReplyCategory;
  const valid: ReplyCategory[] = [
    "interested",
    "more_info",
    "asking_rates",
    "negotiating",
    "accepting",
    "confirming_terms",
    "rejecting",
    "change_deliverables",
    "automated",
    "unrelated",
  ];
  const safeCategory = valid.includes(category) ? category : "unrelated";
  const statedPrice =
    typeof parsed.statedPrice === "number" && Number.isFinite(parsed.statedPrice)
      ? parsed.statedPrice
      : null;
  // Acceptance is only real when the category says so AND a price or
  // an explicit confirmation of the creator's price is present. A
  // bare "sounds good" with no terms is interest, not acceptance.
  const isAcceptance =
    parsed.isAcceptance === true &&
    isRealAcceptance(safeCategory, statedPrice, input.agreedPrice, input.replyBody);
  return {
    category: safeCategory,
    summary: (parsed.summary ?? "").trim() || "The brand replied to your pitch.",
    isAcceptance,
    statedPrice,
    deliverables: parsed.deliverables ?? null,
    conditions: parsed.conditions ?? null,
  };
}

/** Draft a reply to the brand, using the real conversation, the
 *  proposed/agreed price and the creator's details. The creator
 *  always edits and approves before anything is sent. */
export async function draftBrandReply(
  env: Env,
  input: {
    creatorName: string;
    channelName: string | null;
    channelUrl: string | null;
    brandName: string;
    deliverable: string;
    agreedPrice: number | null;
    currency: string;
    conversation: { from: string; body: string }[];
    instruction: string | null;
  },
): Promise<{ subject: string; body: string }> {
  const system =
    "You write brand outreach emails from a real YouTube creator to a brand. Reply with a single JSON object {subject, body} only — no other text, no explanations.";
  const convo = input.conversation
    .map((m, i) => `${i + 1}. ${m.from}: ${m.body}`)
    .join("\n");
  const priceLine =
    input.agreedPrice !== null
      ? `The agreed price is ${input.agreedPrice} ${input.currency}. Never change the price unless the creator's instruction says so.`
      : "No price has been agreed yet. Do not invent a price.";
  const prompt = [
    `Write a reply to the brand "${input.brandName}" as the creator ${input.creatorName}${input.channelName ? ` of the channel ${input.channelName}` : ""}. Deliverable: ${input.deliverable}. ${priceLine}`,
    input.instruction ? `Creator's instruction: ${input.instruction}` : "",
    `Conversation so far:`,
    convo,
    ``,
    `Keep it 80–130 words, specific, confident and human. Answer the brand's latest point directly. No hype, no jargon, no emojis, no placeholders. End with the creator's name and channel.`,
  ]
    .filter(Boolean)
    .join("\n");
  return await chatAiJson<{ subject: string; body: string }>(env, system, prompt);
}
