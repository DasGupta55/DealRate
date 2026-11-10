// Shared action plumbing: zod arg schemas, wire output types (spec §1/§7)
// and the row -> wire mappers. Domain action files import from here; the
// registry (server/src/actions.ts) re-exports the output types.

import { z } from "zod";
import type {
  BrandRow,
  CalculationRow,
  DealRow,
  InvoiceRow,
  ManualPaymentRow,
  ProfileRow,
  ProPaymentRow,
  ReminderRow,
} from "../lib/db";

export const userIdArg = z
  .string()
  .min(1, "A signed-in user id is required.");

export const billingEnum = z.enum(["monthly", "annual"]);
export const dealStageEnum = z.enum([
  "prospect",
  "pitch_ready",
  "pitched",
  "negotiating",
  "approved",
  "content_live",
  "invoiced",
  "paid",
  "lost",
]);
export const invoiceStatusEnum = z.enum(["draft", "sent", "paid", "overdue"]);

// ---------- Wire output types (spec §1) ----------

export interface ProfileOut {
  id: number;
  query: string;
  channelId: string | null;
  title: string | null;
  handle: string | null;
  ytCountry: string | null;
  subscribers: number | null;
  totalViews: number | null;
  totalVideos: number | null;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  engagementPct: number | null;
  status: string;
  error: string | null;
  fetchedAt: string | null;
}

export interface CalcOut {
  id: number;
  label: string;
  avgViews: number;
  engagementPct: number;
  audienceCountry: string;
  niche: string;
  deliverable: string;
  cpm: number;
  nicheMult: number;
  deliverableMult: number;
  engagementFactor: number;
  priceLow: number;
  priceMid: number;
  priceHigh: number;
  createdAt: string;
}

export interface BrandOut {
  id: number;
  name: string;
  website: string | null;
  contactEmail: string | null;
  niche: string | null;
  sourceUrl: string | null;
  notes: string | null;
  isSuggestion: boolean;
}

// AI Brand Research — one short, sourced finding per topic. A field is
// null when no public evidence was found; the UI shows "Not found in
// public sources" instead of inventing it.
export interface BrandResearch {
  website: string | null;
  products: string | null;
  marketing: string | null;
  influencerCollaborations: string | null;
  creatorProgram: string | null;
  campaigns: string | null;
  affiliate: string | null;
  countryOpportunities: string | null;
  contact: string | null;
  sources: { title: string; url: string }[];
  checkedAt: string;
}

export interface DealOut {
  id: number;
  brandName: string;
  brandEmail: string | null;
  stage: string;
  deliverable: string;
  agreedPrice: number | null;
  currency: string;
  pitchSubject: string | null;
  pitchBody: string | null;
  pitchSentAt: string | null;
  notes: string | null;
  research: BrandResearch | null;
  researchCheckedAt: string | null;
}

export interface InvoiceOut {
  id: number;
  dealId: number | null;
  brandName: string;
  brandEmail: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  description: string;
  issueDate: string;
  dueDate: string;
  status: string;
  reminderCount: number;
  lastReminderAt: string | null;
  daysOverdue: number;
}

export interface ReminderOut {
  id: number;
  invoiceId: number | null;
  dealId: number | null;
  kind: string;
  toEmail: string | null;
  fromEmail: string | null;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
}

export interface ProPaymentOut {
  id: number;
  billing: string;
  amountInr: number;
  paymentId: string | null;
  status: string;
  proExpiresAt: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface ManualPaymentOut {
  id: number;
  billing: string;
  txnId: string;
  status: string;
  createdAt: string;
}

export interface PitchDraft {
  status: string;
  message: string;
  fromEmail: string | null;
  draft: { toEmail: string; subject: string; body: string } | null;
}

// ---------- Row -> wire mappers ----------

function iso(value: string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function toProfileOut(r: ProfileRow): ProfileOut {
  return {
    id: r.id,
    query: r.query,
    channelId: r.channel_id,
    title: r.title,
    handle: r.handle,
    ytCountry: r.yt_country,
    subscribers: r.subscribers,
    totalViews: r.total_views,
    totalVideos: r.total_videos,
    avgViews: r.avg_views,
    avgLikes: r.avg_likes,
    avgComments: r.avg_comments,
    engagementPct: r.engagement_pct,
    status: r.status,
    error: r.error,
    fetchedAt: iso(r.fetched_at),
  };
}

export function toCalcOut(r: CalculationRow): CalcOut {
  return {
    id: r.id,
    label: r.label,
    avgViews: r.avg_views,
    engagementPct: r.engagement_pct,
    audienceCountry: r.audience_country,
    niche: r.niche,
    deliverable: r.deliverable,
    cpm: r.cpm,
    nicheMult: r.niche_mult,
    deliverableMult: r.deliverable_mult,
    engagementFactor: r.engagement_factor,
    priceLow: r.price_low,
    priceMid: r.price_mid,
    priceHigh: r.price_high,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function toBrandOut(r: BrandRow): BrandOut {
  return {
    id: r.id,
    name: r.name,
    website: r.website,
    contactEmail: r.contact_email,
    niche: r.niche,
    sourceUrl: r.source_url,
    notes: r.notes,
    isSuggestion: r.is_suggestion === true,
  };
}

export function toDealOut(r: DealRow): DealOut {
  let research: BrandResearch | null = null;
  const raw = r.research_json as BrandResearch | string | null;
  if (raw) {
    try {
      research = typeof raw === "string" ? (JSON.parse(raw) as BrandResearch) : raw;
    } catch {
      research = null;
    }
  }
  return {
    id: r.id,
    brandName: r.brand_name,
    brandEmail: r.brand_email,
    stage: r.stage,
    deliverable: r.deliverable,
    agreedPrice: r.agreed_price,
    currency: r.currency,
    pitchSubject: r.pitch_subject,
    pitchBody: r.pitch_body,
    pitchSentAt: iso(r.pitch_sent_at),
    notes: r.notes,
    research,
    researchCheckedAt: iso(r.research_checked_at),
  };
}

export function toInvoiceOut(r: InvoiceRow, today: string): InvoiceOut {
  const overdue =
    r.status !== "paid" && r.due_date < today
      ? Math.floor(
          (new Date(`${today}T00:00:00`).getTime() -
            new Date(`${r.due_date}T00:00:00`).getTime()) / 86400000,
        )
      : 0;
  return {
    id: r.id,
    dealId: r.deal_id,
    brandName: r.brand_name,
    brandEmail: r.brand_email,
    invoiceNumber: r.invoice_number,
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    status: r.status,
    reminderCount: r.reminder_count,
    lastReminderAt: iso(r.last_reminder_at),
    daysOverdue: overdue,
  };
}

export function toReminderOut(r: ReminderRow): ReminderOut {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    dealId: r.deal_id,
    kind: r.kind,
    toEmail: r.to_email,
    fromEmail: r.from_email,
    subject: r.subject,
    body: r.body,
    status: r.status,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export function toProPaymentOut(r: ProPaymentRow): ProPaymentOut {
  return {
    id: r.id,
    billing: r.billing,
    amountInr: r.amount_paise / 100,
    paymentId: r.razorpay_payment_id,
    status: r.status,
    proExpiresAt: iso(r.pro_expires_at),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    verifiedAt: iso(r.verified_at),
  };
}

export function toManualPaymentOut(r: ManualPaymentRow): ManualPaymentOut {
  return {
    id: r.id,
    billing: r.billing,
    txnId: r.txn_id,
    status: r.status,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}
