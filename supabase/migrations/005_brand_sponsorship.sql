-- 005: Global Brand Finder — sponsorship evidence on brands.
-- Run once in the Supabase SQL Editor. Idempotent: safe to run
-- again; existing rows are untouched.
--
-- hq_country / classification / creator_market / industry /
-- evidence_json carry the Brand Finder's sponsorship discovery:
-- where the brand is headquartered, how strong its paid
-- sponsorship evidence is (verified_paid, active_program,
-- international_paid, potential, affiliate_only), which creator
-- market it was found for, and the evidence behind it
-- (evidence sentence, example creator/campaign, platform, date,
-- evidence URL, partnership page URL).
-- is_agency marks creator agencies & marketplaces, which are shown
-- separately from direct brand sponsorships.

alter table brands add column if not exists hq_country text;
alter table brands add column if not exists classification text;
alter table brands add column if not exists creator_market text;
alter table brands add column if not exists industry text;
alter table brands add column if not exists evidence_json jsonb;
alter table brands add column if not exists is_agency boolean not null default false;

create index if not exists brands_owner_niche_market_idx
  on brands (owner_id, niche, creator_market);
