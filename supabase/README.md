# DealRate — Supabase setup

## Apply the schema

1. In the Supabase Dashboard, open your project, then go to **SQL Editor**.
2. Open `supabase/schema.sql` in this repo, copy the whole file, paste it
   into the SQL Editor, and click **Run**.

## Verify

In the SQL Editor, run:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles', 'calculations', 'brands', 'deals', 'invoices',
    'reminders', 'pro_payments', 'manual_payments', 'settings'
  )
order by table_name;
```

All 9 tables must be listed. Then confirm the singleton settings row:

```sql
select id, plan, inr_rate, payment_mode from settings;
```

It must return exactly one row: `id = 1`, `plan = 'free'`,
`inr_rate = 83.5`, `payment_mode = 'automatic'`. The seed `INSERT` at the
end of `schema.sql` creates this row; the server also creates it on first
read if it is ever missing. Never create a second settings row.

## Notes

- The app starts with **empty** tables. The owner's pre-public rows stay
  in the Muse artifact and are **not** migrated by this script.
- Row Level Security is intentionally **not** enabled: the API server
  enforces per-user ownership with the service-role key plus its own
  verified-user checks. Do not enable RLS without also adding policies,
  or the API will break (see the header comment in `schema.sql`).
- No secret values are stored in the database or in this repo. API keys
  live only in environment variables (see `.env.example`).
