// Per-user Gmail reply sync — the shared core used by both the
// scheduled background sync (stored refresh token) and a manual sync
// (the creator's live session token). Given a fresh access token, it
// checks every deal with a pitch already sent, finds brand replies,
// classifies them with AI, saves them once, notifies the creator and
// moves the deal stage. Nothing is sent, nothing is auto-approved,
// and the agreed price is never changed here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import {
  getGmailMessage,
  listThreadMessageIds,
  searchGmailMessageIds,
} from "./gmail";
import { classifyBrandReply } from "./replyAi";

interface DealRow {
  id: number;
  owner_id: string;
  brand_name: string;
  brand_email: string | null;
  stage: string;
  deliverable: string;
  agreed_price: number | null;
  currency: string;
  pitch_subject: string | null;
  pitch_body: string | null;
  pitch_sent_at: string | null;
  pitch_gmail_message_id: string | null;
  pitch_gmail_thread_id: string | null;
}

function emailOf(header: string): string {
  const m = header.match(/<([^>]+)>/);
  return (m?.[1] ?? header).trim().toLowerCase();
}

/** The stage a reply moves the deal to. Automated and unrelated mail
 *  never moves a deal. Acceptance does NOT move it either — the
 *  creator approves with one click, and only then does it become
 *  Approved. */
export function stageForCategory(category: string, current: string): string | null {
  if (category === "rejecting") return "lost";
  if (category === "negotiating") return "negotiating";
  if (category === "accepting" || category === "confirming_terms") return null;
  if (
    category === "interested" ||
    category === "more_info" ||
    category === "asking_rates" ||
    category === "change_deliverables"
  ) {
    return current === "pitched" ? "reply_received" : null;
  }
  return null;
}

export interface SyncUserResult {
  checked: number;
  newMessages: number;
  error: string | null;
}

export async function runGmailSyncForUser(
  db: SupabaseClient,
  env: Env,
  ownerId: string,
  accessToken: string,
): Promise<SyncUserResult> {
  const result: SyncUserResult = { checked: 0, newMessages: 0, error: null };
  const { data: dealRows, error: dealError } = await db
    .from("deals")
    .select(
      "id, owner_id, brand_name, brand_email, stage, deliverable, agreed_price, currency, pitch_subject, pitch_body, pitch_sent_at, pitch_gmail_message_id, pitch_gmail_thread_id",
    )
    .eq("owner_id", ownerId)
    .not("pitch_sent_at", "is", null)
    .not("stage", "in", '("paid","lost")');
  if (dealError) {
    result.error = `could not list deals (${dealError.message})`;
    return result;
  }
  const deals = (dealRows ?? []) as DealRow[];

  for (const deal of deals) {
    result.checked += 1;
    try {
      const candidateIds: string[] = [];
      if (deal.pitch_gmail_thread_id) {
        const ids = await listThreadMessageIds(accessToken, deal.pitch_gmail_thread_id);
        candidateIds.push(...ids);
      } else if (deal.brand_email) {
        // No thread stored (pitch sent before tracking existed):
        // search for mail from the brand after the pitch went out.
        const after = deal.pitch_sent_at
          ? ` after:${Math.floor(new Date(deal.pitch_sent_at).getTime() / 1000)}`
          : "";
        const ids = await searchGmailMessageIds(
          accessToken,
          `from:${deal.brand_email}${after}`,
          20,
        );
        candidateIds.push(...ids);
      }
      const freshIds = candidateIds.filter(
        (id) => id && id !== deal.pitch_gmail_message_id,
      );
      if (freshIds.length === 0) continue;
      const { data: savedRows } = await db
        .from("deal_messages")
        .select("gmail_message_id")
        .eq("owner_id", ownerId)
        .eq("deal_id", deal.id)
        .in("gmail_message_id", freshIds);
      const saved = new Set(
        ((savedRows ?? []) as { gmail_message_id: string }[]).map(
          (r) => r.gmail_message_id,
        ),
      );
      for (const id of freshIds) {
        if (saved.has(id)) continue;
        const msg = await getGmailMessage(accessToken, id);
        const from = emailOf(msg.from);
        const brandEmail = (deal.brand_email ?? "").toLowerCase();
        if (brandEmail && from !== brandEmail) continue;
        if (
          deal.pitch_sent_at &&
          msg.date &&
          new Date(msg.date).getTime() <= new Date(deal.pitch_sent_at).getTime()
        ) {
          continue;
        }
        const body = msg.bodyText || msg.snippet;
        const analysis = await classifyBrandReply(env, {
          brandName: deal.brand_name,
          pitchSubject: deal.pitch_subject,
          pitchBody: deal.pitch_body,
          agreedPrice: deal.agreed_price,
          currency: deal.currency,
          deliverable: deal.deliverable,
          replySubject: msg.subject,
          replyBody: body,
        });
        const { data: inserted, error: insertError } = await db
          .from("deal_messages")
          .insert({
            owner_id: ownerId,
            deal_id: deal.id,
            gmail_message_id: msg.id,
            gmail_thread_id: msg.threadId,
            direction: "inbound",
            from_email: from,
            to_email: msg.to,
            subject: msg.subject,
            body_text: body,
            received_at: msg.date,
            classification: analysis.category,
            ai_summary: analysis.summary,
            stated_price: analysis.statedPrice,
            deliverables: analysis.deliverables,
            conditions: analysis.conditions,
          })
          .select("id")
          .maybeSingle();
        if (insertError) {
          if (/duplicate|unique/i.test(insertError.message)) continue;
          throw new Error(`could not save reply (${insertError.message})`);
        }
        result.newMessages += 1;

        if (analysis.category !== "automated" && analysis.category !== "unrelated") {
          const stage = stageForCategory(analysis.category, deal.stage);
          if (stage && stage !== deal.stage) {
            await db
              .from("deals")
              .update({ stage })
              .eq("id", deal.id)
              .eq("owner_id", ownerId);
            deal.stage = stage;
          }
          await db.from("notifications").insert({
            owner_id: ownerId,
            deal_id: deal.id,
            type:
              analysis.category === "accepting"
                ? "brand_accepted"
                : analysis.category === "negotiating"
                  ? "brand_negotiating"
                  : analysis.category === "rejecting"
                    ? "brand_rejected"
                    : "brand_replied",
            title: `Brand replied: ${deal.brand_name}`,
            body: analysis.summary,
          });
        }
      }
    } catch (e) {
      // One deal failing must not stop the rest of the sync.
      result.error = e instanceof Error ? e.message : "Deal sync failed";
      continue;
    }
  }
  return result;
}
