# DealRate — public website

DealRate (Brand Pricing Tool v2) as a standalone public website, ready
to deploy for free. Same app as the preview: free price calculator
(YouTube-backed), brand finder, deal pipeline, AI pitches, invoices
with 30-day reminders, and Pro at ₹189/month or ₹1,399/year via
Razorpay Checkout (UPI, cards, netbanking, wallets) with instant Pro
activation.

**Read [`DEPLOY.md`](DEPLOY.md) for the full deployment guide.** The
short version — the steps only you can do:

## Your checklist

- [ ] **1. Supabase** — Apply `supabase/schema.sql` in the SQL Editor;
      set the Site URL and Redirect URLs to your Netlify address;
      publish the Google OAuth consent screen out of testing mode.
- [ ] **2. API keys** — Get the YouTube, Tavily, Groq, and Razorpay
      **test** keys (see `DEPLOY.md` Steps 2–3).
- [ ] **3. Netlify** — Push this folder to GitHub, import it into
      Netlify, and paste **all 14 env vars** from `.env.example` into
      Site settings → Environment variables (never in chat, never in
      code). Then deploy.
- [ ] **4. GitHub cron** — Add the `PUBLIC_URL` and `CRON_SECRET`
      repo secrets so the daily overdue check runs.
- [ ] **5. Test a UPI payment** — Buy the ₹189 plan with Razorpay's
      test UPI ID (`success@razorpay`) and confirm Pro turns on
      instantly.
- [ ] **6. Submit the website link to Razorpay** for live activation.
- [ ] **7. Swap in the live keys** — Replace the Razorpay test keys in
      Netlify env vars with the live keys and redeploy. No code change.

## Run it locally (optional)

```bash
npm install
cp .env.example .env   # fill in your keys; .env is never committed
npm run dev:server     # API on http://localhost:8787
npm run dev:client     # app on http://localhost:5173 (proxies /api to :8787)
```

## Layout

- `client/` — React 19 + Tailwind 4 app (Vite build → `client/dist`)
- `server/` — API routes, Razorpay webhook, overdue cron, dev server
- `netlify/functions/api.ts` — the single serverless function for `/api/*`
- `netlify.toml` — build/publish/functions + the `/api/*` redirect
- `supabase/schema.sql` — database schema (9 tables)
- `.github/workflows/overdue-check.yml` — daily 09:13 IST overdue check
- `.env.example` — every environment variable (placeholders only)
- `DEPLOY.md` — the full guide: Supabase, keys, Netlify, webhook,
  testing, going live, troubleshooting
