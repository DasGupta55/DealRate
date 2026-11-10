-- AI Brand Research — add research storage to the deals table.
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor →
-- New query → paste → Run). It is safe to run again: the columns are
-- only added when they do not exist yet.
alter table public.deals
  add column if not exists research_json jsonb,
  add column if not exists research_checked_at timestamptz;
