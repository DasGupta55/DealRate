// Supabase Postgres access (server-side only).
//
// The service-role key never leaves the server — the browser client must
// never hold it. All isolation is application-level `owner_id` filtering,
// exactly as in the source; RLS (if enabled on the project) is defence in
// depth only, never the isolation mechanism.
//
// Row types mirror the consolidated Postgres schema (spec §3). Supabase
// returns `timestamptz` columns as ISO strings, so timestamps are `string`
// here and converted with `new Date(...)` where arithmetic is needed.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv, type Env } from "./env";

export type Db = SupabaseClient;

export interface ActionCtx {
  /** Null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset. */
  db: Db | null;
  env: Env;
  accessToken?: string;
}

/**
 * Build the service-role client. Returns null when the Supabase env vars
 * are missing so callers that do not need the DB (e.g. getProCheckoutInfo)
 * still work and callers that do need it can fail with a clean JSON error
 * instead of a crash.
 */
export function createServiceClient(env: Env = loadEnv()): Db | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Throw a plain error when a handler needs the DB but it is unconfigured. */
export function requireDb(ctx: ActionCtx): Db {
  if (!ctx.db) {
    throw new Error(
      "The database is not configured yet. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }
  return ctx.db;
}

/** Throw on a Supabase/PostgREST error, with the query labelled. */
export function dbThrow(
  error: { message: string } | null,
  label: string,
): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// ---------- Row types (snake_case, as stored in Postgres) ----------

export interface ProfileRow {
  id: number;
  owner_id: string | null;
  query: string;
  channel_id: string | null;
  title: string | null;
  handle: string | null;
  yt_country: string | null;
  subscribers: number | null;
  total_views: number | null;
  total_videos: number | null;
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_pct: number | null;
  status: string;
  error: string | null;
  created_at: string;
  fetched_at: string | null;
}

export interface CalculationRow {
  id: number;
  owner_id: string | null;
  label: string;
  avg_views: number;
  engagement_pct: number;
  audience_country: string;
  niche: string;
  deliverable: string;
  cpm: number;
  niche_mult: number;
  deliverable_mult: number;
  engagement_factor: number;
  price_low: number;
  price_mid: number;
  price_high: number;
  created_at: string;
}

export interface BrandRow {
  id: number;
  owner_id: string | null;
  name: string;
  website: string | null;
  contact_email: string | null;
  niche: string | null;
  source_url: string | null;
  notes: string | null;
  is_suggestion: boolean;
  created_at: string;
}

export interface DealRow {
  id: number;
  owner_id: string | null;
  brand_name: string;
  brand_email: string | null;
  stage: string;
  deliverable: string;
  agreed_price: number | null;
  currency: string;
  pitch_subject: string | null;
  pitch_body: string | null;
  pitch_sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface InvoiceRow {
  id: number;
  owner_id: string | null;
  deal_id: number | null;
  brand_name: string;
  brand_email: string | null;
  invoice_number: string;
  amount: number;
  currency: string;
  description: string;
  issue_date: string;
  due_date: string;
  status: string;
  reminder_count: number;
  last_reminder_at: string | null;
  created_at: string;
}

export interface ReminderRow {
  id: number;
  owner_id: string | null;
  from_email: string | null;
  invoice_id: number | null;
  deal_id: number | null;
  kind: string;
  to_email: string | null;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

export interface ProPaymentRow {
  id: number;
  owner_id: string | null;
  billing: string;
  amount_paise: number;
  currency: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: string;
  pro_starts_at: string | null;
  pro_expires_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  verified_at: string | null;
}

export interface ManualPaymentRow {
  id: number;
  owner_id: string | null;
  username: string;
  billing: string;
  txn_id: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface SettingsRow {
  id: number;
  plan: string;
  inr_rate: number;
  supabase_url: string | null;
  supabase_anon_key: string | null;
  pay_link_inr_monthly: string | null;
  pay_link_inr_annual: string | null;
  pay_link_usd_monthly: string | null;
  pay_link_usd_annual: string | null;
  payment_mode: string;
}

// ---------- Settings singleton (id = 1) ----------

export async function getSettings(db: Db): Promise<SettingsRow | null> {
  const { data, error } = await db
    .from("settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  dbThrow(error, "getSettings");
  return (data ?? null) as SettingsRow | null;
}

/** Read the singleton row, inserting the seed row when it does not exist. */
export async function ensureSettings(db: Db): Promise<SettingsRow> {
  const existing = await getSettings(db);
  if (existing) return existing;
  const { data, error } = await db
    .from("settings")
    .insert({
      id: 1,
      plan: "free",
      inr_rate: 83.5,
      payment_mode: "automatic",
    })
    .select("*")
    .single();
  if (error || !data) {
    // A concurrent insert may have won the race — re-read before failing.
    const retry = await getSettings(db);
    if (retry) return retry;
    dbThrow(error, "ensureSettings");
    throw new Error("ensureSettings: insert returned no rows");
  }
  return data as SettingsRow;
}
