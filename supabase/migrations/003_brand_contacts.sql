-- Brand email discovery — store discovered contacts and the provenance
-- of the email selected on each deal.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor →
-- New query → paste → Run). It is safe to run again: everything is
-- added only when it does not exist yet. This file also includes the
-- AI Brand Research columns from 002, so running this one file sets
-- up both features.
--
-- No Row Level Security is enabled here, matching the rest of this
-- project: ownership is enforced server-side (every query filters by
-- owner_id with the service_role key).

-- AI Brand Research storage (from 002, idempotent).
alter table public.deals
  add column if not exists research_json jsonb,
  add column if not exists research_checked_at timestamptz;

-- Provenance of the brand email selected on a deal:
-- brand_email_source: the URL the email was found on, or 'manual'
--   when the creator typed it.
-- brand_email_category: e.g. 'Influencer Partnerships', 'Marketing'.
-- brand_email_manual: true when the creator typed/edited the email;
--   auto-discovery never overwrites a manual email.
alter table public.deals
  add column if not exists brand_email_source text,
  add column if not exists brand_email_category text,
  add column if not exists brand_email_manual boolean not null default false;

-- Every contact discovered for a deal. The best one is copied to
-- deals.brand_email; the creator can view this list and pick another.
create table if not exists public.brand_contacts (
  id bigint generated always as identity primary key,
  owner_id text,
  deal_id bigint not null references public.deals(id) on delete cascade,
  email text not null,
  category text,
  source_url text,
  rank_score integer not null default 0,
  mx_verified boolean,
  created_at timestamptz not null default now()
);
create index if not exists idx_brand_contacts_owner_deal on public.brand_contacts (owner_id, deal_id);
create unique index if not exists idx_brand_contacts_deal_email on public.brand_contacts (deal_id, lower(email));
