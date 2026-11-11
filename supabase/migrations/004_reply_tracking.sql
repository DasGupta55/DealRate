-- DealRate migration 004 — two-way email tracking, AI reply detection,
-- one-click approval, content submission.
--
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). Idempotent: safe to run twice. No RLS (the
-- project enforces ownership server-side with the service_role key);
-- every new table is filtered by owner_id in the server actions.
--
-- New tables:
--   deal_messages       every email in a deal's conversation (pitch sent
--                       + brand replies), deduped by gmail_message_id
--   gmail_tokens        the creator's encrypted Google refresh token so
--                       the scheduled sync can read their inbox in the
--                       background (AES-256-GCM, key = Netlify env var
--                       TOKEN_ENCRYPTION_KEY; the plaintext token is
--                       never stored)
--   notifications       in-app notifications (brand replied, deal
--                       approved, invoice overdue)
--   deal_approvals      one-click approval history per deal
--   content_submissions published content links per deal
-- Deals: pitch_gmail_message_id / pitch_gmail_thread_id (so the sync
-- can find replies in the same Gmail thread), and the stage list grows
-- to 11: reply_received, content_production, content_submitted are new;
-- existing content_live rows become content_submitted.
-- Invoices: sent_at and paid_at timestamps.

-- ------------------------------------------------------------------
-- deal_messages
-- ------------------------------------------------------------------
create table if not exists deal_messages (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id bigint not null references deals(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email text,
  to_email text,
  subject text,
  body_text text,
  received_at timestamptz,
  classification text,
  ai_summary text,
  stated_price double precision,
  deliverables text,
  conditions text,
  created_at timestamptz not null default now(),
  unique (owner_id, gmail_message_id)
);
create index if not exists deal_messages_deal_idx on deal_messages (deal_id, received_at);
create index if not exists deal_messages_owner_idx on deal_messages (owner_id, received_at desc);

-- ------------------------------------------------------------------
-- gmail_tokens
-- ------------------------------------------------------------------
create table if not exists gmail_tokens (
  owner_id text primary key,
  email text,
  encrypted_refresh_token text not null,
  scopes text,
  invalid boolean not null default false,
  invalid_reason text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- notifications
-- ------------------------------------------------------------------
create table if not exists notifications (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id bigint references deals(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_owner_idx on notifications (owner_id, is_read, created_at desc);

-- ------------------------------------------------------------------
-- deal_approvals
-- ------------------------------------------------------------------
create table if not exists deal_approvals (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id bigint not null references deals(id) on delete cascade,
  source_message_id bigint references deal_messages(id) on delete set null,
  approved_price double precision,
  currency text,
  deliverables text,
  conditions text,
  approved_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- content_submissions
-- ------------------------------------------------------------------
create table if not exists content_submissions (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id bigint not null references deals(id) on delete cascade,
  content_url text not null,
  platform text,
  notes text,
  published_at date,
  created_at timestamptz not null default now()
);
create index if not exists content_submissions_deal_idx on content_submissions (deal_id);

-- ------------------------------------------------------------------
-- deals: Gmail thread ids + 11 stages
-- ------------------------------------------------------------------
alter table deals add column if not exists pitch_gmail_message_id text;
alter table deals add column if not exists pitch_gmail_thread_id text;

update deals set stage = 'content_submitted' where stage = 'content_live';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'deals'::regclass and conname = 'deals_stage_check'
  ) then
    alter table deals drop constraint deals_stage_check;
  end if;
end $$;
alter table deals
  add constraint deals_stage_check
  check (stage in (
    'prospect', 'pitch_ready', 'pitched', 'reply_received',
    'negotiating', 'approved', 'content_production',
    'content_submitted', 'invoiced', 'paid', 'lost'
  ));

-- ------------------------------------------------------------------
-- invoices: sent + paid timestamps
-- ------------------------------------------------------------------
alter table invoices add column if not exists sent_at timestamptz;
alter table invoices add column if not exists paid_at timestamptz;
