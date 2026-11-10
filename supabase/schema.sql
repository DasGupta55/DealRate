-- DealRate (Brand Pricing Tool v2) — consolidated Postgres schema
--
-- HOW TO APPLY
--   Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--   Run it once against a fresh project. It is idempotent for the seed
--   row only (see the INSERT ... ON CONFLICT at the end); re-running the
--   CREATE TABLE statements on an existing database will fail, which is
--   intentional — do not re-run it to "fix" a live database.
--
-- ROW LEVEL SECURITY (READ THIS)
--   Row Level Security is intentionally NOT the enforcement layer here.
--   The API server enforces per-user ownership itself: it connects with
--   the service-role key and filters every read/write by owner_id, after
--   verifying the caller's Supabase token (see server-spec.md §5).
--   Do NOT enable RLS on these tables without also adding policies that
--   allow the service-role connection used by the API — enabling RLS
--   with no policies will block the API and break the app.
--
-- EMPTY START
--   The app starts with EMPTY tables. The owner's pre-public rows stay
--   in the Muse artifact and are NOT migrated by this script. Do not
--   import them; the owner signs up in the public app and the rows are
--   attached to that verified account out of band if needed.
--
-- SOURCE
--   Consolidated end state of server/src/schema.ts plus Drizzle
--   migrations 0001–0009 of the original artifact. Tables that were
--   created and later dropped (entries, user_gmail) are NOT created
--   here. Type mapping: SQLite integer PK -> bigint identity,
--   timestamp_ms -> timestamptz, real -> double precision, large
--   counters (subscribers, total_views, total_videos, amount_paise)
--   -> bigint, integer-as-boolean (is_suggestion) -> boolean.
--   No foreign keys and no unique constraints exist in the source;
--   none are added here, so delete behaviour is unchanged
--   (e.g. deleteAccountData deletes per table by owner_id, and an
--   invoice's deal_id must survive its deal being deleted).
--   No secret values appear in this file.

-- ------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------
create table profiles (
  id bigint generated always as identity primary key,
  owner_id text,
  query text not null,
  channel_id text,
  title text,
  handle text,
  yt_country text,
  subscribers bigint,
  total_views bigint,
  total_videos bigint,
  avg_views double precision,
  avg_likes double precision,
  avg_comments double precision,
  engagement_pct double precision,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'error', 'manual')),
  error text,
  created_at timestamptz not null default now(),
  fetched_at timestamptz
);

-- ------------------------------------------------------------------
-- calculations
-- ------------------------------------------------------------------
create table calculations (
  id bigint generated always as identity primary key,
  owner_id text,
  label text not null,
  avg_views double precision not null,
  engagement_pct double precision not null,
  audience_country text not null,
  niche text not null,
  deliverable text not null,
  cpm double precision not null,
  niche_mult double precision not null,
  deliverable_mult double precision not null,
  engagement_factor double precision not null,
  price_low double precision not null,
  price_mid double precision not null,
  price_high double precision not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- brands
-- ------------------------------------------------------------------
create table brands (
  id bigint generated always as identity primary key,
  owner_id text,
  name text not null,
  website text,
  contact_email text,
  niche text,
  source_url text,
  notes text,
  is_suggestion boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- deals
-- ------------------------------------------------------------------
create table deals (
  id bigint generated always as identity primary key,
  owner_id text,
  brand_name text not null,
  brand_email text,
  stage text not null default 'prospect'
    check (stage in ('prospect', 'pitch_ready', 'pitched', 'negotiating', 'approved', 'content_live', 'invoiced', 'paid', 'lost')),
  deliverable text not null default 'dedicated',
  agreed_price double precision,
  currency text not null default 'USD',
  pitch_subject text,
  pitch_body text,
  pitch_sent_at timestamptz,
  notes text,
  research_json jsonb,
  research_checked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- invoices
-- ------------------------------------------------------------------
create table invoices (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id integer,
  brand_name text not null,
  brand_email text,
  invoice_number text not null,
  amount double precision not null,
  currency text not null default 'USD',
  description text not null default '',
  issue_date text not null,
  due_date text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue')),
  reminder_count integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- reminders
-- ------------------------------------------------------------------
create table reminders (
  id bigint generated always as identity primary key,
  owner_id text,
  from_email text,
  invoice_id integer,
  deal_id integer,
  kind text not null default 'invoice_reminder',
  to_email text,
  subject text not null,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'drafted')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- pro_payments
-- ------------------------------------------------------------------
create table pro_payments (
  id bigint generated always as identity primary key,
  owner_id text,
  billing text not null
    check (billing in ('monthly', 'annual')),
  amount_paise bigint not null,
  currency text not null default 'INR',
  razorpay_order_id text,
  razorpay_payment_id text,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed')),
  pro_starts_at timestamptz,
  pro_expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

-- ------------------------------------------------------------------
-- manual_payments (Phase 1 manual Pro payments: Razorpay.me + owner approval)
-- ------------------------------------------------------------------
create table manual_payments (
  id bigint generated always as identity primary key,
  owner_id text,
  username text not null,
  billing text not null
    check (billing in ('monthly', 'annual')),
  txn_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- ------------------------------------------------------------------
-- settings (singleton row, id = 1)
-- ------------------------------------------------------------------
create table settings (
  id integer primary key,
  plan text not null default 'free',
  inr_rate double precision not null default 83.5,
  supabase_url text,
  supabase_anon_key text,
  pay_link_inr_monthly text,
  pay_link_inr_annual text,
  pay_link_usd_monthly text,
  pay_link_usd_annual text,
  payment_mode text not null default 'automatic'
);

-- ------------------------------------------------------------------
-- Indexes (new, not in the source — the source had no indexes)
-- One owner_id index per per-user table, for the server's
-- owner_id = <userId> filtering. Plus invoices(due_date, status)
-- for the daily overdue-invoice cron.
-- ------------------------------------------------------------------
create index idx_profiles_owner_id on profiles (owner_id);
create index idx_calculations_owner_id on calculations (owner_id);
create index idx_brands_owner_id on brands (owner_id);
create index idx_deals_owner_id on deals (owner_id);
create index idx_invoices_owner_id on invoices (owner_id);
create index idx_reminders_owner_id on reminders (owner_id);
create index idx_pro_payments_owner_id on pro_payments (owner_id);
create index idx_manual_payments_owner_id on manual_payments (owner_id);
create index idx_invoices_due_date_status on invoices (due_date, status);

-- ------------------------------------------------------------------
-- Seed the singleton settings row (id = 1).
-- The server also creates this row on first read if it is missing;
-- this seed just makes the database complete from the start.
-- ------------------------------------------------------------------
insert into settings (id) values (1) on conflict (id) do nothing;
