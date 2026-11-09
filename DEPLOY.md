# DealRate — Deployment Guide (public website)

DealRate (Brand Pricing Tool v2) as a standalone public website. Free
$0 stack: **Netlify** (hosting + serverless API), **Supabase**
(Auth + Postgres), **GitHub Actions** (daily overdue-invoice check).
No code changes are needed to go live — only accounts, keys, and
environment variables.

> **The one thing to remember:** this site is not live until YOU do the
> steps below. No keys are stored in this folder, and nothing here is
> deployed yet. The Razorpay gateway switches on only when the test keys
> are in Netlify's environment variables (Step 5).

---

## What you need before you start

| Thing | Where to get it | Free? |
|---|---|---|
| A GitHub account | github.com | Yes |
| A Netlify account | netlify.com (sign up with GitHub) | Yes |
| A Supabase project | see Step 1 — reuse the existing one if you can | Yes |
| YouTube API key | Google Cloud Console | Yes (10,000 units/day) |
| Tavily API key | tavily.com | Yes (free tier) |
| Groq API key | console.groq.com | Yes (free tier) |
| Razorpay **test** keys | Razorpay Dashboard → Test mode | Yes |

You do **not** need a domain name to start — Netlify gives you a free
`https://something.netlify.app` address. You can add your own domain
later.

---

## Step 1 — Supabase (database + login)

**Reuse the existing project if you can.** The app was already set up
against a Supabase project (`https://athtnktzxtmtaquvpmvl.supabase.co`)
with Google sign-in configured. Reusing it means the Google login
setup stays as it is — you only point it at the new website address.

1. Open the Supabase Dashboard and open that project (or create a new
   free project if you prefer a fresh start).
2. Go to **SQL Editor → New query**, paste the whole contents of
   `supabase/schema.sql` from this folder, and press **Run**. It creates
   the 9 tables (`profiles`, `calculations`, `brands`, `deals`,
   `invoices`, `reminders`, `pro_payments`, `manual_payments`,
   `settings`) and seeds the settings row. The app starts with **empty**
   tables — the old rows from the Muse preview are not copied over.
3. Check it worked: **Table Editor** should list the 9 tables, and
   `settings` should have one row (`id = 1`, `plan = free`,
   `payment_mode = automatic`).
4. Go to **Project Settings → API** and copy three values (you will
   paste them into Netlify in Step 5, never into chat or code):
   - **Project URL** → `SUPABASE_URL` (and `VITE_SUPABASE_URL`)
   - **Legacy anon public key** (starts with `eyJ`) → `SUPABASE_ANON_KEY`
     (and `VITE_SUPABASE_ANON_KEY`). If you only see the new
     `sb_publishable_` key, go to **API Keys → View legacy API keys →
     anon public**.
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`. This one is
     **server-only**: it goes in Netlify's environment variables and
     nowhere else. Never paste it into the app, a chat, or a repo file.
5. Go to **Authentication → URL Configuration** and set:
   - **Site URL** → your Netlify address, e.g.
     `https://dealrate.netlify.app`
   - **Redirect URLs** → add `https://dealrate.netlify.app/**`
   (Use your real Netlify address from Step 4.)
6. Go to **Authentication → Providers → Google** and confirm it is
   **enabled** with the Client ID and Secret already filled in (they
   were set up before). Nothing to change here if you reuse the project.

**Google OAuth client (one-time, in Google Cloud Console):** the Google
sign-in only works for everyone once the OAuth consent screen is
**published out of testing mode**. In Google Cloud Console → **APIs &
Services → OAuth consent screen**, press **Publish app**. Until then,
only the test users listed there can sign in. The Authorized redirect
URI stays `https://<your-project>.supabase.co/auth/v1/callback` — do
not change it.

---

## Step 2 — API keys (YouTube, Tavily, Groq)

- **YouTube** — Google Cloud Console → enable **YouTube Data API v3** →
  **Credentials → Create API key**. The app only fetches public channel
  data (3 units per fetch, never the expensive search API). Copy the key
  → `YOUTUBE_API_KEY`.
- **Tavily** — tavily.com → sign up → copy the API key →
  `TAVILY_API_KEY`. (The brand finder uses Tavily because Brave's terms
  forbid storing search results.)
- **Groq** — console.groq.com → **API Keys → Create** → copy the key →
  `GROQ_API_KEY`. (The app writes pitch emails with Groq's
  `gpt-oss-120b` model.)

---

## Step 3 — Razorpay test keys (for the payment test)

1. Open the Razorpay Dashboard and make sure you are in **Test mode**
   (the toggle at the top).
2. Go to **Settings → API Keys → Generate Test Key** (or copy the
   existing test keys). You need two values:
   - **Key ID** (starts with `rzp_test_…`) → `RAZORPAY_KEY_ID`
   - **Key Secret** → `RAZORPAY_KEY_SECRET`
3. Go to **Settings → Webhooks → Add New Webhook** and set:
   - **Webhook URL** → `https://<your-site>.netlify.app/api/webhooks/razorpay`
   - **Active events** → tick **`payment.captured`** only
   - Copy the **Webhook Secret** it shows → `RAZORPAY_WEBHOOK_SECRET`
   (Razorpay needs this to prove the webhook really came from Razorpay.
   Without it, the site rejects the webhook and Pro is not switched on
   by the webhook — the checkout callback still works when the buyer
   keeps the app open.)
4. Test keys move **no real money**. They are only for proving the
   checkout works. Live keys come later (Step 8).

---

## Step 4 — Put the code on Netlify

1. Push this folder to a **new GitHub repository** (private is fine).
   Do **not** commit a `.env` file — copy `.env.example` to `.env`
   only on your own computer for local testing, and keep `.env` out of
   git (it is already in `.gitignore` if one exists; if not, do not add
   it).
2. In Netlify: **Add new site → Import an existing project** → pick the
   GitHub repo.
3. Build settings (Netlify usually detects them from `netlify.toml`,
   but check):
   - **Build command:** `npm run build`
   - **Publish directory:** `client/dist`
   - **Functions directory:** `netlify/functions`
4. **Before the first deploy**, set the environment variables (Step 5)
   — the `VITE_*` values are baked into the site at build time, so
   they must be set before you deploy (or deploy again after setting
   them).

Your site will be live at a free address like
`https://dealrate.netlify.app`. That address is the **website link**
Razorpay asks for (Step 8).

---

## Step 5 — Environment variables (Netlify)

In Netlify: **Site settings → Environment variables → Add a variable**.
Add all of these (values come from Steps 1–3). Scope: **All scopes**
(or Production + Functions — the server functions must see the
server-only ones).

| Variable | Where it comes from | Who sees it |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Server |
| `SUPABASE_ANON_KEY` | Supabase → legacy anon public key (`eyJ…`) | Server + build |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → service_role key | **Server only — never in the app or chat** |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` | Baked into the site at build time |
| `VITE_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` | Baked into the site at build time |
| `VITE_API_URL` | Leave **empty** (same-origin: the API lives on the same Netlify site) | Build |
| `YOUTUBE_API_KEY` | Google Cloud → YouTube Data API v3 key | Server only |
| `TAVILY_API_KEY` | tavily.com | Server only |
| `GROQ_API_KEY` | console.groq.com | Server only |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Test mode → Key ID (`rzp_test_…`) | Server + checkout popup (it is public) |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Test mode → Key Secret | **Server only** |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Webhooks → your webhook's secret | **Server only** |
| `PUBLIC_URL` | Your Netlify address, e.g. `https://dealrate.netlify.app` (no trailing `/`) | Server |
| `CRON_SECRET` | **Make one up** — any long random string, e.g. 32 random letters/numbers. Use the **same** value in GitHub (Step 6). | Server + GitHub Actions |

After adding or changing any variable, **redeploy** the site
(Netlify → Deploys → Trigger deploy) so the new values take effect.

---

## Step 6 — Daily overdue-invoice check (GitHub Actions)

The file `.github/workflows/overdue-check.yml` is already in the repo.
It runs every day at 09:13 IST and calls the site's cron endpoint.

1. In the GitHub repo: **Settings → Secrets and variables →
   Actions → New repository secret**. Add two secrets:
   - `PUBLIC_URL` → your Netlify address
     (e.g. `https://dealrate.netlify.app`)
   - `CRON_SECRET` → the **same** random string you put in Netlify
2. You can test it immediately: **Actions → Overdue invoice check →
   Run workflow**.

---

## Step 7 — Test the site (before telling anyone about it)

1. Open the site. The **calculator works without signing in**.
2. **Sign in with Google** (use the account you want as the owner).
   If sign-in fails, check Step 1 points 5–6 (Site URL / Redirect
   URLs) and that the Google consent screen is published.
3. **Test a UPI payment:** go to **Plan → Buy now (₹189/month)**.
   The Razorpay popup opens — pay with Razorpay's **test UPI ID**
   (`success@razorpay`) or a test card from Razorpay's test docs.
   - Pro should turn on **immediately** after the payment succeeds
     (check **My account** — plan, start date, expiry date, days left).
   - The payment should appear as a **paid invoice** on the Invoices tab.
   - If the popup says **"Pro opens soon"**, the Razorpay keys are not
     in Netlify's env vars yet (Step 5) — or the site needs a redeploy
     after you added them.
4. **Test the webhook:** in the Razorpay Dashboard → **Webhooks**,
   check the webhook shows a delivered `payment.captured` event. Then
   close the app right after paying once and confirm Pro still turns
   on — that proves the webhook path works.
5. **Test the manual fallback:** on the Owner screen, switch the
   payment mode to **manual** — Upgrade should open the Razorpay.me
   link instead. Switch it back to **automatic** when done.
6. **Test the demo account:** sign out, tap **Reviewer demo sign-in**,
   username `reviewer`, password `BPT-Demo-2026`. You should be able to
   browse but **not** save, buy, or send anything.

---

## Step 8 — Submit the link to Razorpay, then go live

1. Give Razorpay the website link: your Netlify address
   (e.g. `https://dealrate.netlify.app`). This is what they asked for
   to finish **live activation**.
2. When Razorpay finishes activation and gives you **live keys**:
   - In the Razorpay Dashboard, switch to **Live mode** and copy the
     live Key ID (`rzp_live_…`) and live Key Secret.
   - In Netlify, replace `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
     with the live values, and update `RAZORPAY_WEBHOOK_SECRET` to the
     live webhook's secret (create a live-mode webhook with the same
     URL if needed).
   - **Redeploy** the site. No code change is needed — the same code
     reads the new keys from the environment.
3. Do one real ₹189 test purchase yourself (or ask a friend) to prove
   live payments work end to end, then refund it if you like from the
   Razorpay Dashboard.

**Money:** when a customer pays, Razorpay takes the money first and
settles it to the bank account linked to your Razorpay account
(standard: 2 working days for domestic payments, UPI often 1 day;
about 2% + GST fee). The app never touches the money.

---

## Troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| Upgrade shows **"Pro opens soon"** | Razorpay keys missing in Netlify env vars, or the site was not redeployed after adding them | Step 5, then redeploy |
| Google sign-in fails / goes to the wrong address | Supabase Site URL or Redirect URLs still point at the old address | Step 1 points 5–6 |
| Google sign-in says the app is in testing / "access blocked" | OAuth consent screen not published | Publish it (Step 1, Google Cloud Console) |
| Payment succeeds but Pro does not turn on | Keys are test keys but the site is in live mode, or vice versa; or the webhook secret is wrong | Check the key mode matches, and the webhook secret in Step 3 |
| Webhook shows "failed" in Razorpay | Webhook URL or secret wrong | Step 3: URL must be `https://<site>/api/webhooks/razorpay`, secret must match |
| API returns "database is not configured" | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing in Netlify, or `schema.sql` not applied | Step 1 points 2–4, Step 5 |
| Overdue check never runs | GitHub secrets missing | Step 6 |
| Brand search returns nothing | `TAVILY_API_KEY` missing | Step 5 |
| Pitch generation fails | `GROQ_API_KEY` missing | Step 5 |
| YouTube fetch fails | `YOUTUBE_API_KEY` missing or the API not enabled | Step 2 |

---

## Costs (free tiers)

- **Netlify free:** $0 (free subdomain, 100 GB bandwidth/month, 125k
  function calls/month — far above what this app needs at launch).
- **Supabase free:** $0 (Auth + Postgres, with free-tier limits).
- **GitHub Actions:** $0 for public repos; free minutes for private repos.
- **YouTube / Tavily / Groq:** free tiers as linked above.
- **Razorpay:** no monthly fee; about 2% + GST per successful payment.

---

## Security notes (read once)

- The **service_role key, Razorpay Key Secret, and webhook secret**
  are server-only. They live in Netlify's environment variables and
  are never in this repo, never in the app's code, and never in chat.
- The **anon key** (`eyJ…`) is public by design — it is safe in the
  browser. It is set through the `VITE_SUPABASE_ANON_KEY` env var (or
  the Owner screen), not hardcoded in the code.
- Sign-in is **Google-only** and creates a **free account only** — Pro
  starts only after a verified Razorpay payment. The demo reviewer
  account (`reviewer` / `BPT-Demo-2026`) is read-only by design.
- If any secret ever leaks (pasted somewhere public), **rotate it**
  immediately in the provider's dashboard and update the Netlify env
  var — do not just delete the message.

---

## What is in this folder

- `client/` — the React app (same screens, copy, prices, and design as
  the preview). Build: `npm run build -w client`.
- `server/` — the API (30 actions as HTTP routes, Razorpay webhook,
  overdue cron, dev server on port 8787). Typecheck:
  `npm run typecheck -w server`.
- `netlify/` — the single serverless function (`api.ts`) that serves
  `/api/*`, the webhook, and the cron.
- `supabase/schema.sql` — the database schema (apply once, Step 1).
- `.github/workflows/overdue-check.yml` — the daily cron (Step 6).
- `.env.example` — every environment variable, with placeholders.
- `netlify.toml` — build, publish, functions, and the `/api/*` redirect.
