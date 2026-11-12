import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "./components/SafeAreaTopScrim";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Toaster, toast } from "sonner";
import { api, type ApiResponse } from "./api";
import { getGoogleProviderRefreshToken, getGoogleProviderToken, getSupabaseClient, preloadSupabaseLibrary, requestGmailReadScope, requestGmailSendScope, resetSupabaseClient, DEFAULT_SUPABASE_URL } from "./supabase";

type Dash = ApiResponse<typeof api, "getDashboard">;
type Deal = Dash["deals"][number];
type Invoice = Dash["invoices"][number];

const COUNTRY_CPM: Record<string, number> = {
  US: 28, UK: 24, Canada: 24, Australia: 22, Germany: 20, UAE: 18,
  Global: 15, Brazil: 9, India: 6, Philippines: 6, Indonesia: 5,
  Pakistan: 4, Bangladesh: 4,
};
const NICHE_MULT: Record<string, number> = {
  Finance: 1.8, Tech: 1.6, Business: 1.6, Education: 1.4, Beauty: 1.2,
  Fitness: 1.2, Fashion: 1.1, Travel: 1.1, Food: 1.0, "Lifestyle / Vlog": 1.0,
  "Comedy / Entertainment": 0.9, Gaming: 0.85, Music: 0.8,
};
const DELIVERABLES = [
  { key: "dedicated", label: "Dedicated video", mult: 1.0 },
  { key: "integration", label: "60–90s integration", mult: 0.55 },
  { key: "short", label: "Short / Reel", mult: 0.35 },
  { key: "post", label: "Community post", mult: 0.15 },
];
const STAGES = [
  { key: "prospect", label: "Prospect" },
  { key: "pitch_ready", label: "Pitch ready" },
  { key: "pitched", label: "Pitched" },
  { key: "reply_received", label: "Reply received" },
  { key: "negotiating", label: "Negotiating" },
  { key: "approved", label: "Approved" },
  { key: "content_production", label: "Content in production" },
  { key: "content_submitted", label: "Content submitted" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
  { key: "lost", label: "Lost" },
];

/* ================= OWNER CONFIG — edit everything here =================
   The owner's own setup values, in ONE place at the top of the code.
   These ship inside the app itself, so every user's phone has them —
   nothing here depends on one device's storage. The Owner screen
   (visible only to OWNER_EMAIL) can edit saved fallbacks, but a value
   filled in here always wins.

  - supabaseAnonKey: intentionally EMPTY here. The legacy anon public
    key (starts with eyJ) comes from the VITE_SUPABASE_ANON_KEY
    build-time env var, or from the saved settings the owner pastes
    on the Owner screen. NEVER hardcode a key here, and NEVER put
    the service_role / secret key anywhere in the app.
   - inrRate: USD → INR rate used to convert calculator prices into
     ₹ (the app is INR-only; this is one fixed editable rate in this
     config, not a live feed). Pro payments do NOT use static links
     any more: "Buy now" creates a Razorpay Order on the backend,
     which reads its amount from the server's own price config. */
export const OWNER_EMAIL = "iampartha160920@gmail.com";
export const OWNER_CONFIG = {
  supabaseUrl: "https://athtnktzxtmtaquvpmvl.supabase.co",
  supabaseAnonKey: "",
  inrRate: 83.5,
} as const;

/* ================= BUSINESS CONFIG — the real business details =================
   Every business value the public pages and the
   manual payment flow need, in ONE place — the owner's real values,
   used on every page and footer. Nothing here is
   a secret: these values are meant to be public (they appear on
   the public pages). To change any of them later, edit here and
   every page picks the new value up automatically.

   - productName: the product name shown across the app (DealRate).
   - supportEmail: the support/contact email shown on the Contact
     page, the support row and the footers. This is NOT the owner
     sign-in: the owner/admin gate stays OWNER_EMAIL above.
   - razorpayMeLink: the owner's real Razorpay.me payment page.
     Manual (Phase 1) payments open this link. */
export const BUSINESS_CONFIG = {
  businessName: "Partha Das Gupta (Individual)",
  productName: "DealRate",
  businessAddress: "Samaguri, Nagaon, Assam, 782140, India",
  businessPhone: "+91 8822775592",
  supportEmail: "mynameisparthadasgupta@gmail.com",
  whatsappNumber: "+91 8822775592",
  razorpayMeLink: "https://razorpay.me/@parthadasgupta1014",
} as const;

/* ================= DEMO LOGIN — for the Razorpay reviewer =================
   The app signs users in with Google only, by design, so the
   reviewer demo is a local demo sign-in in the sign-in sheet: these
   credentials open a read-only demo session (id "demo-reviewer")
   that can browse the calculator, the Plan and pricing, and every
   public page, but can never save data, buy Pro or send anything —
   the server treats the demo id as a public namespace and rejects
   it in every account action. The owner can change the password
   here, or disable the demo by emptying the password. */
export const DEMO_LOGIN = {
  username: "reviewer",
  password: "BPT-Demo-2026",
  displayName: "Demo Reviewer",
  emailLabel: "reviewer@demo.local",
} as const;

/* ================= INFO PAGES — edit the wording here =================
   The eight public pages (About, Pricing, Contact, Terms, Privacy,
   Cancellation and Refunds, Shipping, Disclaimer). No login is
   needed to read them: they are linked from the footer on every
   screen and the upgrade screen, and each one has its own deep-link address in the app
   (the app address plus #/terms, #/privacy, #/shipping, #/contact
   or #/refund) that opens straight on that page, signed out or not.
   Business name, address, phone and email come from BUSINESS_CONFIG
   above — every page shows the business name, and the line under
   each page shows the name, address, phone and email. The prices
   written on the Pricing page are the PRICING values below, typed
   out in full sentences — if PRICING ever changes, update the
   Pricing page text to match. */
export type InfoPageKey = "about" | "pricing" | "contact" | "terms" | "privacy" | "refund" | "shipping" | "disclaimer";
const SHIPPING_NOTE = "Digital product, activated instantly after payment. No physical shipping.";
export const INFO_PAGES: Record<InfoPageKey, { title: string; paragraphs: string[] }> = {
  about: {
    title: "About Us",
    paragraphs: [
      `${BUSINESS_CONFIG.businessName} runs ${BUSINESS_CONFIG.productName}, a simple tool for YouTube creators in India. Most creators do not know what to charge a brand, so brands decide the price for them. Our tool fixes that.`,
      "You enter your channel, and the tool reads your real views and engagement from YouTube. It then works out a fair price range for a brand deal, using a clear formula that you can see and change. No random numbers.",
      "With Pro, you can also find brands that fit your audience, send pitches from your own Gmail, track every deal from first pitch to final payment, and create invoices with automatic payment reminders.",
      `${BUSINESS_CONFIG.productName} is a digital product from a small Indian digital business — there is nothing to ship, and your Pro plan starts on your account as soon as your payment is confirmed.`,
      `You can reach us any time at ${BUSINESS_CONFIG.supportEmail}.`,
    ],
  },
  pricing: {
    title: "Pricing",
    paragraphs: [
      `You can use ${BUSINESS_CONFIG.productName} in two ways. Both plans are shown here in full — you do not need an account to read this page.`,
      "Free — ₹0. The price calculator and the live YouTube channel fetch are free for everyone, with no account. If you sign in with Google (a free account), you can also save your rate cards. Signing in never turns Pro on.",
      `Pro Monthly — ₹189 for 30 days (full price ₹399). Pro Annual — ₹1,399 for 365 days (full price ₹4,788), which works out to ₹117 per month.`,
      "Pro adds the brand finder with live web search, pitches sent from your own Gmail, the full deal pipeline from pitch to paid, and invoices with 30-day payment reminders.",
      "Pro plans are one-time, fixed-term passes. There is no auto-renewal and we never charge your card again on our own. When a pass ends, your account returns to Free and you keep your saved rate cards. You can buy a new pass any time.",
      "Payments are made through Razorpay — UPI, cards, netbanking and wallets are accepted. Pro starts only after your payment is verified, never on sign-in alone.",
      SHIPPING_NOTE,
      "If Pro is not right for you, our Cancellation and Refund Policy gives you a 7-day money-back window — please read that page before you pay.",
    ],
  },
  contact: {
    title: "Contact Us",
    paragraphs: [
      `${BUSINESS_CONFIG.businessName} — questions, feedback, payment help or a refund request, we reply to every email.`,
      `Email: ${BUSINESS_CONFIG.supportEmail}`,
      `Phone: ${BUSINESS_CONFIG.businessPhone}`,
      `Address: ${BUSINESS_CONFIG.businessAddress}`,
      "For payment questions, please write from the same email address you use in the app, and mention your Razorpay payment ID if you have one. That helps us find your payment quickly.",
    ],
  },
  terms: {
    title: "Terms and Conditions",
    paragraphs: [
      `These terms are between you and ${BUSINESS_CONFIG.businessName}, the business that runs ${BUSINESS_CONFIG.productName}. By using the app, you accept them.`,
      "The price calculator gives an estimate based on the numbers you enter and the assumptions shown in the app. It is a guide for negotiation, not a guaranteed market price, and it does not promise that any brand will agree to that price.",
      "Signing in with Google creates a free account, which lets you save your rate cards. Pro adds the brand finder, the deal pipeline and invoices, and starts only after a verified Razorpay payment — signing in never turns Pro on by itself.",
      "Pro is sold as a fixed-term pass: Monthly lasts 30 days and Annual lasts 365 days from the day your payment is confirmed. There is no auto-renewal. When the pass ends, your account returns to the Free plan and you keep your saved rate cards.",
      "You are responsible for the emails you send and for the deals you agree with brands. Please do not use the app to send spam or to break any law.",
      SHIPPING_NOTE,
      "We may update the app and these terms from time to time. The version shown in the app is the current one.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    paragraphs: [
      `${BUSINESS_CONFIG.businessName} runs ${BUSINESS_CONFIG.productName}. This page explains, in simple words, what data we collect, why we collect it, and how we use it.`,
      "What we collect when you sign in: when you sign in with Google, we receive your name, email address and profile photo from Google. That Gmail is also the address your pitch and invoice drafts are sent from — the app prepares ready-to-send drafts, and you send them from your own Gmail.",
      "What we collect when you use the tool: the rate cards you save, the brands and deals you add, the invoices you create, and the channel stats fetched from the public YouTube Data API for the channel you ask about. Nothing private about a channel is fetched.",
      "What we collect when you pay: we store your plan, the amount, the date and your Razorpay payment ID, so we can switch Pro on and show your payment history. Payments themselves are handled by Razorpay. We never see or store your card number, UPI PIN or bank details.",
      "Why we collect it and how we use it: only to run your account — to show your rate, save your work, switch Pro on after a verified payment, and help you when you write to us. We do not sell your data, and we do not share it with advertisers.",
      "Your data is stored against your own account, so only you can see it. You can delete your account and all of your data from Settings in the app (tap your profile photo, then Settings) at any time, or email us and we will remove it.",
      `Questions about your data: write to ${BUSINESS_CONFIG.supportEmail} and we will help.`,
    ],
  },
  refund: {
    title: "Cancellation and Refund Policy",
    paragraphs: [
      `${BUSINESS_CONFIG.productName} Pro is a digital product. There are no physical goods, so there are no returns and nothing to ship back to us.`,
      "How to cancel the ₹189/month plan: open the app, tap your profile photo (top right), choose Manage subscription, and tap Cancel Pro on the Plan page. The same steps cancel the ₹1,399/year plan.",
      "What happens when you cancel: your Pro access stays on until the end of the period you already paid for (30 days for Monthly, 365 days for Annual), expiry reminders stop, and nothing is refunded automatically. Pro plans never auto-renew, so cancelling is never urgent — no further payment is ever taken on its own, and your account simply returns to Free when the paid period ends. Cancelling never deletes your saved rate cards, brands, deals or invoices.",
      "7-day money-back: if Pro is not right for you, ask for a refund within 7 days of your payment and we will refund the full amount — no questions asked.",
      `To ask, email ${BUSINESS_CONFIG.supportEmail} from the email address on your account, and mention your Razorpay payment ID and payment date so we can find your payment.`,
      "Approved refunds are processed in 5 to 7 business days. The money goes back to the original payment method through Razorpay; after that, your bank may take a little more time to show it.",
      "After the 7 days, payments are not refundable.",
      "If a payment was ever taken twice by mistake, tell us and we will refund the duplicate in full at any time.",
      SHIPPING_NOTE,
    ],
  },
  shipping: {
    title: "Shipping Policy",
    paragraphs: [
      `${BUSINESS_CONFIG.productName} is a digital product. ${BUSINESS_CONFIG.businessName} sells no physical goods, so nothing is packed, posted or couriered — no physical goods are shipped, ever. There is no shipping charge, no delivery address is collected, and there is no parcel to track.`,
      "Delivery means activation on your account. As soon as your Razorpay payment is confirmed, your Pro plan (Monthly, 30 days, or Annual, 365 days) is switched on inside the app and you can use every Pro feature straight away — there is nothing to wait for and nothing arrives by post or courier.",
      "You pay inside the app through Razorpay Checkout — UPI, cards, netbanking or wallets. As soon as Razorpay confirms the payment and it is verified, Pro is activated on your account automatically.",
      `If a payment has gone through but Pro is not active on your account, email ${BUSINESS_CONFIG.supportEmail} with your Razorpay payment ID and we will activate it or refund you under the Cancellation and Refund Policy.`,
    ],
  },
  disclaimer: {
    title: "Disclaimer",
    paragraphs: [
      `The prices ${BUSINESS_CONFIG.productName} suggests are estimates. They are worked out from the numbers you enter — your average views, engagement, audience country, niche and deliverable — using a formula shown in the app.`,
      "An estimate is not a promise. It does not guarantee that a brand will pay that amount, that you will get a deal, or that you will earn any income. Every brand has its own budget, and the final price is always decided by negotiation between you and the brand.",
      "Use the estimate as a strong starting point for your negotiation, not as a fixed market rate.",
      `${BUSINESS_CONFIG.businessName} is not responsible for deals you agree with brands or for payments between you and a brand.`,
    ],
  },
};

/* Each public page has its own address inside the app: the app URL
   plus #/about, #/pricing, #/contact, #/terms, #/privacy, #/refund,
   #/shipping or #/disclaimer. Opening the app with one of those
   addresses lands straight on that page — no login, no navigation —
   which is how the pages are linked for Razorpay's review while the
   app is still a single-address web app. (A public website with its
   own domain gets real /terms-style paths when the app is deployed
   standalone; inside Muse this hash address is the page's URL.)
   Only an exact "#/key" hash counts — the Supabase sign-in return
   also uses the hash (access tokens), and those hashes never match
   this pattern, so sign-in is untouched. */
function infoPageFromHash(): InfoPageKey | null {
  try {
    const m = window.location.hash.match(/^#\/([a-z]+)$/);
    const key = m?.[1];
    if (key && key in INFO_PAGES) return key as InfoPageKey;
  } catch { /* no window — not a browser */ }
  return null;
}
function setInfoPageHash(page: InfoPageKey | null) {
  try {
    if (page) {
      /* Plain fragment assignment, not history.replaceState: the
         app runs in a sandboxed frame where the history API can be
         blocked, while fragment navigation is always allowed. No
         element carries these ids, so setting the hash never
         scrolls the page; it does fire hashchange, which the App's
         listener answers by opening the same page — a no-op. */
      if (window.location.hash !== `#/${page}`) window.location.hash = `#/${page}`;
      return;
    }
    if (!infoPageFromHash()) return;
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      window.location.hash = "";
    }
  } catch { /* location unavailable — the in-app navigation still works */ }
}

/* ================= PRO PRICING (INR ONLY) — edit prices here =================
   The single editable price list for the Pro plan, in rupees. The
   backend keeps its own copy (PRO_PRICING_INR in server actions) and
   checkout amounts ALWAYS come from the backend copy, never from
   this file — this list only drives what the Plan screen displays.
   "% off" and per-month amounts are calculated from these numbers,
   never typed by hand. Prices never change on their own. */
const PRICING = {
  monthly: { price: 189, was: 399 },
  annual: { price: 1399, was: 4788 },
} as const;

/* The app is INR-only: no currency toggle, no auto-detection, no
   conversion of Pro prices. (Deals and brand invoices keep whatever
   currency the user saved on that record — that is their data, not
   app pricing.) */
type DisplayCurrency = "INR";



/* The ONE money formatter for the whole app — Plan prices, button
   text, badges, invoices and calculator results all go through here.
   INR renders with no decimals; USD keeps cents when
   the amount has them and drops them for whole-dollar
   amounts. Symbols and grouping come from Intl, never hand-typed. */
function formatMoney(amount: number, currency: string): string {
  const code = currency === "INR" ? "INR" : "USD";
  return new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: code === "INR" ? 0 : 2,
    maximumFractionDigits: code === "INR" ? 0 : 2,
  }).format(amount);
}
/* Money whose base value is USD (calculator results, CPMs): converts
   to the display currency, then formats through formatMoney. */
function moneyFromUsd(usd: number, currency: DisplayCurrency, inrRate: number): string {
  return formatMoney(currency === "INR" ? usd * inrRate : usd, currency);
}
function percentOff(price: number, was: number): number {
  return Math.round((1 - price / was) * 100);
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function engagementFactor(pct: number): number {
  return Math.min(1.5, Math.max(0.75, 1 + (pct - 3) * 0.08));
}

// The OAuth return address: always the exact page the user is on right
// now (origin + path only — no hash or query, where a previous sign-in
// attempt may have left tokens behind). Never hard-code an address and
// never fall back to a default: Supabase's own default Site URL is
// http://localhost:3000, and when the redirect sent here doesn't match
// the project's Site URL / allowed Redirect URLs, Supabase sends the
// user there instead — the "localhost refused to connect" dead end.
// Plan & Settings shows this exact address so the owner can paste it
// into Supabase as both the Site URL and an allowed Redirect URL.
function appRedirectUrl(): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function emlFor(draft: { toEmail: string; subject: string; body: string }, fromEmail: string | null): string {
  return [
    fromEmail ? `From: ${fromEmail}` : null,
    `To: ${draft.toEmail}`,
    `Subject: ${draft.subject}`,
    ``,
    draft.body,
  ].filter((l) => l !== null).join("\n");
}

function downloadHtmlFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A designed, print-friendly invoice document (standalone HTML).
 *  White background so it prints cleanly; the DealRate wordmark and
 *  lime accent carry the brand. The status stamp never implies paid:
 *  PAID only when the invoice is actually paid, OVERDUE only when a
 *  sent invoice is past its due date, otherwise SENT or DRAFT. */
function invoiceHtml(inv: Invoice, fromEmail: string | null): string {
  const paid = inv.status === "paid";
  const overdue = !paid && inv.status === "sent" && inv.daysOverdue > 0;
  const statusLabel = paid ? "PAID" : overdue ? "OVERDUE" : inv.status.toUpperCase();
  const statusClass = paid ? "paid" : overdue ? "overdue" : inv.status === "sent" ? "sent" : "draft";
  const amount = formatMoney(inv.amount, inv.currency);
  const desc = inv.description || "Content collaboration";
  const contactEmail = fromEmail && fromEmail !== BUSINESS_CONFIG.supportEmail ? fromEmail : null;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escHtml(inv.invoiceNumber)} — DealRate</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f4f2; color: #0a0a0f; font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { max-width: 720px; margin: 32px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.12); }
  .bar { height: 6px; background: #c8ff3d; }
  .inner { padding: 32px 36px 28px; }
  .brand { font-size: 15px; font-weight: 800; letter-spacing: .04em; }
  .brand span { color: #7c5cff; }
  h1 { margin: 18px 0 0; font-size: 34px; letter-spacing: -.02em; }
  .invno { margin-top: 4px; font-size: 15px; color: #55555e; }
  .stamp { display: inline-block; margin-top: 14px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
  .stamp.paid { background: #c8ff3d; color: #0a0a0f; }
  .stamp.sent { background: #eef0ff; color: #4b3fd6; }
  .stamp.draft { background: #f0f0ee; color: #55555e; }
  .stamp.overdue { background: #ffe3e3; color: #b3261e; }
  .parties { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 28px; }
  .parties > div { flex: 1 1 220px; }
  h2 { margin: 0 0 6px; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #8a8a93; }
  p { margin: 2px 0; font-size: 14px; line-height: 1.5; }
  .dates { display: flex; gap: 32px; margin-top: 26px; padding-top: 18px; border-top: 1px solid #ececee; font-size: 14px; }
  .dates b { display: block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a93; margin-bottom: 2px; }
  table { width: 100%; margin-top: 26px; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a93; padding: 0 0 8px; border-bottom: 2px solid #0a0a0f; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 14px 0; border-bottom: 1px solid #ececee; vertical-align: top; }
  .total td { border-bottom: none; padding-top: 16px; font-size: 18px; font-weight: 800; }
  .note { margin-top: 22px; font-size: 13px; color: #55555e; }
  footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #ececee; font-size: 12px; color: #8a8a93; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; max-width: none; border-radius: 0; box-shadow: none; }
  }
  @media (max-width: 560px) { .inner { padding: 24px 20px; } h1 { font-size: 28px; } }
</style>
</head>
<body>
  <div class="page">
    <div class="bar"></div>
    <div class="inner">
      <div class="brand">Deal<span>Rate</span></div>
      <h1>Invoice</h1>
      <div class="invno">${escHtml(inv.invoiceNumber)}</div>
      <span class="stamp ${statusClass}">${statusLabel}</span>
      <div class="parties">
        <div>
          <h2>From</h2>
          <p><strong>${escHtml(BUSINESS_CONFIG.businessName)}</strong></p>
          <p>${escHtml(BUSINESS_CONFIG.businessAddress)}</p>
          <p>${escHtml(BUSINESS_CONFIG.businessPhone)}</p>
          <p>${escHtml(BUSINESS_CONFIG.supportEmail)}</p>
          ${contactEmail ? `<p>${escHtml(contactEmail)}</p>` : ""}
        </div>
        <div>
          <h2>Billed to</h2>
          <p><strong>${escHtml(inv.brandName)}</strong></p>
          ${inv.brandEmail ? `<p>${escHtml(inv.brandEmail)}</p>` : ""}
        </div>
      </div>
      <div class="dates">
        <div><b>Issued</b>${escHtml(inv.issueDate)}</div>
        <div><b>Due</b>${escHtml(inv.dueDate)}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          <tr><td>${escHtml(desc)}</td><td>${escHtml(amount)}</td></tr>
        </tbody>
        <tfoot>
          <tr class="total"><td>Total</td><td>${escHtml(amount)}</td></tr>
        </tfoot>
      </table>
      <p class="note">Please process the payment by ${escHtml(inv.dueDate)}.${paid ? " Thank you — this invoice is paid." : " If anything is blocking it, just reply and we'll help."}</p>
      <footer>Powered by DealRate · dealrate.netlify.app</footer>
    </div>
  </div>
</body>
</html>`;
}

function SendsFrom({ data }: { data: Dash }) {
  if (data.senderConnected && data.senderEmail) {
    return (
      <p className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">
        <span className="inline-block h-2 w-2 flex-none rounded-full bg-[var(--accent)]" aria-hidden />
        <span className="min-w-0 [overflow-wrap:anywhere]">Sends from: {data.senderEmail}</span>
      </p>
    );
  }
  return (
    <p className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--amber)]">
      <span className="inline-block h-2 w-2 flex-none rounded-full bg-[var(--amber)]" aria-hidden />
      <span className="min-w-0">Mails go out from your Gmail. Never ours.</span>
    </p>
  );
}

const inputCls =
  "w-full min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[var(--text)] outline-none focus:border-[var(--accent)]";
const labelCls = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1.5";
const btnPrimary =
  "btn-press inline-flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-base font-bold text-[var(--accent-ink)] disabled:opacity-50";
/* Secondary actions get a soft lime tint, never solid lime — solid
   lime is reserved for the ONE main button on each screen and for
   money numbers. */
const btnSmall =
  "btn-press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/12 px-4 py-2 text-sm font-bold text-[var(--accent)] disabled:opacity-50";
const btnGhost =
  "btn-press inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50 active:bg-[var(--surface-alt)]";

/* ---------------- Icons (inline, Lucide-style strokes) ---------------- */

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const IconRupee = () => (
  <Icon>
    <path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" />
  </Icon>
);
const IconMegaphone = () => (
  <Icon>
    <path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </Icon>
);
const IconDeals = () => (
  <Icon>
    <path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" />
  </Icon>
);
const IconReceipt = () => (
  <Icon>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M14 8H8" /><path d="M16 12H8" /><path d="M13 16H8" />
  </Icon>
);
const IconCrown = () => (
  <Icon>
    <path d="m2 5 4.5 4L12 4l5.5 5L22 5l-1.8 11.2a2 2 0 0 1-2 1.8H5.8a2 2 0 0 1-2-1.8L2 5Z" /><path d="M5 21h14" />
  </Icon>
);
const IconCheck = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
const IconLock = () => (
  <Icon size={20}>
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);
const IconUser = () => (
  <Icon size={20}>
    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
  </Icon>
);
const IconChevronDown = () => (
  <Icon size={16}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
const IconSettings = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Icon>
);
const IconLogout = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </Icon>
);
/* The standard multi-colour Google "G" — used only inside the
   Google-branded button in the sign-in sheet, never recoloured. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden style={{ flex: "none", display: "block" }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/* ---------------- Button sounds (client/sound.js) ----------------
   sound.js is loaded from index.html and exposes window.playSound,
   window.isSoundMuted and window.toggleSoundMuted. These helpers call
   it defensively: if the script ever fails to load, the app behaves
   exactly as before, just silently. */
function sfx(name: "click" | "success" | "error" | "toggle") {
  try {
    (window as any).playSound?.(name);
  } catch { /* sound is a garnish — never break the UI */ }
}
function readSoundMuted(): boolean {
  try {
    if (typeof (window as any).isSoundMuted === "function") return !!(window as any).isSoundMuted();
  } catch { /* fall through to the stored choice */ }
  try {
    return window.localStorage.getItem("bpt-sound-muted") === "1";
  } catch {
    return false;
  }
}

const IconSoundOn = () => (
  <Icon size={19}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.6 5.4a9 9 0 0 1 0 13.2" />
  </Icon>
);
const IconSoundOff = () => (
  <Icon size={19}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" />
  </Icon>
);

/* Small speaker button in the header (top right): mutes / unmutes the
   button sounds. The choice itself lives in sound.js + localStorage;
   this button just reflects it and stays in sync through the
   "bpt-sound-muted-changed" event sound.js dispatches. It opts out of
   the automatic click sound (data-sound="none") and plays the toggle
   tick itself, only when unmuting — muting stays silent. */
function SoundMuteButton() {
  const [muted, setMuted] = useState<boolean>(() => readSoundMuted());
  useEffect(() => {
    setMuted(readSoundMuted());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ muted?: boolean }>).detail;
      setMuted(typeof detail?.muted === "boolean" ? detail.muted : readSoundMuted());
    };
    window.addEventListener("bpt-sound-muted-changed", onChange);
    return () => window.removeEventListener("bpt-sound-muted-changed", onChange);
  }, []);
  const toggle = () => {
    let next: boolean;
    try {
      if (typeof (window as any).toggleSoundMuted === "function") {
        next = !!(window as any).toggleSoundMuted();
      } else {
        next = !muted;
        try { window.localStorage.setItem("bpt-sound-muted", next ? "1" : "0"); } catch { /* non-fatal */ }
      }
    } catch {
      next = !muted;
    }
    setMuted(next);
    if (!next) sfx("toggle"); // a soft tick confirms sound is back on
  };
  return (
    <button
      type="button"
      data-sound="none"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? "Unmute button sounds" : "Mute button sounds"}
      className="btn-press flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--dim)]"
    >
      {muted ? <IconSoundOff /> : <IconSoundOn />}
    </button>
  );
}

/* One shared way to set the button-sound preference, so the header
   speaker button and the Settings toggle always agree: it uses
   sound.js when present (which dispatches the change event) and
   otherwise writes localStorage and dispatches the event itself. */
function setSoundMuted(next: boolean) {
  try {
    if (typeof (window as any).toggleSoundMuted === "function") {
      if (readSoundMuted() !== next) (window as any).toggleSoundMuted();
      return;
    }
  } catch { /* fall through to the stored choice */ }
  try { window.localStorage.setItem("bpt-sound-muted", next ? "1" : "0"); } catch { /* non-fatal */ }
  try { window.dispatchEvent(new CustomEvent("bpt-sound-muted-changed", { detail: { muted: next } })); } catch { /* non-fatal */ }
}

/* Premium account avatar: the Google profile photo when available,
   otherwise the user's initials (first letters of the first two
   name words, or the email's first letter). One component, so the
   header, the dropdown and Settings all show the same face. */
function initialsFor(name: string | null, email: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((email ?? "").trim().charAt(0) || "U").toUpperCase();
}

function UserAvatar({ name, email, avatarUrl, size = 38, className = "" }: {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}) {
  const px = `${size}px`;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className={`rounded-full object-cover ring-1 ring-white/10 ${className}`}
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center rounded-full bg-[var(--surface-alt)] font-bold text-[var(--text)] ring-1 ring-white/10 ${className}`}
      style={{ width: px, height: px, fontSize: Math.max(12, Math.round(size * 0.38)) }}
    >
      {initialsFor(name, email)}
    </span>
  );
}

/* Confetti burst for the first calculated price: lime / violet /
   white pieces thrown from the hero card, transform + opacity only.
   Deterministic per-piece offsets so it never needs Math.random. */
const CONFETTI_COLORS = ["#c8ff3d", "#7c5cff", "#f5f5f7", "#c8ff3d", "#7c5cff"];
function ConfettiBurst() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {Array.from({ length: 28 }).map((_, i) => {
        const angle = (i / 28) * Math.PI * 2 + (i % 5) * 0.22;
        const dist = 90 + ((i * 37) % 110);
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist * 0.72 + 46;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-[38%] block"
            style={{
              width: i % 3 === 0 ? 6 : 9,
              height: i % 3 === 0 ? 9 : 6,
              borderRadius: i % 4 === 0 ? "50%" : 2,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x, y, opacity: 0, rotate: (i % 2 === 0 ? 1 : -1) * (160 + (i % 5) * 60) }}
            transition={{ duration: 1.15, ease: [0.17, 0.67, 0.35, 1], delay: (i % 6) * 0.02 }}
          />
        );
      })}
    </div>
  );
}

/* ---------------- Motion helpers ----------------
   One motion system for the whole app (Motion springs, Apple-style:
   critically damped by default — duration + bounce, no overshoot on
   UI chrome; a whisper of bounce only on the nav pill, which follows
   the thumb). Entrances start from scale 0.97–0.99 + opacity, never
   scale(0); only transform and opacity animate; every entrance is
   interruptible because Motion re-targets springs from the current
   value. Reduced motion collapses movement to a short cross-fade. */

const SPRING_UI = { type: "spring", duration: 0.4, bounce: 0 } as const;
const SPRING_PILL = { type: "spring", duration: 0.45, bounce: 0.18 } as const;

function itemAnim(index: number, reduce: boolean | null) {
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.2, delay: Math.min(index, 6) * 0.03 },
    } as const;
  }
  return {
    initial: { opacity: 0, y: 12, scale: 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { ...SPRING_UI, delay: Math.min(index, 6) * 0.055 },
  } as const;
}

/* Animated money (calculator hero + quote range): the value counts
   up from 0 on first mount and eases to the new result whenever the
   inputs change, and every frame is rendered through the single
   formatMoney formatter — so a USD result like $829.06 keeps its
   cents and INR renders whole rupees, exactly like every other
   amount in the app. */
function AnimatedMoney({
  usd,
  currency,
  inrRate,
  className,
}: {
  usd: number;
  currency: DisplayCurrency;
  inrRate: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const target = currency === "INR" ? usd * inrRate : usd;
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);
  useEffect(() => {
    if (reduce) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;
    const start = performance.now();
    const duration = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      valueRef.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce]);
  return <span className={className}>{formatMoney(value, currency)}</span>;
}

/* Animated invoice amount: a stored amount in its own currency (no
   conversion), with the same count-up digit roll as the price. */
function AnimatedAmount({ amount, currency }: { amount: number; currency: string }) {
  const reduce = useReducedMotion();
  const target = currency === "INR" ? Math.round(amount) : amount;
  const [value, setValue] = useState(0);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (reduce) {
        setValue(target);
        return;
      }
      const raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    setValue(target);
  }, [target, reduce]);
  return (
    <NumberFlow
      value={value}
      locales={currency === "INR" ? "en-IN" : "en-US"}
      format={{
        style: "currency",
        currency: currency === "INR" ? "INR" : "USD",
        minimumFractionDigits: currency === "INR" ? 0 : 2,
        maximumFractionDigits: currency === "INR" ? 0 : 2,
      }}
      animated={!reduce}
    />
  );
}

/* Animated compact stat (subscribers, views, likes): same digit-roll
   treatment at card scale. */
function AnimatedCount({ value, suffix, plain }: { value: number; suffix?: string; plain?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <NumberFlow
      value={value}
      locales="en-US"
      format={
        plain
          ? { maximumFractionDigits: 2 }
          : { notation: "compact", maximumFractionDigits: 1 }
      }
      suffix={suffix}
      animated={!reduce}
    />
  );
}

function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="font-headline text-[22px] font-bold tracking-tight text-[var(--text)]">{children}</h2>
      {right}
    </div>
  );
}

/* ---------------- Page introductions (all six pages) ----------------
   One art-directed intro per page: the lime handwritten accent
   (Adelia family) IS the page headline — it writes itself on and
   pops forward over a hand-drawn marker underline — followed by the
   page's description and one small floating object. The CSS lives
   in theme.css (.page-intro / .intro-* / .obj-*); reduced motion
   settles straight to the final composition. */

function PageIntro({
  accent, description, visual, level = 2, value,
}: {
  accent: string;
  description: string;
  visual: ReactNode;
  level?: 1 | 2;
  value?: string;
}) {
  const HeadTag = (level === 1 ? "h1" : "h2") as "h1" | "h2";
  return (
    <div className="page-intro">
      <div className="intro-row">
        <HeadTag className="intro-accent-wrap">
          <span className="intro-accent">{accent}</span>
          <svg className="intro-underline" viewBox="0 0 220 16" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="u-soft" pathLength={100} d="M5 10 C 55 4, 120 15, 165 8 S 205 7, 215 9" />
            <path className="u-main" pathLength={100} d="M5 9 C 60 3, 125 14, 168 7 S 206 6, 215 8" />
          </svg>
        </HeadTag>
        <span className="intro-obj" aria-hidden="true">{visual}</span>
      </div>
      <p className="intro-desc">{description}</p>
      {value && (
        <p className="mt-2.5 flex items-center gap-2 text-[15px] font-semibold text-[var(--text)]">
          <span className="flex-none text-[var(--accent)]"><IconCheck size={16} /></span>
          {value}
        </p>
      )}
    </div>
  );
}

/* Price — a lime price tag. */
function IntroTagVisual() {
  return (
    <span className="intro-obj-float inline-block pb-3 pr-1 pt-2">
      <span className="obj-tag">
        <span className="obj-tag-hole" />
        RATE CARD
      </span>
    </span>
  );
}

/* Brands — a magnifying glass hovering over a miniature discovery
   card. Generic lines only: no company logos, no invented partners. */
function IntroSearchVisual() {
  return (
    <span className="intro-obj-float relative block h-[74px] w-[104px]">
      <span className="obj-card absolute bottom-0 left-0 block w-[86px] p-2.5">
        <span className="obj-line obj-line-lime block w-3/5" />
        <span className="obj-line mt-1.5 block w-4/5" />
        <span className="obj-line mt-1.5 block w-2/3" />
      </span>
      <svg className="absolute -top-1 right-0" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true" style={{ filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.5))" }}>
        <circle cx="19" cy="19" r="12.5" fill="rgba(200,255,61,0.08)" stroke="#c8ff3d" strokeWidth="3" />
        <line x1="28.5" y1="28.5" x2="40" y2="40" stroke="#f5f5f7" strokeWidth="5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/* Deals — three miniature glass pipeline cards on a flowing lime
   line. Stage words are generic workflow steps, not brand data. */
function IntroPipeVisual() {
  return (
    <span className="intro-obj-float relative block h-[74px] w-[118px]">
      <svg className="absolute inset-x-0 top-[30px]" width="118" height="14" viewBox="0 0 118 14" aria-hidden="true">
        <path className="obj-pipe-path" d="M2 7 C 30 1, 55 13, 82 6 S 110 7, 116 7" fill="none" stroke="#c8ff3d" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
      </svg>
      {["Pitch", "Agree", "Paid"].map((label, i) => (
        <span
          key={label}
          className="obj-card absolute block px-2 py-1.5"
          style={{ left: i * 38, top: i % 2 === 0 ? 0 : 40 }}
        >
          <span className="font-headline block text-[9px] font-bold uppercase tracking-wide text-[var(--text)]">{label}</span>
          <span className={`obj-line mt-1 block w-6 ${i === 2 ? "obj-line-lime" : ""}`} />
        </span>
      ))}
    </span>
  );
}

/* Invoices — a dimensional paper sheet. The stamp is passed in from
   the real invoice state: "PAID" only when an invoice is actually
   paid, "SENT" when one has been sent, nothing for drafts/none. */
function IntroSheetVisual({ stamp }: { stamp: "PAID" | "SENT" | null }) {
  return (
    <span className="intro-obj-float relative block h-[78px] w-[76px]" style={{ transform: "rotate(3deg)" }}>
      <span
        className="absolute inset-0 block rounded-[6px]"
        style={{
          background: "linear-gradient(165deg, #f7f7f2, #e8e8e0)",
          boxShadow: "0 18px 32px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.06)",
        }}
      >
        <span className="block px-2.5 pt-2.5">
          <span className="block h-[5px] w-2/5 rounded-full bg-[#14141b]/70" />
          <span className="mt-2 block h-[4px] w-4/5 rounded-full bg-[#14141b]/25" />
          <span className="mt-1.5 block h-[4px] w-3/5 rounded-full bg-[#14141b]/25" />
          <span className="mt-2.5 block h-[6px] w-1/2 rounded-full bg-[#3fae5a]/70" />
        </span>
        {stamp && <span className="obj-stamp absolute bottom-2 right-1.5">{stamp}</span>}
      </span>
    </span>
  );
}

/* Plan — a luxurious membership card with a dimensional crown. */
function IntroMemberVisual() {
  return (
    <span className="intro-obj-float block pb-2 pt-1">
      <span className="obj-card obj-member block w-[104px] p-2.5">
        <span className="flex items-center justify-between">
          <span className="font-headline text-[10px] font-extrabold tracking-[0.18em] text-[var(--text)]">PRO</span>
          <span style={{ color: "#b9a5ff", filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.6))" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m2 5 4.5 4L12 4l5.5 5L22 5l-1.8 11.2a2 2 0 0 1-2 1.8H5.8a2 2 0 0 1-2-1.8L2 5Z" />
            </svg>
          </span>
        </span>
        <span className="obj-line mt-2 block w-4/5" style={{ background: "rgba(185,165,255,0.5)" }} />
        <span className="obj-line mt-1.5 block w-3/5" />
      </span>
    </span>
  );
}

/* ---------------- Working animations ----------------
   Long jobs (YouTube fetch, brand search, pitch writing) must visibly
   look alive: a spinner, a moving progress bar, status messages that
   advance while the job runs, an elapsed clock, and skeleton cards
   where results will land — so nobody stares at a frozen screen
   wondering if the app is stuck. */

function Spinner({ large }: { large?: boolean }) {
  return <span className={large ? "anim-spinner anim-spinner-lg" : "anim-spinner"} aria-hidden />;
}

function useElapsedSeconds(active: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!active) { setSecs(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return secs;
}

function WorkingPanel({
  title,
  steps,
  stepSeconds = 6,
  footnote,
}: {
  title: string;
  steps: string[];
  stepSeconds?: number;
  footnote?: string;
}) {
  const secs = useElapsedSeconds(true);
  const stepIdx = Math.min(steps.length - 1, Math.floor(secs / stepSeconds));
  const current = steps[stepIdx] ?? title;
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={SPRING_UI}
      className="card p-4 ring-1 ring-[var(--accent)]/40"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="text-[var(--accent)]"><Spinner large /></span>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{title}</p>
          <p className="text-xs text-[var(--dim)]">
            Working for {secs}s — your result is on its way.
          </p>
        </div>
        <span className="ml-auto flex flex-none gap-1" aria-hidden>
          <span className="anim-dot" /><span className="anim-dot" /><span className="anim-dot" />
        </span>
      </div>
      <div className="anim-progress-track mt-3" aria-hidden>
        <div className="anim-progress-fill" />
      </div>
      <div className="relative mt-3 min-h-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={stepIdx}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(2px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: "blur(2px)" }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="text-sm font-medium text-[var(--text)]"
          >
            {current}
          </motion.p>
        </AnimatePresence>
      </div>
      <ol className="mt-2 space-y-1">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 text-sm ${i < stepIdx ? "text-[var(--dim)]" : i === stepIdx ? "text-[var(--text)] font-medium" : "text-[var(--dim)] opacity-60"}`}>
            <span aria-hidden className="inline-flex h-4 w-4 flex-none items-center justify-center text-xs">
              {i < stepIdx ? "✓" : i === stepIdx ? <Spinner /> : "·"}
            </span>
            {s}
          </li>
        ))}
      </ol>
      {footnote && <p className="mt-3 text-xs text-[var(--dim)]">{footnote}</p>}
    </motion.div>
  );
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-4" aria-hidden>
      <div className="anim-shimmer h-5 w-2/5 rounded" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="anim-shimmer mt-2.5 h-3.5 rounded" style={{ width: `${88 - i * 14}%` }} />
      ))}
      <div className="anim-shimmer mt-3.5 h-9 w-32 rounded" />
    </div>
  );
}

// Shown in place of the old blank "Loading your workspace…" screen:
// the header, tabs and calculator are already on screen; this is just
// a slim animated strip while saved data catches up.
function BootStrip() {
  return (
    <div className="mb-5" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-[var(--dim)]">
        <span className="text-[var(--accent)]"><Spinner /></span>
        Opening your workspace…
      </div>
      <div className="anim-progress-track mt-2" aria-hidden>
        <div className="anim-progress-fill" />
      </div>
    </div>
  );
}

// Placeholder dashboard used only for the very first paint, before the
// real one returns: it lets the calculator and tabs render instantly.
// It carries no user data — every list is empty and login reads as
// "not configured yet", which the boot state overrides in the UI.
const FALLBACK_DASH: Dash = {
  profile: null,
  profiles: [],
  calculations: [],
  brands: [],
  deals: [],
  invoices: [],
  reminders: [],
  plan: "free",
  proActive: false,
  proBilling: null,
  proStartsAt: null,
  proExpiresAt: null,
  proDaysLeft: null,
  proCancelled: false,
  proPayments: [],
  manualPayments: [],
  paymentMode: "automatic",
  inrRate: OWNER_CONFIG.inrRate,
  today: "",
  supabaseUrl: OWNER_CONFIG.supabaseUrl,
  supabaseAnonKey: OWNER_CONFIG.supabaseAnonKey,
  supabaseConfigured: true,
  supabaseKeyHint: null,
  senderEmail: null,
  senderConnected: false,
  payLinkInrMonthly: null,
  payLinkInrAnnual: null,
  payLinkUsdMonthly: null,
  payLinkUsdAnnual: null,
};

/* Loads Razorpay Checkout (checkout.js) on demand — only when a
   buyer taps "Buy now", so the script never slows down the app for
   everyone else. Resolves with the global Razorpay constructor. */
let razorpayScriptPromise: Promise<any> | null = null;
function loadRazorpayCheckout(): Promise<any> {
  const w = window as any;
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => ((window as any).Razorpay ? resolve((window as any).Razorpay) : reject(new Error("Razorpay Checkout did not load.")));
    s.onerror = () => { razorpayScriptPromise = null; reject(new Error("Razorpay Checkout did not load.")); };
    document.head.appendChild(s);
  });
  return razorpayScriptPromise;
}

/* ---------------- Sign-in bottom sheet ----------------
   The ONLY sign-in surface in the app. Frosted glass (blur 20px,
   dark tint), rounded top corners, slides up in 250ms, closes by
   swiping down or tapping outside. The Google button follows
   Google's branding exactly: white pill, #747775 border, 48px,
   standard-colour G, Roboto 500, #1F1F1F text. Login logic is the
   same signInWithOAuth call as before — only the UI changed. */
function SignInSheet({ open, onClose, supabaseUrl, supabaseAnonKey, configured, onDemoLogin }: {
  open: boolean;
  onClose: () => void;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  configured: boolean;
  onDemoLogin: () => void;
}) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Reviewer demo sign-in (username + password, DEMO_LOGIN). It is
     a local demo session, separate from Google sign-in — see
     startDemoSession in App. Hidden entirely when the owner has
     disabled the demo by emptying the password. */
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoUser, setDemoUser] = useState("");
  const [demoPass, setDemoPass] = useState("");
  useEffect(() => { if (open) { setError(""); setBusy(false); setDemoOpen(false); setDemoPass(""); } }, [open ]);

  const submitDemo = () => {
    if (demoUser.trim() === DEMO_LOGIN.username && demoPass === DEMO_LOGIN.password) {
      setError("");
      onDemoLogin();
    } else {
      setError("Those demo details don't match. Check the username and password and try again.");
    }
  };

  async function handleGoogle() {
    setError(""); setBusy(true);
    if (!configured || !supabaseUrl || !supabaseAnonKey) {
      setError("Sign-in isn't switched on yet. The calculator still works without an account.");
      setBusy(false);
      return;
    }
    try {
      const client = await getSupabaseClient(supabaseUrl, supabaseAnonKey);
      const { error: err } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: appRedirectUrl(),
          // Basic profile scopes only — never gmail.send here. The
          // email permission is granted incrementally, only when the
          // creator taps Send, so sign-in never shows Google's
          // unverified-app warning.
          scopes: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (err) throw err;
    } catch (err: any) {
      setError(err?.message ?? "Could not start Google sign-in. Try again.");
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Sign in for your free account"
            initial={reduce ? { opacity: 0 } : { y: "105%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "105%" }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            drag={reduce ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => { if (info.offset.y > 72 || info.velocity.y > 500) onClose(); }}
            className="sheet-glass fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl rounded-t-[28px] px-6 pb-safe pt-3"
          >
            <span className="sheet-shimmer" aria-hidden />
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" aria-hidden />
            <h2 className="display-tight font-headline mt-4 text-[26px] font-bold">Your free account</h2>
            <p className="mt-1.5 text-sm font-medium text-[var(--dim)]">Free account. No Pro subscription required.</p>
            <ul className="mt-4 space-y-2.5 text-[15px]">
              {["Save your rate card", "Pitches are addressed from your own Gmail"].map((line) => (
                <li key={line} className="flex items-center gap-2.5">
                  <span className="flex-none text-[var(--accent)]"><IconCheck size={17} /></span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={busy}
              className="google-btn btn-press mt-6 flex h-[48px] w-full items-center rounded-full py-0 pl-[12px] pr-4 text-[15px] disabled:opacity-60"
            >
              <GoogleG />
              <span className="flex-1 text-center">{busy ? "Opening Google…" : "Continue with Google"}</span>
            </button>
            <p className="mt-3 text-center text-xs text-[var(--dim)]">Mails go out from your Gmail. Never ours.</p>
            {DEMO_LOGIN.password && (
              <div className="pb-5 pt-1">
                {!demoOpen ? (
                  <button type="button" className="btn-press mx-auto block min-h-[40px] px-3 text-[13px] font-medium text-[var(--dim)] underline" onClick={() => setDemoOpen(true)}>
                    Reviewer demo sign-in
                  </button>
                ) : (
                  <form
                    className="mx-auto max-w-sm space-y-2 pt-2"
                    onSubmit={(e) => { e.preventDefault(); submitDemo(); }}
                  >
                    <p className="text-center text-[13px] text-[var(--dim)]">Demo account for reviewers — read-only, nothing is saved.</p>
                    <input
                      aria-label="Demo username"
                      autoComplete="username"
                      className={inputCls}
                      placeholder="Demo username"
                      value={demoUser}
                      onChange={(e) => setDemoUser(e.target.value)}
                    />
                    <input
                      aria-label="Demo password"
                      type="password"
                      autoComplete="current-password"
                      className={inputCls}
                      placeholder="Demo password"
                      value={demoPass}
                      onChange={(e) => setDemoPass(e.target.value)}
                    />
                    <button type="submit" className={btnGhost + " w-full"}>Open demo</button>
                  </form>
                )}
              </div>
            )}
            {!DEMO_LOGIN.password && <div className="pb-5" />}
            {error && <div role="alert" className="mb-5 rounded-2xl border border-[var(--danger)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm">{error}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Google-only gate: a session only counts when it came from Google
// sign-in. Any other session (e.g. an old email-and-password one left in
// this browser from an earlier build) is signed out and never unlocks
// the app, so a typed address can never become the sender.
function isGoogleSessionUser(user: any): boolean {
  const meta = user?.app_metadata ?? {};
  if (meta.provider === "google") return true;
  return Array.isArray(meta.providers) && meta.providers.includes("google");
}

/* ---------------- Locked feature (shown until Google sign-in) ---------------- */

/* Blurred sample rows shown behind the glass card on Pro-preview
   tabs — a visual preview of the Pro pages, never real user data. */
/* One blurred preview row. Brand rows also carry industry, country,
   relevance and where contact happens, so the preview teaches what
   the real page shows — still generic sample data, never real user
   rows and never an invented email address. */
type PreviewRowData = {
  title: string;
  meta: string;
  amountInr: number;
  status: string;
  industry?: string;
  country?: string;
  relevance?: string;
  contact?: string;
};

function PreviewRows({ rows, currency, inrRate }: { rows: PreviewRowData[]; currency: DisplayCurrency; inrRate: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {rows.map((r) => (
        <div key={r.title} className="card flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{r.title}</p>
            <p className="truncate text-sm text-[var(--dim)]">{r.meta}</p>
            {(r.industry || r.relevance || r.contact) && (
              <div className="mt-1.5 space-y-0.5 text-[13px] leading-snug text-[var(--dim)]">
                {r.industry && <p>{r.industry}{r.country ? ` · ${r.country}` : ""}</p>}
                {r.relevance && <p>Relevance: {r.relevance}</p>}
                {r.contact && <p>Contact: {r.contact}</p>}
              </div>
            )}
          </div>
          <div className="flex flex-none flex-col items-end gap-1.5">
            <p className="tnum font-display text-lg font-bold text-[var(--accent)]">{formatMoney(currency === "INR" ? r.amountInr : r.amountInr / inrRate, currency)}</p>
            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${r.status === "Paid" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-[var(--surface-alt)] text-[var(--dim)]"}`}>{r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const BRANDS_PREVIEW: PreviewRowData[] = [
  { title: "boAt", meta: "Audio · creator partnerships", amountInr: 18500, status: "Creator program", industry: "Consumer audio", country: "India", relevance: "Runs creator partnerships for product launches", contact: "Creator programme page on their website" },
  { title: "Noise", meta: "Wearables · affiliate program", amountInr: 12000, status: "Open", industry: "Smart wearables", country: "India", relevance: "Affiliate programme open to tech creators", contact: "Partnerships page on their website" },
  { title: "Mamaearth", meta: "Beauty · creator program", amountInr: 30000, status: "Creator program", industry: "Beauty & personal care", country: "India", relevance: "Creator programme in the beauty niche", contact: "Creator sign-up on their website" },
  { title: "Hostinger India", meta: "Tech · partnership program", amountInr: 22000, status: "Open", industry: "Web hosting & SaaS", country: "India", relevance: "Partner programme for tech channels", contact: "Partner programme page on their website" },
];
const DEALS_PREVIEW: PreviewRowData[] = [
  { title: "boAt", meta: "Dedicated video", amountInr: 18500, status: "Negotiating" },
  { title: "Noise", meta: "60s integration", amountInr: 12000, status: "Pitch ready" },
  { title: "Mamaearth", meta: "Dedicated video", amountInr: 30000, status: "Approved" },
  { title: "Sleepwell", meta: "Short / reel", amountInr: 8500, status: "Pitched" },
];
const INVOICES_PREVIEW: PreviewRowData[] = [
  { title: "INV-2041 · boAt", meta: "Due in 12 days", amountInr: 18500, status: "Sent" },
  { title: "INV-2038 · Noise", meta: "Settled", amountInr: 12000, status: "Paid" },
  { title: "INV-2035 · Mamaearth", meta: "Due in 3 days", amountInr: 30000, status: "Sent" },
  { title: "INV-2031 · Sleepwell", meta: "Settled", amountInr: 8500, status: "Paid" },
];

/* Pro preview for guests and free accounts. Sign-in creates a free
   account only — it never unlocks these pages — so the card says so
   plainly and the one CTA is "Explore Pro" (goes to the Plan tab).
   Only an active Pro plan (the workspace plan flag) renders the real
   Brands / Deals / Invoices tabs. */
function LockedFeature({
  title, accent, description, visual, preview, checking, signedIn, onExplorePro, onSignIn, displayCurrency, inrRate,
}: {
  title: string;
  accent: string;
  description: string;
  visual: ReactNode;
  preview: PreviewRowData[];
  checking: boolean;
  signedIn: boolean;
  onExplorePro: () => void;
  onSignIn?: () => void;
  displayCurrency: DisplayCurrency;
  inrRate: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-8">
      <PageIntro accent={accent} description={description} visual={visual} />
      <section aria-label={`${title} — Pro preview`} className="relative">
        <div className="pointer-events-none select-none opacity-75 blur-[7px]">
          <PreviewRows rows={preview} currency={displayCurrency} inrRate={inrRate} />
        </div>
        <div className="absolute inset-0 flex items-start justify-center px-1 pt-12">
          <motion.div
            {...itemAnim(0, reduce)}
            className="glass-card w-full max-w-sm rounded-[var(--radius)] p-6"
          >
            {checking ? (
              <p className="flex items-center justify-center gap-2 py-6 text-center text-[var(--dim)]" role="status"><Spinner /> Checking your account…</p>
            ) : (
              <div className="text-center text-[var(--text)]">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--violet)]">
                  <IconCrown />
                </span>
                <h3 className="font-headline display-tight mt-3 text-[24px] font-bold">This page is part of Pro</h3>
                <p className="mt-1 text-[15px] text-[var(--dim)]">
                  {signedIn
                    ? "You're on the free plan — signing in alone doesn't include this."
                    : "Signing in creates a free account — this page itself is a Pro feature."}
                </p>
                <button type="button" onClick={onExplorePro} className={btnPrimary + " mt-5 w-full"}>
                  Explore Pro
                </button>
                {!signedIn && onSignIn && (
                  <button type="button" onClick={onSignIn} className={btnGhost + " mt-3 w-full"}>
                    Sign in — free account
                  </button>
                )}
                {/* Who gets what, stated plainly: no account vs a
                    free account vs an active Pro subscription. */}
                <ul className="mt-4 space-y-1.5 text-left text-[13px] leading-snug text-[var(--dim)]">
                  <li><span className="font-bold text-[var(--text)]">No account:</span> price calculator &amp; YouTube fetch</li>
                  <li><span className="font-bold text-[var(--text)]">Free account:</span> save your rate cards</li>
                  <li><span className="font-bold text-[var(--text)]">Pro:</span> brand finder, deal pipeline &amp; invoices</li>
                </ul>
              </div>
            )}
          </motion.div>
        </div>
        <div className="h-40" aria-hidden />
      </section>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  /* A #/page address in the URL opens that public page directly,
     before anything else — the pages must be reachable with no
     login and no tapping through the app. */
  const [tab, setTab] = useState<"price" | "brands" | "deals" | "invoices" | "plan" | "owner" | "legal">(() => (infoPageFromHash() ? "legal" : "price"));
  // The deal just added from Brand Finder, so its AI Brand Research
  // starts automatically once the Deals tab renders it.
  const [autoResearchDealId, setAutoResearchDealId] = useState<number | null>(null);
  /* Where "Back" on a public info page returns to — the page the
     reader came from (Plan, Account, or wherever the footer was). */
  const [legalReturn, setLegalReturn] = useState<"price" | "brands" | "deals" | "invoices" | "plan" | "owner">("plan");
  /* Demo reviewer session (see DEMO_LOGIN): a local flag, not a
     Supabase session. While it is on, the auth effect below leaves
     the demo identity alone instead of clearing it. */
  const [demoMode, setDemoMode] = useState(false);
  const demoRef = useRef(false);
  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  /* Profile menu (signed-in header button) and the info page it
     links to. There is no Account tab any more: the menu carries
     identity, plan and sign-out, and the four info pages render as
     the "legal" view, reached only from the menu. */
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Escape closes the profile menu (keyboard support).
  useEffect(() => {
    if (!profileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setProfileMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profileMenuOpen]);
  const [legalPage, setLegalPage] = useState<InfoPageKey>(() => infoPageFromHash() ?? "privacy");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"idle" | "checking" | "signed_in" | "signed_out" | "error">("idle");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [supabaseClient, setSupabaseClient] = useState<any>(null);
  const authSubRef = useRef<any>(null);
  /* INR only — there is no currency state, toggle or detection. */
  const displayCurrency: DisplayCurrency = "INR";

  /* Guests get a stable per-device guest id so they can fetch public
     YouTube channel stats without signing in (the server treats
     "guest-…" ids as a public-stats-only namespace — no email, no
     sender, no Pro access). Signed-in users always use their real id. */
  const [guestId] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem("bpt-guest-id");
      if (saved && saved.startsWith("guest-")) return saved;
      const fresh = `guest-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      window.localStorage.setItem("bpt-guest-id", fresh);
      return fresh;
    } catch {
      return "guest-anon";
    }
  });
  const dashUserId = userId ?? guestId;

  const dash = useQuery({
    queryKey: ["dashboard", dashUserId],
    queryFn: () => api.getDashboard({ userId: dashUserId, accessToken: accessToken ?? undefined }),
    // Keep showing the last good data during background refetches
    // instead of flashing back to a loading state.
    placeholderData: (prev) => prev,
    refetchInterval: (q) => {
      const d = q.state.data as Dash | undefined;
      return d?.profile?.status === "pending" ? 4000 : false;
    },
  });

  // Start downloading the Supabase library in parallel with the first
  // dashboard load, so sign-in setup doesn't pay that cost afterwards.
  useEffect(() => { preloadSupabaseLibrary(); }, []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dashboard"] });

  const fetchMut = useMutation({
    mutationFn: (query: string) => api.requestChannelFetch({ userId: userId ?? guestId, accessToken: accessToken ?? undefined, query }),
    onSuccess: () => { invalidate(); toast.success("Fetch started — reading your channel from YouTube"); sfx("success"); },
    onError: () => { toast.error("Could not start the fetch. Try again."); sfx("error"); },
  });
  const manualMut = useMutation({
    mutationFn: (args: { label: string; avgViews: number; engagementPct: number; subscribers?: number }) =>
      api.saveManualProfile({ userId: userId ?? "", accessToken: accessToken ?? undefined, ...args }),
    onSuccess: () => { invalidate(); toast.success("Numbers saved — your rate is updated"); sfx("success"); },
    onError: () => { toast.error("Could not save those numbers. Try again."); sfx("error"); },
  });
  const calcMut = useMutation({
    mutationFn: (args: Omit<Parameters<typeof api.calculatePrice>[0], "userId" | "accessToken">) =>
      api.calculatePrice({ userId: userId ?? "", accessToken: accessToken ?? undefined, ...args }),
    onSuccess: () => { invalidate(); toast.success("Rate card saved"); sfx("success"); },
    onError: () => { toast.error("Could not save the rate card. Try again."); sfx("error"); },
  });

  const data = dash.data;
  // First paint only: render the shell, tabs and calculator immediately
  // from a placeholder instead of blocking on a blank loading screen.
  const booting = !data && dash.isPending;
  /* OWNER_CONFIG wins over the saved settings for the Supabase URL +
     anon key and the default INR rate: they ship in the code, so
     every phone uses the same setup. */
  const displayData: Dash = {
    ...(data ?? FALLBACK_DASH),
    inrRate: data?.inrRate ?? OWNER_CONFIG.inrRate,
  };
  const supabaseUrl = OWNER_CONFIG.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || displayData.supabaseUrl || null;
  const supabaseAnonKey = OWNER_CONFIG.supabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || data?.supabaseAnonKey || null;
  const supabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

  const applySessionUser = (user: any) => {
    setUserEmail(user.email ?? null);
    setUserId(user.id ?? null);
    const meta = user.user_metadata ?? {};
    setUserAvatar(typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : null);
    // Display name from the Google profile — used only to prefill
    // the Razorpay Checkout form.
    setUserName(typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null);
  };
  const clearSessionUser = () => { setUserEmail(null); setUserId(null); setUserAvatar(null); setUserName(null); };

  // Auth lifecycle: when config appears, create client and track session
  useEffect(() => {
    if (!data) return;
    // A demo reviewer session is local-only: never let the Supabase
    // session check clear it or replace it.
    if (demoRef.current) return;
    if (!supabaseConfigured) {
      setAuthState("idle");
      clearSessionUser();
      setAccessToken(null);
      setSupabaseClient(null);
      return;
    }
    let cancelled = false;
    setAuthState("checking");
    (async () => {
      try {
        const client = await getSupabaseClient(supabaseUrl!, supabaseAnonKey!);
        if (cancelled) return;
        setSupabaseClient(client);
        const { data: sessData } = await client.auth.getSession();
        if (cancelled) return;
        const sess = sessData?.session;
        if (sess?.user && isGoogleSessionUser(sess.user)) { applySessionUser(sess.user); setAccessToken(sess.access_token ?? null); setAuthState("signed_in"); setAuthNotice(null); }
        else if (sess?.user) {
          // Not a Google sign-in — reject it: sign it out and stay locked.
          try { await client.auth.signOut(); } catch {}
          if (!cancelled) { setAuthNotice("That session wasn't a Google sign-in, so it was signed out. Sign in with Google — your Gmail is your sending address."); setAuthState("signed_out"); clearSessionUser(); setAccessToken(null); }
        }
        else { setAuthState("signed_out"); clearSessionUser(); setAccessToken(null); }
        // Subscribe once
        if (authSubRef.current) { try { authSubRef.current.unsubscribe(); } catch {} authSubRef.current = null; }
        const { data: sub } = client.auth.onAuthStateChange((_event: string, session: any) => {
          if (demoRef.current) return;
          if (session?.user && isGoogleSessionUser(session.user)) { applySessionUser(session.user); setAccessToken(session.access_token ?? null); setAuthState("signed_in"); setAuthNotice(null); setSignInSheetOpen(false); }
          else if (session?.user) {
            client.auth.signOut().catch(() => {});
            setAuthNotice("That session wasn't a Google sign-in, so it was signed out. Sign in with Google — your Gmail is your sending address.");
            clearSessionUser(); setAccessToken(null); setAuthState("signed_out");
          }
          else { clearSessionUser(); setAccessToken(null); setAuthState("signed_out"); }
        });
        authSubRef.current = sub?.subscription ?? sub;
      } catch {
        if (!cancelled) setAuthState("error");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseConfigured, supabaseUrl, supabaseAnonKey, data?.supabaseConfigured]);

  async function handleSignOut() {
    setProfileMenuOpen(false);
    demoRef.current = false;
    setDemoMode(false);
    try { if (supabaseClient) await supabaseClient.auth.signOut(); } catch {}
    clearSessionUser();
    setAccessToken(null);
    setAuthState("signed_out");
    queryClient.removeQueries({ queryKey: ["dashboard"] });
  }

  /* Demo reviewer sign-in (username + password from DEMO_LOGIN):
     a local read-only session under the "demo-reviewer" id. The
     server treats that id as a public namespace, so the reviewer
     sees the calculator, Plan/pricing and public pages with an
     empty workspace — nothing they do can save, buy or send. */
  const startDemoSession = () => {
    demoRef.current = true;
    setDemoMode(true);
    setUserId("demo-reviewer");
    setUserEmail(DEMO_LOGIN.emailLabel);
    setUserName(DEMO_LOGIN.displayName);
    setUserAvatar(null);
    setAccessToken(null);
    setAuthState("signed_in");
    setAuthNotice(null);
    setSignInSheetOpen(false);
    toast.success("Demo session started — you are browsing as the reviewer demo account.");
  };

  const openSignInSheet = () => setSignInSheetOpen(true);

  const signedIn = supabaseConfigured && authState === "signed_in" && !!userId;
  const authPending = supabaseConfigured && (authState === "checking" || authState === "idle");

  /* Pro access: Google sign-in creates a free account and NEVER
     grants Pro by itself. A signed-in user has Pro when their own
     verified Razorpay subscription is active (proActive from the
     server), or while the workspace plan flag is Pro (the owner's
     existing manual switch). Brands, Deals and Invoices render
     their real UI only then; everyone else gets the Pro preview
     with an "Explore Pro" CTA. */
  const isPro = displayData.plan === "pro" || displayData.proActive;
  const canUsePro = signedIn && isPro;
  /* Decorative stamp on the Invoices intro sheet, from real status:
     PAID only when an invoice is actually paid, otherwise SENT. */
  const invoiceStamp: "PAID" | "SENT" = data?.invoices.some((i) => i.status === "paid") ? "PAID" : "SENT";

  const inrRate = displayData.inrRate;
  const overdueCount = data?.invoices.filter((i) => i.daysOverdue > 0 && i.status !== "paid").length ?? 0;

  /* The Owner Console exists only for the owner's own Google sign-in,
     reached from the profile dropdown. Any other email — or no
     sign-in — never sees it, and the server re-checks the verified
     email on every owner action. */
  const isOwner = !!userEmail && userEmail.toLowerCase() === OWNER_EMAIL.toLowerCase();

  const tabs: { key: typeof tab; label: string; ariaLabel: string; icon: () => ReactNode; badge?: number }[] = [
    { key: "price", label: "Price", ariaLabel: "My price", icon: IconRupee },
    { key: "brands", label: "Brands", ariaLabel: "Brands", icon: IconMegaphone },
    { key: "deals", label: "Deals", ariaLabel: "Deals", icon: IconDeals, badge: data?.deals.length || undefined },
    { key: "invoices", label: "Invoices", ariaLabel: "Invoices", icon: IconReceipt, badge: overdueCount || undefined },
    { key: "plan", label: "Plan", ariaLabel: "Plan", icon: IconCrown },
  ];

  /* Profile-menu plan line: Pro with its renewal date when the
     user's own verified subscription is active, the workspace Pro
     switch when only that is on, otherwise Free. */
  const menuExpiryLabel = displayData.proExpiresAt
    ? new Date(displayData.proExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const openLegal = (page: InfoPageKey) => {
    setLegalPage(page);
    setProfileMenuOpen(false);
    if (tab !== "legal") setLegalReturn(tab);
    setTab("legal");
    setInfoPageHash(page);
  };

  /* Keep the address in step with the screen: leaving a public page
     drops its #/page suffix, and pasting or following a #/page
     address while the app is already open goes straight to it. */
  useEffect(() => {
    if (tab !== "legal" && infoPageFromHash()) setInfoPageHash(null);
  }, [tab]);
  useEffect(() => {
    const onHashChange = () => {
      const page = infoPageFromHash();
      if (!page) return;
      setLegalPage(page);
      const current = tabRef.current;
      if (current !== "legal") setLegalReturn(current);
      setTab("legal");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // If the owner signs out (or another account signs in) while the
  // Owner page is open, leave it immediately — it must never linger.
  useEffect(() => {
    if (tab === "owner" && !isOwner) setTab("plan");
  }, [tab, isOwner]);

  // No full-app gate: the price calculator and public YouTube fetch
  // are open to everyone, signed in or not (guests fetch under a
  // per-device guest id). Brands, Deals and Invoices are Pro: they
  // render the real UI only for a signed-in user on an active Pro
  // plan, and a Pro preview with "Explore Pro" for everyone else —
  // Google sign-in alone (a free account) never unlocks them. Every
  // user's data stays scoped to their own verified account.

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <Toaster
        position="bottom-center"
        offset={92}
        toastOptions={{
          style: {
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          },
        }}
      />
      <main className="mx-auto w-full max-w-3xl px-4 pb-28">
        <motion.header
          className="pt-5 pb-4"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={SPRING_UI}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setTab("plan")}
              aria-label={isPro ? "Pro plan — open Plan" : "Free plan — open Plan"}
              className={`btn-press flex-none rounded-full px-3.5 py-2 text-xs font-bold ${isPro ? "bg-[var(--violet)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--dim)]"}`}
            >
              {isPro ? "PRO" : "FREE PLAN"}
            </button>
            <div className="flex items-center gap-2">
            <SoundMuteButton />
            {signedIn && userEmail ? (
              <div className="relative flex-none">
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  aria-label={`Profile menu — signed in as ${userEmail}`}
                  aria-haspopup="menu"
                  aria-expanded={profileMenuOpen}
                  className={`btn-press block rounded-full transition-all duration-150 hover:scale-[1.06] hover:ring-2 hover:ring-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:scale-95 ${profileMenuOpen ? "scale-[1.06] ring-2 ring-[var(--accent)]/60" : ""}`}
                >
                  <UserAvatar name={userName} email={userEmail} avatarUrl={userAvatar} size={38} />
                </button>
                <AnimatePresence>
                  {profileMenuOpen && (
                    <>
                      <button
                        type="button"
                        aria-label="Close profile menu"
                        data-sound="none"
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setProfileMenuOpen(false)}
                      />
                      <motion.div
                        role="menu"
                        aria-label="Profile"
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
                        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        style={{ transformOrigin: "top right" }}
                        className="absolute right-0 top-[calc(100%+10px)] z-50 w-[288px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
                      >
                        <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
                          <UserAvatar name={userName} email={userEmail} avatarUrl={userAvatar} size={44} />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-[15px] font-bold" title={userName ?? undefined}>
                              <span className="min-w-0 truncate">{userName ?? userEmail}</span>
                              <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-bold ${isPro ? "bg-[var(--violet)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--dim)]"}`}>
                                {isPro ? "PRO" : "FREE"}
                              </span>
                            </p>
                            <p className="truncate text-[13px] text-[var(--dim)]" title={userEmail}>{userEmail}</p>
                            <p className="mt-0.5 truncate text-xs font-medium text-[var(--dim)]">
                              {displayData.proActive && menuExpiryLabel
                                ? `Pro — ends ${menuExpiryLabel}`
                                : displayData.plan === "pro"
                                  ? "Pro — on for this workspace"
                                  : "Free plan"}
                            </p>
                          </div>
                        </div>
                        <div className="border-t border-[var(--border)] pt-1.5">
                          <button
                            type="button"
                            role="menuitem"
                            className="btn-press flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--surface-alt)]"
                            onClick={() => { setProfileMenuOpen(false); setSettingsOpen(true); }}
                          >
                            <span className="flex-none text-[var(--dim)]"><IconSettings size={18} /></span>
                            Settings
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="btn-press flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--surface-alt)]"
                            onClick={() => { setProfileMenuOpen(false); setTab("plan"); }}
                          >
                            <span className="flex-none text-[var(--dim)]"><IconCrown /></span>
                            Manage subscription
                          </button>
                          {isOwner && (
                            <button
                              type="button"
                              role="menuitem"
                              className="btn-press flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--surface-alt)]"
                              onClick={() => { setProfileMenuOpen(false); setTab("owner"); }}
                            >
                              <span className="flex-none text-[var(--dim)]"><IconLock /></span>
                              Owner Console
                            </button>
                          )}
                        </div>
                        <div className="border-t border-[var(--border)] pt-1.5">
                          <button
                            type="button"
                            role="menuitem"
                            className="btn-press flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                            onClick={handleSignOut}
                          >
                            <span className="flex-none"><IconLogout size={18} /></span>
                            Sign out
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                type="button"
                onClick={openSignInSheet}
                aria-label="Sign in"
                className="btn-press flex flex-none items-center gap-2"
              >
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--dim)]" aria-hidden>
                  <IconUser />
                </span>
                <span className="text-sm font-semibold">Sign in</span>
              </button>
            )}
            </div>
          </div>
          {data && !supabaseConfigured && (
            <div className="card mt-4 p-4" role="status">
              <p className="font-semibold">Owner setup: login isn't switched on yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">Login is set from the OWNER_CONFIG block in the code and the Owner screen. The calculator stays open to everyone either way.</p>
              <button type="button" className={btnPrimary + " mt-3 w-full sm:w-auto"} onClick={() => setTab("plan")}>Go to Plan</button>
            </div>
          )}
          {data && supabaseConfigured && authState === "error" && (
            <div className="card mt-4 p-4">
              <p className="font-semibold">Couldn't reach Supabase.</p>
              <p className="mt-1 text-sm text-[var(--dim)]">Login is temporarily unavailable — reload to try again.</p>
            </div>
          )}
          {authNotice && (
            <div className="card mt-4 p-4" role="status">
              <p className="text-sm leading-relaxed">{authNotice}</p>
              <button type="button" className={btnGhost + " mt-2"} onClick={() => setAuthNotice(null)}>Dismiss</button>
            </div>
          )}
        </motion.header>

        {booting && <BootStrip />}
        {dash.error && !data && (
          <div className="card p-4">
            <p className="font-medium">Could not load your workspace.</p>
            <button type="button" className={btnGhost + " mt-3"} onClick={() => dash.refetch()}>Try again</button>
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.995 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.995 }}
          transition={reduceMotion ? { duration: 0.15 } : SPRING_UI}
        >
        {tab === "price" && (
          <PriceTab
            data={displayData}
            signedIn={signedIn}
            authPending={authPending || booting}
            loginConfigured={supabaseConfigured || booting}
            onAuthAction={booting ? () => {} : openSignInSheet}
            onFetch={(q) => fetchMut.mutate(q)}
            fetching={fetchMut.isPending}
            onManual={(a) => manualMut.mutate(a)}
            manualSaving={manualMut.isPending}
            onCalculate={(a) => calcMut.mutate(a)}
            calculating={calcMut.isPending}
            onDeleteCalc={(id) => api.deleteCalculation({ userId: userId ?? "", accessToken: accessToken ?? undefined, id }).then(invalidate)}
          />
        )}
        {tab === "brands" && (booting ? (
          <div className="space-y-3" role="status" aria-label="Loading brands">
            <SkeletonCard />
            <SkeletonCard lines={2} />
          </div>
        ) : data && canUsePro ? (
          <BrandsTab data={data} userId={userId ?? ""} accessToken={accessToken ?? undefined} invalidate={invalidate} goDeals={() => setTab("deals")} onDealAdded={setAutoResearchDealId} />
        ) : data ? (
          <LockedFeature
            title="Brands"
            accent="Find brands that fit your audience."
            description="Discover relevant companies and find your next collaboration opportunity."
            visual={<IntroSearchVisual />}
            preview={BRANDS_PREVIEW}
            checking={authPending}
            signedIn={signedIn}
            onExplorePro={() => setTab("plan")}
            onSignIn={openSignInSheet}
            displayCurrency={displayCurrency}
            inrRate={inrRate}
          />
        ) : null)}
        {tab === "deals" && (booting ? (
          <div className="space-y-3" role="status" aria-label="Loading deals">
            <SkeletonCard />
            <SkeletonCard lines={2} />
          </div>
        ) : data && canUsePro ? (
          <DealsTab data={data} userId={userId ?? ""} accessToken={accessToken ?? undefined} invalidate={invalidate} autoResearchDealId={autoResearchDealId} onAutoResearchDone={() => setAutoResearchDealId(null)} />
        ) : data ? (
          <LockedFeature
            title="Deals"
            accent="keep it moving."
            description="Track every pitch till it's paid."
            visual={<IntroPipeVisual />}
            preview={DEALS_PREVIEW}
            checking={authPending}
            signedIn={signedIn}
            onExplorePro={() => setTab("plan")}
            onSignIn={openSignInSheet}
            displayCurrency={displayCurrency}
            inrRate={inrRate}
          />
        ) : null)}
        {tab === "invoices" && (booting ? (
          <div className="space-y-3" role="status" aria-label="Loading invoices">
            <SkeletonCard />
            <SkeletonCard lines={2} />
          </div>
        ) : data && canUsePro ? (
          <InvoicesTab data={data} userId={userId ?? ""} accessToken={accessToken ?? undefined} invalidate={invalidate} />
        ) : data ? (
          <LockedFeature
            title="Invoices"
            accent="payment, on track."
            description="Send invoices. Get reminders. Get paid."
            visual={<IntroSheetVisual stamp={invoiceStamp} />}
            preview={INVOICES_PREVIEW}
            checking={authPending}
            signedIn={signedIn}
            onExplorePro={() => setTab("plan")}
            onSignIn={openSignInSheet}
            displayCurrency={displayCurrency}
            inrRate={inrRate}
          />
        ) : null)}
        {tab === "plan" && (booting ? (
          <div className="space-y-3" role="status" aria-label="Loading settings">
            <SkeletonCard />
            <SkeletonCard lines={4} />
          </div>
        ) : data ? (
          <PlanTab
            data={displayData}
            invalidate={invalidate}
            signedIn={signedIn}
            userId={userId}
            accessToken={accessToken}
            userEmail={userEmail}
            userName={userName}
            onOpenSignIn={openSignInSheet}
            onOpenLegal={openLegal}
          />
        ) : null)}
        {tab === "legal" && (
          <LegalPage page={legalPage} onBack={() => setTab(legalReturn)} />
        )}
        {tab === "owner" && isOwner && data && (
          <OwnerTab data={displayData} invalidate={invalidate} inrRate={inrRate} userId={userId} accessToken={accessToken} />
        )}
        </motion.div>
        </AnimatePresence>

        {/* Public footer: the eight public pages need no login and
            are linked from every screen, as Razorpay's review
            expects. */}
        <footer className="mt-10 border-t border-[var(--border)] pt-5 pb-2">
          <nav aria-label="Public pages" className="flex flex-wrap gap-x-4 gap-y-2">
            {(Object.keys(INFO_PAGES) as InfoPageKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className="btn-press min-h-[36px] text-[13px] font-medium text-[var(--dim)] underline-offset-2 hover:underline"
                onClick={() => openLegal(key)}
              >
                {INFO_PAGES[key].title}
              </button>
            ))}
          </nav>
          <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">
            {BUSINESS_CONFIG.productName} · {BUSINESS_CONFIG.businessName} · {SHIPPING_NOTE}
          </p>
        </footer>
      </main>

      <nav aria-label="Main sections" className="glass-nav fixed inset-x-0 bottom-0 border-t border-[var(--border)] pb-safe">
        <div className="mx-auto grid max-w-3xl grid-cols-5 px-1 pt-1">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-label={t.ariaLabel}
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(t.key)}
                className={`btn-press relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-bold ${active ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    aria-hidden
                    className="absolute inset-0 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/12"
                    transition={SPRING_PILL}
                  />
                )}
                <span className="relative"><TabIcon /></span>
                <span className="relative leading-none">{t.label}</span>
                {t.badge ? (
                  <span className="absolute right-1.5 top-1 z-10 whitespace-nowrap rounded-full bg-[var(--danger)] px-1.5 text-[11px] font-bold text-white">{t.badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
      <SignInSheet
        open={signInSheetOpen}
        onClose={() => setSignInSheetOpen(false)}
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        configured={supabaseConfigured}
        onDemoLogin={startDemoSession}
      />
      {data && (
        <AccountSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          data={displayData}
          userName={userName}
          userEmail={userEmail}
          userAvatar={userAvatar}
          demoMode={demoMode}
          userId={userId}
          accessToken={accessToken}
          onSignOut={handleSignOut}
          invalidate={invalidate}
          onGoPlan={() => setTab("plan")}
        />
      )}
    </div>
  );
}

/* ---------------- Price tab ---------------- */

function PriceTab(props: {
  data: Dash;
  signedIn: boolean;
  authPending: boolean;
  loginConfigured: boolean;
  onAuthAction: () => void;
  onFetch: (q: string) => void;
  fetching: boolean;
  onManual: (a: { label: string; avgViews: number; engagementPct: number; subscribers?: number }) => void;
  manualSaving: boolean;
  onCalculate: (a: Omit<Parameters<typeof api.calculatePrice>[0], "userId" | "accessToken">) => void;
  calculating: boolean;
  onDeleteCalc: (id: number) => void;
}) {
  const { data } = props;
  const reduce = useReducedMotion();
  const profile = data.profile;
  const inrRate = data.inrRate;

  const [channelQuery, setChannelQuery] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [mLabel, setMLabel] = useState("");
  const [mViews, setMViews] = useState("");
  const [mEng, setMEng] = useState("");
  const [mSubs, setMSubs] = useState("");

  /* Calculator numbers start at 0 — real numbers appear only when a
     channel fetch fills them in or the creator types their own. */
  const [avgViews, setAvgViews] = useState("0");
  const [engagement, setEngagement] = useState("0");
  const [country, setCountry] = useState("India");
  const [niche, setNiche] = useState("Tech");
  const [deliverable, setDeliverable] = useState("dedicated");
  const [cpm, setCpm] = useState(String(COUNTRY_CPM["India"]));
  const [cpmTouched, setCpmTouched] = useState(false);
  const [showHow, setShowHow] = useState(false);
  /* INR only — calculator results are always shown in rupees,
     converted from the USD CPM at the one editable config rate. */
  const currency: DisplayCurrency = "INR";

  // Sync calculator inputs when a fresh channel fetch lands.
  const profileKey = profile ? `${profile.id}-${profile.fetchedAt ?? ""}-${profile.status}` : "";
  const [syncedKey, setSyncedKey] = useState("");
  useEffect(() => {
    if (profile && (profile.status === "done" || profile.status === "manual") && profileKey !== syncedKey) {
      setSyncedKey(profileKey);
      if (profile.avgViews) setAvgViews(String(Math.round(profile.avgViews)));
      if (profile.engagementPct != null) setEngagement(String(profile.engagementPct));
      if (profile.ytCountry && COUNTRY_CPM[profile.ytCountry]) {
        setCountry(profile.ytCountry);
        if (!cpmTouched) setCpm(String(COUNTRY_CPM[profile.ytCountry]));
      }
    }
  }, [profile, profileKey, syncedKey, cpmTouched]);

  const viewsNum = parseFloat(avgViews) || 0;
  const engNum = parseFloat(engagement) || 0;
  const cpmNum = parseFloat(cpm) || 0;
  const nicheMult = NICHE_MULT[niche] ?? 1;
  const deliv = DELIVERABLES.find((d) => d.key === deliverable) ?? DELIVERABLES[0]!;
  const ef = engagementFactor(engNum);
  const mid = viewsNum > 0 && cpmNum > 0 ? (viewsNum / 1000) * cpmNum * nicheMult * deliv.mult * ef : 0;
  const latest = data.calculations[0];

  // Confetti the first time a real price appears this session.
  const celebratedRef = useRef(false);
  const [showConfetti, setShowConfetti] = useState(false);
  useEffect(() => {
    if (mid > 0 && !celebratedRef.current) {
      celebratedRef.current = true;
      setShowConfetti(true);
    }
  }, [mid]);
  const perLabel = deliverable === "short" ? "per short" : deliverable === "post" ? "per post" : "per video";
  /* The result is a negotiation RANGE, never one precise price:
     the low end (80% of the midpoint estimate) doubles as the
     minimum target, the high end is 125%. Every value starts at 0:
     the range only fills in once the creator fetches a channel or
     types numbers into the calculator — there is no sample result. */
  const shownMid = mid;
  const rangeLow = shownMid * 0.8;
  const rangeHigh = shownMid * 1.25;

  return (
    <div className="relative space-y-8">
      <div className="ambient-glow" aria-hidden />
      {/* Page intro — the estimated range result card sits below
          the Calculator, as the calculator's result. */}
      <section aria-label="Your price">
        <PageIntro
          level={1}
          accent="know your worth."
          description="Turn your channel's performance into a clear, explainable brand-deal quote."
          visual={<IntroTagVisual />}
        />
      </section>

      {/* Fetch channel — one clean row */}
      <section aria-label="Fetch your channel">
        <SectionTitle>Live from YouTube</SectionTitle>
        <form
          className="card mt-3 flex items-center gap-2 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (channelQuery.trim().length >= 2) props.onFetch(channelQuery.trim());
          }}
        >
          <input
            aria-label="Channel handle, link or ID"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
            placeholder="@yourhandle or channel link"
            value={channelQuery}
            onChange={(e) => setChannelQuery(e.target.value)}
          />
          <button
            type="submit"
            className={btnSmall + " flex-none"}
            disabled={props.fetching || channelQuery.trim().length < 2}
          >
            {props.fetching
              ? <span className="inline-flex items-center gap-2"><Spinner /> Fetching…</span>
              : "Fetch channel"}
          </button>
        </form>
        {!props.signedIn && (
          <p className="mt-2 px-1 text-sm text-[var(--dim)]">
            No account needed — fetching public channel stats and the calculator are free for everyone.
          </p>
        )}

        {(props.fetching || profile?.status === "pending") && (
          <div className="mt-3">
            <WorkingPanel
              title={profile?.status === "pending" ? `Fetching “${profile.query}” from YouTube…` : "Starting your YouTube fetch…"}
              steps={[
                "Finding your channel on YouTube",
                "Reading your last 10 videos",
                "Adding up views, likes and comments",
                "Working out your engagement rate",
                "Building your rate card from the real numbers",
              ]}
              stepSeconds={7}
              footnote="Usually under a minute. Keep this tab open."
            />
          </div>
        )}
        {profile?.status === "error" && (
          <div className="card mt-3 p-4">
            <p className="font-medium">That fetch did not work.</p>
            <p className="mt-1 text-sm text-[var(--dim)]">{profile.error ?? "Check the handle and try again, or enter your numbers manually below."}</p>
          </div>
        )}
        {profile && (profile.status === "done" || profile.status === "manual") && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            transition={SPRING_UI}
            className="card mt-3 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 text-xl font-bold [overflow-wrap:anywhere]">
                {profile.title ?? profile.query} {profile.handle ? <span className="text-base font-normal text-[var(--dim)]">{profile.handle}</span> : null}
              </p>
              <p className="flex-none text-xs text-[var(--dim)]">
                {profile.status === "manual" ? "Numbers you entered" : `Fetched ${profile.fetchedAt ? new Date(profile.fetchedAt).toLocaleString() : ""}`}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Subscribers", profile.subscribers],
                  ["Avg views · last 10", profile.avgViews],
                  ["Avg likes", profile.avgLikes],
                ] as [string, number | null][]
              ).map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-[var(--surface-alt)] px-3 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">{k}</dt>
                  <dd className="tnum font-display text-xl font-bold">{v != null ? <AnimatedCount value={v} /> : "—"}</dd>
                </div>
              ))}
              <div className="rounded-2xl bg-[var(--surface-alt)] px-3 py-2.5">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">Engagement</dt>
                <dd className="tnum font-display text-xl font-bold">
                  {profile.engagementPct != null ? <AnimatedCount value={profile.engagementPct} suffix="%" plain /> : "—"}
                </dd>
              </div>
            </dl>
            {profile.status === "done" && (
              <button type="button" className={btnGhost + " mt-3"} onClick={() => props.onFetch(profile.query)} disabled={props.fetching}>
                {props.fetching ? <span className="inline-flex items-center gap-2"><Spinner /> Re-fetching…</span> : "Re-fetch latest numbers"}
              </button>
            )}
          </motion.div>
        )}

        {props.signedIn && (<>
        <button type="button" className="mt-3 text-sm font-medium text-[var(--accent)] underline" onClick={() => setShowManual((s) => !s)} aria-expanded={showManual}>
          {showManual ? "Hide manual entry" : "No fetch? Enter your numbers manually"}
        </button>
        {showManual && (
          <form
            className="card mt-3 grid grid-cols-2 gap-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const v = parseFloat(mViews);
              const en = parseFloat(mEng);
              if (mLabel.trim() && v > 0 && !Number.isNaN(en)) {
                props.onManual({ label: mLabel.trim(), avgViews: v, engagementPct: en, subscribers: parseFloat(mSubs) || undefined });
              }
            }}
          >
            <div className="col-span-2">
              <label className={labelCls} htmlFor="m-label">Channel name</label>
              <input id="m-label" className={inputCls} value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="My channel" />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-views">Avg views, last 10 videos</label>
              <input id="m-views" className={inputCls} inputMode="numeric" value={mViews} onChange={(e) => setMViews(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-eng">Engagement % (likes+comments ÷ views)</label>
              <input id="m-eng" className={inputCls} inputMode="decimal" value={mEng} onChange={(e) => setMEng(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls} htmlFor="m-subs">Subscribers (optional)</label>
              <input id="m-subs" className={inputCls} inputMode="numeric" value={mSubs} onChange={(e) => setMSubs(e.target.value)} placeholder="0" />
            </div>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary} disabled={props.manualSaving}>Use these numbers</button>
            </div>
          </form>
        )}
        </>)}
      </section>

      {/* Calculator */}
      <section aria-label="Price calculator">
        <SectionTitle>Calculator</SectionTitle>

        <motion.div
          {...itemAnim(0, reduce)}
          className="card mt-4 p-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="c-views">Average views</label>
              <input id="c-views" className={inputCls} inputMode="numeric" value={avgViews} onChange={(e) => setAvgViews(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-eng">Engagement %</label>
              <input id="c-eng" className={inputCls} inputMode="decimal" value={engagement} onChange={(e) => setEngagement(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls} htmlFor="c-country">Audience country</label>
              <select
                id="c-country"
                className={inputCls}
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  if (!cpmTouched) setCpm(String(COUNTRY_CPM[e.target.value] ?? 15));
                }}
              >
                {Object.keys(COUNTRY_CPM).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="c-cpm">Base CPM — editable</label>
              <input
                id="c-cpm" className={inputCls} inputMode="decimal" value={cpm}
                onChange={(e) => { setCpm(e.target.value); setCpmTouched(true); }}
              />
              <p className="mt-1 text-xs text-[var(--dim)]">≈ {moneyFromUsd(cpmNum, currency, inrRate)} per 1,000 views in {country}. Set it to what brands in your market actually pay.</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="c-niche">Niche</label>
              <select id="c-niche" className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)}>
                {Object.keys(NICHE_MULT).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="c-deliv">Deliverable</label>
              <select id="c-deliv" className={inputCls} value={deliverable} onChange={(e) => setDeliverable(e.target.value)}>
                {DELIVERABLES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              data-sound="toggle"
              aria-expanded={showHow}
              onClick={() => setShowHow((s) => !s)}
              className="btn-press flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-sm font-bold">How we calculated your rate</span>
              <span className={`flex-none text-[var(--dim)] transition-transform duration-200 ${showHow ? "rotate-180" : ""}`}><IconChevronDown /></span>
            </button>
            {showHow && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={SPRING_UI}
                className="pt-1"
              >
                {mid > 0 ? (
                  <p className="font-display text-base leading-relaxed">
                    {fmt(viewsNum)} views ÷ 1,000 × {moneyFromUsd(cpmNum, currency, inrRate)} CPM ({country}) × {nicheMult} ({niche}) × {deliv.mult} ({deliv.label.toLowerCase()}) × {ef.toFixed(2)} engagement ={" "}
                    <strong>{moneyFromUsd(mid, currency, inrRate)} {currency}</strong> — the midpoint of your range.
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-[var(--dim)]">
                    Price = your views ÷ 1,000 × {moneyFromUsd(cpmNum, currency, inrRate)} CPM ({country}) × {nicheMult} ({niche}) × {deliv.mult} ({deliv.label.toLowerCase()}) × engagement factor. CPM is worked out in USD and converted at {currency === "INR" ? `₹${inrRate} per $1` : "the app rate"} — type your views above to see it with your numbers.
                  </p>
                )}
                <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-[var(--dim)]">
                  <li>
                    <strong className="text-[var(--text)]">CPM — {moneyFromUsd(cpmNum, currency, inrRate)} per 1,000 views.</strong>{" "}
                    The starting rate for a {country} audience. It's an editable assumption (change it above), not live market data — set it to what brands in your market actually offer you.
                  </li>
                  <li>
                    <strong className="text-[var(--text)]">Engagement — ×{ef.toFixed(2)}.</strong>{" "}
                    3% engagement counts as neutral (×1.00); each point above or below moves the factor by 0.08, between ×0.75 and ×1.50. A more engaged audience is worth more to a brand, so the estimate rises with it.
                  </li>
                  <li>
                    <strong className="text-[var(--text)]">Niche — ×{nicheMult}.</strong>{" "}
                    Advertisers in {niche} are assumed to pay {nicheMult >= 1 ? "more" : "less"} per view than an average niche, so the same views price {nicheMult >= 1 ? "higher" : "lower"}. It's a working assumption, shown openly — not a measured benchmark.
                  </li>
                  <li>
                    <strong className="text-[var(--text)]">Deliverable — ×{deliv.mult}.</strong>{" "}
                    A dedicated video is the full-value format (×1.0); shorter or lighter formats are scaled down from it.
                  </li>
                  <li>
                    <strong className="text-[var(--text)]">The range.</strong>{" "}
                    The low end (80% of the midpoint) is your minimum target; the high end is 125%. Most negotiations open high and settle somewhere inside.
                  </li>
                </ul>
                <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
                  This is an estimate built only from your inputs and these assumptions — never a guaranteed market price. What a brand finally pays depends on their budget, the campaign and the negotiation.
                </p>
              </motion.div>
            )}
          </div>

          {props.signedIn ? (
            <button
              type="button"
              className={btnPrimary + " mt-5 w-full"}
              disabled={props.calculating || mid === 0}
              onClick={() =>
                props.onCalculate({
                  label: profile?.title ?? profile?.handle ?? "My channel",
                  avgViews: viewsNum, engagementPct: engNum, audienceCountry: country,
                  niche, deliverable, cpm: cpmNum,
                })
              }
            >
              {props.calculating ? "Saving…" : "Save this rate"}
            </button>
          ) : (
            <button
              type="button"
              className={btnPrimary + " mt-5 w-full"}
              disabled={mid === 0 || props.authPending}
              onClick={props.onAuthAction}
            >
              {props.authPending ? "Checking your login…" : "Save this rate"}
            </button>
          )}
        </motion.div>
      </section>

      {/* Estimated range — the calculator's result, shown below it.
          All values start at 0 and only fill in once the creator
          fetches a channel or types numbers into the calculator. */}
      <section aria-label="Your estimated range">
        <motion.div {...itemAnim(1, reduce)} className="card relative overflow-visible p-6">
          {showConfetti && !reduce && <ConfettiBurst />}
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--dim)]">Your estimated range · {deliv.label}</p>
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={SPRING_UI}
          >
            <p className="tnum relative mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="price-glow" aria-hidden />
              <span className="font-display relative text-[clamp(2.5rem,11.5vw,4rem)] font-bold leading-none text-[var(--accent)]">
                <AnimatedMoney usd={rangeLow} currency={currency} inrRate={inrRate} />
              </span>
              <span className="relative text-2xl font-bold text-[var(--dim)]">–</span>
              <span className="font-display relative text-[clamp(2.5rem,11.5vw,4rem)] font-bold leading-none text-[var(--accent)]">
                <AnimatedMoney usd={rangeHigh} currency={currency} inrRate={inrRate} />
              </span>
              <span className="relative text-lg font-semibold text-[var(--dim)]">{currency} {perLabel}</span>
            </p>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-2xl bg-[var(--surface-alt)] px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">Minimum target</p>
                <p className="tnum font-display mt-0.5 text-xl font-bold">
                  <AnimatedMoney usd={rangeLow} currency={currency} inrRate={inrRate} />
                </p>
                <p className="mt-0.5 text-xs text-[var(--dim)]">Your floor — try not to settle below it.</p>
              </div>
              <div className="rounded-2xl bg-[var(--surface-alt)] px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dim)]">Aim for</p>
                <p className="tnum font-display mt-0.5 text-xl font-bold">
                  <AnimatedMoney usd={shownMid} currency={currency} inrRate={inrRate} />
                </p>
                <p className="mt-0.5 text-xs text-[var(--dim)]">The midpoint — a fair target for most deals.</p>
              </div>
            </div>
            {mid === 0 ? (
              <p className="mt-3.5 text-sm leading-relaxed text-[var(--dim)]">
                Fetch your channel above, or type your numbers into the calculator, and your estimated range will appear here.
              </p>
            ) : (
              <p className="mt-3.5 text-sm leading-relaxed text-[var(--dim)]">
                An estimate from your numbers and the assumptions in “How we calculated your rate” above — not a guaranteed price. Open near the top of the range and negotiate down toward your target.
              </p>
            )}
          </motion.div>
        </motion.div>
      </section>

      {/* Saved rate cards */}
      {data.calculations.length > 0 && (
        <section aria-label="Saved rate cards">
          <SectionTitle>Saved rate cards</SectionTitle>
          <ul className="card mt-3 divide-y divide-[var(--border)] px-4">
            {data.calculations.map((c, i) => (
              <motion.li key={c.id} {...itemAnim(i, reduce)} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="tnum font-display text-lg font-bold">{moneyFromUsd(c.priceMid, currency, inrRate)} <span className="text-sm font-normal text-[var(--dim)]">({moneyFromUsd(c.priceLow, currency, inrRate)} – {moneyFromUsd(c.priceHigh, currency, inrRate)})</span></p>
                  <p className="text-sm text-[var(--dim)] [overflow-wrap:anywhere]">
                    {c.label} · {DELIVERABLES.find((d) => d.key === c.deliverable)?.label ?? c.deliverable} · {c.niche} · {c.audienceCountry} · {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button type="button" aria-label={`Delete rate card ${c.id}`} className={btnGhost + " flex-none"} onClick={() => props.onDeleteCalc(c.id)}>Delete</button>
              </motion.li>
            ))}
          </ul>
          {latest && <p className="mt-2 text-xs text-[var(--dim)]">Your newest rate card is what pitch emails quote.</p>}
        </section>
      )}
    </div>
  );
}

/* ---------------- Brands tab ---------------- */

import { COUNTRIES, DEFAULT_COUNTRY, countryByName } from "./countries";

/* ---------------- Searchable country picker ----------------
   A text field that filters the worldwide country list as the
   creator types, so they can pick their creator/audience market
   by name. One country at a time. The choice is saved on this
   device (localStorage) and sent to the backend with every
   search, so the market genuinely changes the results. */
const BRAND_COUNTRY_KEY = "dealrate-brand-country";

function readSavedBrandCountry(): string {
  try {
    const saved = window.localStorage.getItem(BRAND_COUNTRY_KEY);
    if (saved && countryByName(saved)) return saved;
  } catch {
    /* non-fatal */
  }
  return DEFAULT_COUNTRY;
}

function CountrySelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => { setQuery(value); }, [value ]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [query ]);
  const shown = matches.slice(0, 12);

  const pick = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
    try { window.localStorage.setItem(BRAND_COUNTRY_KEY, name); } catch { /* non-fatal */ }
  };

  return (
    <div className="relative">
      <input
        id="b-country"
        className={inputCls}
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls="b-country-list"
        aria-autocomplete="list"
        placeholder="Search countries…"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && shown[highlight]) { e.preventDefault(); pick(shown[highlight].name); }
          else if (e.key === "Escape") { setOpen(false); setQuery(value); }
        }}
        onBlur={() => {
          // Delay so a tap on a list item lands before we close.
          window.setTimeout(() => {
            setOpen(false);
            setQuery((q) => (countryByName(q) ? q : value));
          }, 150);
        }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onMouseDown={(e) => { e.preventDefault(); setOpen(false); setQuery(value); }} />
          <ul
            id="b-country-list"
            ref={listRef}
            role="listbox"
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
          >
            {shown.length === 0 && (
              <li className="px-3 py-2 text-sm text-[var(--dim)]">No country matches that name.</li>
            )}
            {shown.map((c, i) => (
              <li key={c.code} role="option" aria-selected={c.name === value}>
                <button
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm ${i === highlight ? "bg-[var(--surface-alt)]" : ""} ${c.name === value ? "font-bold text-[var(--accent)]" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); pick(c.name); }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* Sponsorship classification shown on a brand card. The label is
   the honest evidence category — never a promise the brand will
   pay. */
const CLASSIFICATION_META: Record<string, { label: string; cls: string }> = {
  verified_paid: { label: "Verified Paid Collaborations", cls: "bg-[var(--accent)] text-[var(--accent-ink)]" },
  active_program: { label: "Active Paid Creator Program", cls: "bg-[var(--violet)] text-white" },
  international_paid: { label: "International Paid Partnership", cls: "bg-[#38bdf8] text-black" },
  potential: { label: "Potential Partnership", cls: "bg-[var(--surface-alt)] text-[var(--text)]" },
  affiliate_only: { label: "Affiliate Only", cls: "bg-[var(--amber)] text-black" },
};

function classificationMeta(classification: string | null): { label: string; cls: string } {
  return CLASSIFICATION_META[classification ?? ""] ?? CLASSIFICATION_META.potential;
}

/** A saved suggestion belongs to the niche + creator market it was
 *  discovered for. The suggestions list is filtered to the niche and
 *  market the user currently has selected, so picking a different
 *  niche shows that niche's brands — not the same list every time.
 *  Without this, Business and Gaming (or any two niches) show
 *  identical cards and the finder looks broken. */
function sameNicheMarket(
  b: { niche?: string | null; creatorMarket?: string | null },
  niche: string,
  country: string,
): boolean {
  return (
    (b.niche ?? "").trim().toLowerCase() === niche.trim().toLowerCase() &&
    (b.creatorMarket ?? "").trim().toLowerCase() === country.trim().toLowerCase()
  );
}

function sameMarket(
  b: { creatorMarket?: string | null },
  country: string,
): boolean {
  return (b.creatorMarket ?? "").trim().toLowerCase() === country.trim().toLowerCase();
}

/* Group a brand list by niche, with the selected niche first and the
   other groups after it (most recently added first). The list the user
   just searched for is never buried under older results from other
   niches — it is always the top group. */
function groupByNiche<T extends { niche?: string | null; id: number }>(
  list: T[],
  selectedNiche: string,
): { niche: string; brands: T[] }[] {
  const byNiche = new Map<string, T[]>();
  for (const b of list) {
    const key = (b.niche ?? "Other").trim() || "Other";
    const arr = byNiche.get(key);
    if (arr) arr.push(b);
    else byNiche.set(key, [b]);
  }
  const norm = (s: string) => s.trim().toLowerCase();
  const groups = [...byNiche.entries()].map(([niche, brands]) => ({ niche, brands }));
  groups.sort((a, b) => {
    const aSel = norm(a.niche) === norm(selectedNiche);
    const bSel = norm(b.niche) === norm(selectedNiche);
    if (aSel !== bSel) return aSel ? -1 : 1;
    // Most recently added group first (highest brand id).
    const aMax = Math.max(...a.brands.map((x) => x.id));
    const bMax = Math.max(...b.brands.map((x) => x.id));
    return bMax - aMax;
  });
  return groups;
}

function BrandsTab({ data, userId, accessToken, invalidate, goDeals, onDealAdded }: { data: Dash; userId: string; accessToken?: string; invalidate: () => void; goDeals: () => void; onDealAdded?: (dealId: number) => void }) {
  const reduce = useReducedMotion();
  const [niche, setNiche] = useState("Tech");
  const [country, setCountry] = useState(() => readSavedBrandCountry());
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");

  const discoverMut = useMutation({
    mutationFn: () => api.discoverBrands({ userId, accessToken, niche, country }),
    onMutate: () => { setMsg(""); },
    onSuccess: (r) => {
      setMsg(r.message);
      invalidate();
      if (r.found > 0) {
        toast.success(`Found ${r.found} brand suggestion${r.found === 1 ? "" : "s"} to review`);
      }
      // Fill in contact emails as a second, separate call. The
      // search itself has to stay fast (Netlify kills slow calls
      // with a 504), so the email lookup runs after it and the list
      // refreshes when the emails land a few seconds later. This
      // runs on EVERY successful search — not only when new brands
      // were found — so re-searching a niche also fills in (and
      // repairs) emails on the older cached cards for that niche,
      // instead of leaving them blank or broken.
      api.enrichBrandEmails({ userId, accessToken, niche, country })
        .then(() => invalidate())
        .catch(() => { /* brands still show, just without emails */ });
    },
    onError: (e) => { const m = e instanceof Error && e.message ? e.message : "Brand search failed. Check your connection and try again."; setMsg(m); toast.error(m); },
  });
  const addMut = useMutation({
    mutationFn: () => api.addBrand({ userId, accessToken, name: name.trim(), contactEmail: email.trim() || undefined, website: website.trim() || undefined, niche }),
    onSuccess: () => { setName(""); setEmail(""); setWebsite(""); invalidate(); toast.success("Brand added to your list"); },
    onError: () => toast.error("Could not add that brand. Try again."),
  });
  const dealMut = useMutation({
    mutationFn: (b: Dash["brands"][number]) => api.addBrandToDeals({ userId, accessToken, brandId: b.id }),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.created ? "Added to Deals — it's in your pipeline" : "Already in Deals — opening it");
      onDealAdded?.(r.dealId);
      goDeals();
    },
    onError: () => toast.error("Could not add that deal. Try again."),
  });

  // A brand already has a deal when a pipeline deal matches its name.
  const dealByBrand = new Map(
    data.deals.map((d) => [d.brandName.trim().toLowerCase(), d]),
  );
  const dealFor = (brandName: string) =>
    dealByBrand.get(brandName.trim().toLowerCase()) ?? null;

  // Suggestions and agencies are grouped by niche, not hidden by it:
  // the niche the user picked (and just searched) is the top group,
  // and every other niche's saved brands sit in their own group below.
  const suggestionGroups = groupByNiche(
    data.brands.filter((b) => b.isSuggestion && !b.isAgency && sameMarket(b, country)),
    niche,
  );
  const agencyGroups = groupByNiche(
    data.brands.filter((b) => b.isSuggestion && b.isAgency && sameMarket(b, country)),
    niche,
  );
  const selectedSuggestionGroup = suggestionGroups.find(
    (g) => g.niche.trim().toLowerCase() === niche.trim().toLowerCase(),
  );
  const mine = data.brands.filter((b) => !b.isSuggestion);

  return (
    <div className="space-y-8">
      <PageIntro
        accent="Find brands that fit your audience."
        description="Discover relevant companies and find your next collaboration opportunity."
        visual={<IntroSearchVisual />}
      />
      <section aria-label="Find brands">
        <SectionTitle right={<span className="flex-none whitespace-nowrap rounded-full bg-[var(--violet)] px-2.5 py-1 text-xs font-bold text-[var(--accent-ink)]">PRO</span>}>Brand finder</SectionTitle>
        <p className="mt-1 text-sm text-[var(--dim)]">Live web search for brands that actually pay creators in your market — including international brands that sponsor creators from {country}. Verified paid brands are listed first. You pick who enters your pipeline — nothing is contacted without you.</p>
        <form
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); discoverMut.mutate(); }}
        >
          <div>
            <label className={labelCls} htmlFor="b-niche">Niche</label>
            <select id="b-niche" className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)}>
              {Object.keys(NICHE_MULT).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="b-country">Creator / Audience Market</label>
            <CountrySelect value={country} onChange={setCountry} />
          </div>
          <button type="submit" className={btnPrimary + " sm:col-span-2"} disabled={discoverMut.isPending || niche.trim().length < 2}>
            {discoverMut.isPending
              ? <span className="inline-flex items-center gap-2"><Spinner /> Searching — results are coming…</span>
              : "Search for brands"}
          </button>
        </form>
        {discoverMut.isPending && (
          <div className="mt-4 space-y-3">
            <WorkingPanel
              title={`Finding ${niche.trim() || "your niche"} brands that pay creators…`}
              steps={[
                `Searching the web for ${niche.trim() || "creator"} brands & partnership programs`,
                "Checking creator and affiliate programs",
                "Reading the most promising brand pages",
                "Picking the best matches for your channel",
              ]}
              stepSeconds={6}
              footnote="Real search takes a little while. Nothing is contacted without you."
            />
            <SkeletonCard />
            <SkeletonCard lines={2} />
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-[var(--dim)]" role="status">{msg}</p>}
      </section>

      <section aria-label="Brand suggestions">
        <SectionTitle>Suggestions to review</SectionTitle>
        <p className="mt-1 text-sm text-[var(--dim)]">Brands are ranked by the strength of their paid sponsorship evidence. A listing is not a promise the brand will accept your proposal.</p>
        {!selectedSuggestionGroup && (
          <p className="mt-3 text-sm text-[var(--dim)]">No brands saved for {niche} + {country} yet. Tap "Search for brands" above to discover some.</p>
        )}
        {suggestionGroups.map((group) => (
          <div key={group.niche} className="mt-5">
            <h3 className="text-base font-bold">{group.niche} <span className="text-sm font-medium text-[var(--dim)]">({group.brands.length})</span></h3>
            <ul className="mt-3 space-y-3">
              {group.brands.map((b, i) => {
              const meta = classificationMeta(b.classification);
              const ev = b.evidence;
              return (
                <motion.li key={b.id} {...itemAnim(i, reduce)} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-display text-lg font-bold [overflow-wrap:anywhere]">{b.name}</p>
                    <span className={`flex-none whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
                  </div>
                  {(b.industry || b.hqCountry || b.creatorMarket) && (
                    <p className="mt-0.5 text-sm text-[var(--dim)]">
                      {[b.industry, b.hqCountry ? `Headquarters: ${b.hqCountry}` : null, b.creatorMarket ? `Creator market: ${b.creatorMarket}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {ev?.evidence && (
                    <p className="mt-2 text-sm leading-relaxed">
                      <span className="font-semibold">Sponsorship evidence: </span>{ev.evidence}
                    </p>
                  )}
                  {(ev?.exampleCreator || ev?.platform || ev?.evidenceDate) && (
                    <p className="mt-1 text-sm text-[var(--dim)]">
                      {[ev.exampleCreator, ev.platform, ev.evidenceDate].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {b.contactEmail && (
                    <p className="mt-1 text-sm">
                      Contact: <a href={`mailto:${b.contactEmail}`} className="font-medium text-[var(--accent)] underline">{b.contactEmail}</a>
                    </p>
                  )}
                  {!b.contactEmail && ev?.contactPageUrl && (
                    <p className="mt-1 text-sm text-[var(--dim)]">
                      No public email found — this brand takes messages through a form.{" "}
                      <a href={ev.contactPageUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] underline">Contact them through their website</a>
                    </p>
                  )}
                  {b.notes && <p className="mt-1 line-clamp-3 text-sm text-[var(--dim)]">{b.notes}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                    {b.website && (
                      <a href={b.website} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Visit Official Website</a>
                    )}
                    {ev?.evidenceUrl && (
                      <a href={ev.evidenceUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">View Sponsorship Evidence</a>
                    )}
                    {ev?.partnershipUrl && (
                      <a href={ev.partnershipUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">View Partnership Page</a>
                    )}
                    {b.sourceUrl && !ev?.evidenceUrl && (
                      <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="max-w-full truncate text-[var(--accent)] underline">{b.sourceUrl}</a>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dealFor(b.name) ? (
                      <button type="button" className={btnPrimary} onClick={() => goDeals()}>
                        Open Deal
                      </button>
                    ) : (
                      <button type="button" className={btnPrimary} disabled={dealMut.isPending} onClick={() => dealMut.mutate(b)}>
                        {dealMut.isPending ? "Adding…" : "Add to Deals"}
                      </button>
                    )}
                    <button type="button" className={btnGhost} onClick={() => api.deleteBrand({ userId, accessToken, id: b.id }).then(invalidate)}>Dismiss</button>
                  </div>
                </motion.li>
              );
              })}
            </ul>
          </div>
        ))}
      </section>

      {agencyGroups.length > 0 && (
        <section aria-label="Creator agencies and marketplaces">
          <SectionTitle>Creator Agencies &amp; Marketplaces</SectionTitle>
          <p className="mt-1 text-sm text-[var(--dim)]">These are agencies and platforms that connect creators with brands — not direct brand sponsorships. They are listed separately on purpose.</p>
          {agencyGroups.map((group) => (
            <div key={group.niche} className="mt-5">
              <h3 className="text-base font-bold">{group.niche} <span className="text-sm font-medium text-[var(--dim)]">({group.brands.length})</span></h3>
              <ul className="mt-3 space-y-3">
                {group.brands.map((b, i) => (
              <motion.li key={b.id} {...itemAnim(i, reduce)} className="card p-4">
                <p className="font-display text-lg font-bold [overflow-wrap:anywhere]">{b.name}</p>
                {b.notes && <p className="mt-0.5 line-clamp-3 text-sm text-[var(--dim)]">{b.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                  {b.website && (
                    <a href={b.website} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Visit Website</a>
                  )}
                  {b.sourceUrl && (
                    <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="max-w-full truncate text-[var(--accent)] underline">{b.sourceUrl}</a>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={() => api.deleteBrand({ userId, accessToken, id: b.id }).then(invalidate)}>Dismiss</button>
                </div>
              </motion.li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section aria-label="My brands">
        <SectionTitle>My brands</SectionTitle>
        <p className="mt-1 text-sm text-[var(--dim)]">Your saved shortlist — add any of them to Deals when you are ready.</p>
        <form
          className="mt-3 grid grid-cols-1 gap-3 card p-4 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) addMut.mutate(); }}
        >
          <div>
            <label className={labelCls} htmlFor="mb-name">Brand name</label>
            <input id="mb-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="BrandCo" />
          </div>
          <div>
            <label className={labelCls} htmlFor="mb-email">Contact email</label>
            <input id="mb-email" className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partnerships@brand.com" />
          </div>
          <div>
            <label className={labelCls} htmlFor="mb-web">Website</label>
            <input id="mb-web" className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="brand.com" />
          </div>
          <button type="submit" className={btnGhost + " sm:col-span-3"} disabled={addMut.isPending || !name.trim()}>Add brand</button>
        </form>

        {mine.length === 0 && <p className="mt-3 text-sm text-[var(--dim)]">No brands yet. Search above or add one you already have in mind.</p>}
        <ul className="mt-3 space-y-3">
          {mine.map((b, i) => (
            <motion.li key={b.id} {...itemAnim(i, reduce)} className="flex flex-wrap items-center justify-between gap-3 card p-4">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-display text-lg font-bold [overflow-wrap:anywhere]">{b.name}</p>
                <p className="text-sm text-[var(--dim)] [overflow-wrap:anywhere]">{[b.contactEmail, b.website, b.niche].filter(Boolean).join(" · ") || "No contact details yet"}</p>
              </div>
              <div className="flex flex-none gap-2">
                {dealFor(b.name) ? (
                  <button type="button" className={btnPrimary} onClick={() => goDeals()}>Open Deal</button>
                ) : (
                  <button type="button" className={btnPrimary} disabled={dealMut.isPending} onClick={() => dealMut.mutate(b)}>{dealMut.isPending ? "Adding…" : "Add to Deals"}</button>
                )}
                <button type="button" aria-label={`Remove ${b.name}`} className={btnGhost} onClick={() => api.deleteBrand({ userId, accessToken, id: b.id }).then(invalidate)}>Remove</button>
              </div>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------- Deals tab ---------------- */

/* ---------------- AI Brand Research ---------------- */

function BrandResearchSection({ deal, userId, accessToken, invalidate, autoResearch, onAutoResearchDone }: { deal: Deal; userId: string; accessToken?: string; invalidate: () => void; autoResearch?: boolean; onAutoResearchDone?: () => void }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const startedRef = useRef(false);
  const researchMut = useMutation({
    mutationFn: (force: boolean) => api.researchBrand({ userId, accessToken, dealId: deal.id, force: force || undefined }),
    onSuccess: () => { invalidate(); toast.success("Brand research ready"); },
    onError: (e) => { toast.error(e instanceof Error ? e.message : "Could not research this brand. Try again."); },
    onSettled: () => { onAutoResearchDone?.(); },
  });
  // Auto-start once when this brand was just added to Deals.
  useEffect(() => {
    if (autoResearch && !deal.research && !startedRef.current) {
      startedRef.current = true;
      setOpen(true);
      researchMut.mutate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResearch]);
  const r = deal.research;
  const topics = r
    ? [
        { label: "Official website", value: r.website, link: true },
        { label: "Products & services", value: r.products },
        { label: "Marketing", value: r.marketing },
        { label: "Influencer collaborations", value: r.influencerCollaborations },
        { label: "Creator partnership program", value: r.creatorProgram },
        { label: "Influencer campaigns", value: r.campaigns },
        { label: "Affiliate opportunities", value: r.affiliate },
        { label: "Country opportunities", value: r.countryOpportunities },
        { label: "Business contact", value: r.contact },
      ]
    : [];
  const found = topics.filter((t) => t.value);
  const missing = topics.filter((t) => !t.value).map((t) => t.label);
  const checked = deal.researchCheckedAt ? new Date(deal.researchCheckedAt).toLocaleDateString() : null;
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-left font-display text-base font-bold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          AI Brand Research {open ? "▾" : "▸"}
        </button>
        {r && checked && <span className="text-xs text-[var(--dim)]">Checked {checked}</span>}
      </div>
      {open && (
        <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }} transition={SPRING_UI} className="space-y-3">
          {researchMut.isPending && (
            <p className="inline-flex items-center gap-2 text-sm text-[var(--dim)]"><Spinner /> Researching {deal.brandName}… checking the official site and public sources.</p>
          )}
          {!researchMut.isPending && !r && (
            <div className="space-y-2">
              <p className="text-sm text-[var(--dim)]">AI checks the brand's official website, products, marketing, creator programs, campaigns, affiliate options and public contact details — only from public sources, with links.</p>
              <button type="button" className={btnPrimary} disabled={researchMut.isPending} onClick={() => researchMut.mutate(false)}>
                Research this brand
              </button>
            </div>
          )}
          {r && (
            <>
              {found.length === 0 && <p className="text-sm text-[var(--dim)]">No public information found for {deal.brandName} yet. Try refreshing later.</p>}
              <dl className="space-y-3">
                {found.map((t) => (
                  <div key={t.label}>
                    <dt className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">{t.label}</dt>
                    <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">
                      {t.link && t.value && /^https?:\/\//i.test(t.value) ? (
                        <a href={t.value} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] underline">{t.value}</a>
                      ) : (
                        t.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {missing.length > 0 && (
                <p className="text-xs text-[var(--dim)]">No public evidence found for: {missing.join(", ")}. Nothing was invented for these.</p>
              )}
              {Array.isArray(r.contacts) && r.contacts.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Discovered contacts</p>
                  <ul className="mt-1 space-y-2">
                    {r.contacts.map((c) => (
                      <li key={c.email} className="text-sm">
                        <p className="font-medium [overflow-wrap:anywhere]">{c.email}</p>
                        <p className="text-xs text-[var(--dim)]">
                          {c.category ?? "Business Contact"}
                          {c.sourceUrl ? (<> · <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a></>) : ""}
                          {c.mxVerified === false ? " · domain cannot receive mail" : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-[var(--dim)]">The best match is saved as this deal's brand email. Pick another from the brand email field.</p>
                </div>
              )}
              {Array.isArray(r.phones) && r.phones.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Phone</p>
                  <ul className="mt-1 space-y-1">
                    {r.phones.map((p) => (
                      <li key={p.phone} className="text-sm">
                        <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-[var(--accent)] underline">{p.phone}</a>
                        {p.sourceUrl ? (<span className="text-xs text-[var(--dim)]"> · <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a></span>) : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(r.contacts) && r.contacts.length === 0 && (!Array.isArray(r.phones) || r.phones.length === 0) && (
                <p className="text-xs text-[var(--dim)]">
                  No public email or phone found for this brand — most brands only take messages through a form.{" "}
                  {r.contactPageUrl ? (
                    <a href={r.contactPageUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] underline">Contact them through their website</a>
                  ) : (
                    "Add an email manually or visit the official contact page."
                  )}
                </p>
              )}
              {r.sources.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Sources</p>
                  <ul className="mt-1 space-y-1">
                    {r.sources.map((s, i) => (
                      <li key={`${s.url}-${i}`} className="text-sm">
                        <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] underline [overflow-wrap:anywhere]">{s.title || s.url}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button type="button" className={btnGhost} disabled={researchMut.isPending} onClick={() => researchMut.mutate(true)}>
                {researchMut.isPending ? "Refreshing…" : "Refresh research"}
              </button>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}

/* Shown when a send failed only because the Gmail permission was
   never granted. One tap re-runs Google sign-in asking for gmail.send
   on top of the basic scopes, then returns to the app — the creator
   taps Send again and it goes through. Google shows its
   unverified-app warning on that consent screen (the app is not
   verified yet); the panel says so plainly and what to tap. */
function GmailGrantPanel() {
  const [granting, setGranting] = useState(false);
  return (
    <div className="mt-3 rounded-2xl border border-[var(--amber)] bg-[var(--surface-alt)] px-4 py-3.5" role="alert">
      <p className="text-sm font-bold">Allow Gmail sending to send this</p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        DealRate needs your permission to send email from your Gmail. Google will show a warning because the app is not verified yet — tap Advanced, then the “Go to … (unsafe)” link, then Continue. You will come back here; tap Send again and it goes through.
      </p>
      <button
        type="button"
        className={btnPrimary + " mt-3"}
        disabled={granting}
        onClick={async () => { setGranting(true); await requestGmailSendScope(); }}
      >
        {granting ? "Opening Google…" : "Allow Gmail sending"}
      </button>
    </div>
  );
}

/* Discovered brand contacts — a bottom sheet listing every publicly
   found sponsorship contact for a deal, best-ranked first. The
   creator picks one (it becomes the deal's brand email) or keeps
   their own typed address. Nothing is sent from here; sending only
   happens from the pitch / invoice cards after the creator reviews. */
function BrandContactsSheet({ open, onClose, deal, userId, accessToken, invalidate }: {
  open: boolean;
  onClose: () => void;
  deal: Deal;
  userId: string;
  accessToken?: string;
  invalidate: () => void;
}) {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const contactsQuery = useQuery({
    queryKey: ["brand-contacts", deal.id],
    queryFn: () => api.listBrandContacts({ userId, accessToken, dealId: deal.id }),
    enabled: open,
  });
  const selectMut = useMutation({
    mutationFn: (contactId: number) => api.selectBrandContact({ userId, accessToken, dealId: deal.id, contactId }),
    onSuccess: (r) => {
      setSelectedId(null);
      invalidate();
      toast.success(`Brand email set to ${r.email}`);
      onClose();
    },
    onError: () => toast.error("Could not use that contact. Try again."),
  });
  const contacts = contactsQuery.data?.contacts ?? [];
  const website = deal.research?.website ?? null;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="contacts-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="contacts-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Discovered contacts for ${deal.brandName}`}
            initial={reduce ? { opacity: 0 } : { y: "105%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "105%" }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="sheet-glass fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl rounded-t-[28px] px-6 pb-safe pt-3"
          >
            <span className="sheet-shimmer" aria-hidden />
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" aria-hidden />
            <div className="mt-3 flex items-center justify-between gap-2">
              <h2 className="display-tight font-headline text-[22px] font-bold">Brand contacts</h2>
              <button type="button" className={btnGhost} onClick={onClose}>Close</button>
            </div>
            <p className="mt-1 text-sm text-[var(--dim)]">
              Publicly listed contacts for {deal.brandName}, best match first. Pick one to use as this deal's brand email.
            </p>
            {contactsQuery.isPending && (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--dim)]" role="status"><Spinner /> Loading contacts…</p>
            )}
            {contactsQuery.isError && (
              <p className="mt-4 text-sm text-[var(--danger)]" role="alert">Could not load contacts. Try again.</p>
            )}
            {!contactsQuery.isPending && !contactsQuery.isError && contacts.length === 0 && (
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
                <p className="text-sm leading-relaxed">
                  No public email found for this brand — most brands only take messages through a form. Add an email manually, or contact them through their website.
                </p>
                {deal.research?.contactPageUrl ? (
                  <a href={deal.research.contactPageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[var(--accent)] underline [overflow-wrap:anywhere]">
                    Contact {deal.brandName} through their website
                  </a>
                ) : website ? (
                  <a href={website} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[var(--accent)] underline [overflow-wrap:anywhere]">
                    Visit {deal.brandName}'s website
                  </a>
                ) : null}
              </div>
            )}
            {contacts.length > 0 && (
              <ul className="mt-4 divide-y divide-[var(--border)]">
                {contacts.map((c) => {
                  const isCurrent = deal.brandEmail != null && deal.brandEmail.toLowerCase() === c.email.toLowerCase();
                  return (
                    <li key={c.id ?? c.email} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold [overflow-wrap:anywhere]">
                          {c.email}
                          {isCurrent && <span className="ml-2 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-bold text-[var(--accent)]">In use</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--dim)]">
                          {c.category ?? "Business Contact"}
                          {c.sourceUrl ? (
                            <> · <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a></>
                          ) : ""}
                          {c.mxVerified === false ? " · domain cannot receive mail" : ""}
                        </p>
                      </div>
                      {!isCurrent && (
                        <button
                          type="button"
                          className={btnSmall + " flex-none"}
                          disabled={selectMut.isPending && selectedId === c.id}
                          onClick={() => { setSelectedId(c.id); selectMut.mutate(c.id ?? 0); }}
                        >
                          {selectMut.isPending && selectedId === c.id ? "Using…" : "Use this"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="h-4" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* Deal conversation — the email thread for one deal, the AI reply
   assistant, the one-click approval card and content submission.
   Shown once a pitch has been sent (or a reply has arrived). Nothing
   here sends mail without the creator tapping Send, and nothing is
   auto-approved: the approval card only appears when AI classified a
   brand reply as a clear acceptance, and the creator still confirms. */
const REPLY_LABELS: Record<string, string> = {
  interested: "Interested",
  more_info: "Requesting more information",
  asking_rates: "Asking for rates",
  negotiating: "Negotiating price",
  accepting: "Accepting the collaboration",
  confirming_terms: "Confirming agreed terms",
  rejecting: "Rejecting the proposal",
  change_deliverables: "Requesting changes to deliverables",
  automated: "Automated reply",
  unrelated: "Unrelated",
};

function DealConversationSection({ deal, userId, accessToken, invalidate }: { deal: Deal; userId: string; accessToken?: string; invalidate: () => void }) {
  const reduce = useReducedMotion();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyInstruction, setReplyInstruction] = useState("");
  const [replyMsg, setReplyMsg] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [contentPlatform, setContentPlatform] = useState("YouTube");
  const [contentNotes, setContentNotes] = useState("");
  const [contentDate, setContentDate] = useState("");
  const [contentMsg, setContentMsg] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [approvePrice, setApprovePrice] = useState("");
  const [approveMsg, setApproveMsg] = useState("");
  const [invoiceMsg, setInvoiceMsg] = useState("");

  const messagesQuery = useQuery({
    queryKey: ["deal-messages", deal.id],
    queryFn: () => api.listDealMessages({ userId, accessToken, dealId: deal.id }),
    enabled: Boolean(deal.pitchSentAt),
  });
  const submissionsQuery = useQuery({
    queryKey: ["content-submissions", deal.id],
    queryFn: () => api.listContentSubmissions({ userId, accessToken, dealId: deal.id }),
    enabled: deal.stage === "approved" || deal.stage === "content_production" || deal.stage === "content_submitted" || deal.stage === "invoiced" || deal.stage === "paid",
  });
  const messages = messagesQuery.data?.messages ?? [];
  const inbound = messages.filter((m) => m.direction === "inbound");
  const latestInbound = inbound.length > 0 ? inbound[inbound.length - 1] : null;
  const acceptance = [...inbound].reverse().find((m) => m.classification === "accepting") ?? null;
  const submissions = submissionsQuery.data?.submissions ?? [];
  const canApprove = (deal.stage === "reply_received" || deal.stage === "negotiating" || deal.stage === "approved") && acceptance !== null;
  const needsFollowUp = deal.pitchSentAt && inbound.length === 0 && Date.now() - new Date(deal.pitchSentAt).getTime() > 7 * 24 * 60 * 60 * 1000;

  const draftMut = useMutation({
    mutationFn: () => api.generateReplyDraft({ userId, accessToken, dealId: deal.id, instruction: replyInstruction.trim() || undefined }),
    onSuccess: (r) => { setReplySubject(r.subject); setReplyBody(r.body); setReplyOpen(true); setReplyMsg("Draft ready — edit it below, then send."); },
    onError: () => { setReplyMsg("Could not draft a reply. Try again."); toast.error("Could not draft a reply. Try again."); },
  });
  const sendReplyMut = useMutation({
    mutationFn: async () => {
      const token = await getGoogleProviderToken();
      if (!token) throw new Error("Sign in with Google first, then tap Send again and allow Gmail sending.");
      return api.sendDealReply({ userId, accessToken, dealId: deal.id, gmailToken: token, subject: replySubject, body: replyBody });
    },
    onSuccess: (r) => {
      if (r.status === "sent") {
        setReplyMsg(r.message);
        setReplyOpen(false);
        setReplySubject("");
        setReplyBody("");
        toast.success("Reply sent from your Gmail");
        invalidate();
      } else {
        setReplyMsg(r.message);
        toast.error(r.message);
      }
    },
    onError: (e) => { setReplyMsg(e instanceof Error ? e.message : "Could not send. Try again."); toast.error("Could not send. Try again."); },
  });
  const approveMut = useMutation({
    mutationFn: () => api.approveDeal({
      userId, accessToken, dealId: deal.id,
      sourceMessageId: acceptance?.id,
      approvedPrice: parseFloat(approvePrice),
      currency: deal.currency,
      deliverables: acceptance?.deliverables ?? deal.deliverable,
      conditions: acceptance?.conditions ?? undefined,
    }),
    onSuccess: () => {
      setApproveMsg("Deal approved — time to create the content.");
      setApproveOpen(false);
      toast.success("Deal approved");
      invalidate();
    },
    onError: (e) => { setApproveMsg(e instanceof Error ? e.message : "Could not approve. Try again."); toast.error("Could not approve. Try again."); },
  });
  const submitMut = useMutation({
    mutationFn: () => api.submitContent({ userId, accessToken, dealId: deal.id, contentUrl: contentUrl.trim(), platform: contentPlatform, notes: contentNotes.trim() || undefined, publishedAt: contentDate || undefined }),
    onSuccess: () => {
      setContentMsg("Content submitted.");
      setContentUrl("");
      setContentNotes("");
      setContentDate("");
      toast.success("Content submitted");
      invalidate();
    },
    onError: (e) => { setContentMsg(e instanceof Error ? e.message : "Could not submit. Check the link and try again."); toast.error("Could not submit. Try again."); },
  });
  const invoiceMut = useMutation({
    mutationFn: () => api.createInvoiceFromDeal({ userId, accessToken, dealId: deal.id }),
    onSuccess: (r) => {
      setInvoiceMsg(`Invoice ${r.invoiceNumber} created — review and send it from the Invoices tab.`);
      toast.success("Invoice created");
      invalidate();
    },
    onError: (e) => { setInvoiceMsg(e instanceof Error ? e.message : "Could not create the invoice. Try again."); toast.error("Could not create the invoice. Try again."); },
  });

  if (!deal.pitchSentAt && inbound.length === 0) return null;

  return (
    <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Conversation</p>
        {messagesQuery.isPending && (
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--dim)]" role="status"><Spinner /> Loading conversation…</p>
        )}
        {messagesQuery.isError && (
          <p className="mt-2 text-sm text-[var(--danger)]" role="alert">Could not load the conversation. Try again.</p>
        )}
        {!messagesQuery.isPending && !messagesQuery.isError && messages.length === 0 && (
          <p className="mt-2 text-sm text-[var(--dim)]">No replies yet. The pitch is in the brand's inbox — DealRate checks for a reply every 30 minutes.</p>
        )}
        {messages.length > 0 && (
          <ul className="mt-2 space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                  {m.direction === "inbound" ? `Brand · ${deal.brandName}` : "You"}
                  {m.receivedAt ? ` · ${new Date(m.receivedAt).toLocaleDateString()}` : ""}
                  {m.classification ? ` · ${REPLY_LABELS[m.classification] ?? m.classification}` : ""}
                </p>
                {m.subject && <p className="mt-1 text-sm font-bold [overflow-wrap:anywhere]">{m.subject}</p>}
                {m.aiSummary && m.direction === "inbound" && (
                  <p className="mt-1 text-sm text-[var(--dim)]">{m.aiSummary}</p>
                )}
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{m.bodyText}</p>
              </li>
            ))}
          </ul>
        )}
        {needsFollowUp && (
          <p className="mt-2 text-xs text-[var(--dim)]">No reply in over a week. You can follow up manually — write a short nudge with the reply assistant below, or tap "Draft a reply" and send it as a follow-up.</p>
        )}
      </div>

      {acceptance && canApprove && (
        <div className="rounded-2xl border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3.5" role="alert">
          <p className="text-sm font-bold">Brand accepted the collaboration</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{acceptance.aiSummary ?? "The brand accepted the collaboration."}</p>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Brand</dt><dd className="font-medium">{deal.brandName}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Deliverables</dt><dd className="font-medium text-right [overflow-wrap:anywhere]">{acceptance.deliverables ?? deal.deliverable}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Your agreed price</dt><dd className="font-medium">{deal.agreedPrice != null ? `${deal.agreedPrice} ${deal.currency}` : "Not set"}</dd></div>
            {acceptance.statedPrice != null && (
              <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Brand's stated price</dt><dd className="font-medium">{acceptance.statedPrice} {deal.currency}</dd></div>
            )}
            {acceptance.conditions && (
              <div className="flex justify-between gap-2"><dt className="text-[var(--dim)]">Conditions</dt><dd className="font-medium text-right [overflow-wrap:anywhere]">{acceptance.conditions}</dd></div>
            )}
          </dl>
          <p className="mt-2 text-xs text-[var(--dim)]">Review the terms above. Accepting sets the agreed price and moves the deal to Content in production. Nothing is binding until you confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => { setApprovePrice(String(acceptance.statedPrice ?? deal.agreedPrice ?? "")); setApproveOpen((o) => !o); }}>
              {approveOpen ? "Hide review" : "Review agreement"}
            </button>
            <button type="button" className={btnGhost} onClick={() => { setReplyOpen(true); setReplyInstruction("Continue the negotiation — I want to discuss the terms before confirming."); }}>
              Continue negotiation
            </button>
          </div>
          {approveOpen && (
            <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
              <div>
                <label className={labelCls} htmlFor={`approve-price-${deal.id}`}>Agreed price (confirm or change)</label>
                <input id={`approve-price-${deal.id}`} className={inputCls} inputMode="decimal" value={approvePrice} onChange={(e) => setApprovePrice(e.target.value)} placeholder={deal.agreedPrice != null ? String(deal.agreedPrice) : "25000"} />
              </div>
              <button type="button" className={btnPrimary} disabled={approveMut.isPending || !approvePrice.trim() || Number.isNaN(parseFloat(approvePrice))} onClick={() => approveMut.mutate()}>
                {approveMut.isPending ? "Approving…" : "Accept and approve deal"}
              </button>
              {approveMsg && <p className="text-sm text-[var(--dim)]" role="status">{approveMsg}</p>}
            </div>
          )}
        </div>
      )}

      {inbound.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Reply assistant</p>
          <p className="mt-1 text-sm text-[var(--dim)]">AI drafts a reply from the real conversation and your agreed price. You edit it and approve it — nothing is sent without you tapping Send.</p>
          <div className="mt-2">
            <label className={labelCls} htmlFor={`reply-instruction-${deal.id}`}>What should the reply say? (optional)</label>
            <input id={`reply-instruction-${deal.id}`} className={inputCls} value={replyInstruction} onChange={(e) => setReplyInstruction(e.target.value)} placeholder="e.g. Accept the price and confirm the delivery date" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={draftMut.isPending} onClick={() => draftMut.mutate()}>
              {draftMut.isPending ? <span className="inline-flex items-center gap-2"><Spinner /> Drafting…</span> : "Draft a reply"}
            </button>
            {replyOpen && (
              <button type="button" className={btnGhost} onClick={() => { setReplyOpen(false); setReplySubject(""); setReplyBody(""); }}>Discard draft</button>
            )}
          </div>
          {replyOpen && (
            <div className="mt-3 space-y-3">
              <div>
                <label className={labelCls} htmlFor={`reply-subject-${deal.id}`}>Subject</label>
                <input id={`reply-subject-${deal.id}`} className={inputCls} value={replySubject} onChange={(e) => setReplySubject(e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor={`reply-body-${deal.id}`}>Reply (edit before sending)</label>
                <textarea id={`reply-body-${deal.id}`} className={inputCls} rows={8} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} />
              </div>
              <button type="button" className={btnPrimary} disabled={sendReplyMut.isPending || !replySubject.trim() || !replyBody.trim()} onClick={() => sendReplyMut.mutate()}>
                {sendReplyMut.isPending ? "Sending…" : "Send reply"}
              </button>
            </div>
          )}
          {replyMsg && <p className="mt-2 text-sm text-[var(--dim)]" role="status">{replyMsg}</p>}
        </div>
      )}

      {(deal.stage === "approved" || deal.stage === "content_production" || deal.stage === "content_submitted" || deal.stage === "invoiced" || deal.stage === "paid") && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Content delivery</p>
          {submissions.length > 0 && (
            <ul className="mt-2 space-y-2">
              {submissions.map((s) => (
                <li key={s.id} className="text-sm">
                  <a href={s.contentUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] underline [overflow-wrap:anywhere]">{s.contentUrl}</a>
                  <span className="text-xs text-[var(--dim)]"> · {s.platform ?? "Content"}{s.publishedAt ? ` · ${s.publishedAt}` : ""}</span>
                  {s.notes && <p className="text-xs text-[var(--dim)]">{s.notes}</p>}
                </li>
              ))}
            </ul>
          )}
          {(deal.stage === "approved" || deal.stage === "content_production" || deal.stage === "content_submitted") && (
            <div className="mt-2 space-y-3">
              <div>
                <label className={labelCls} htmlFor={`content-url-${deal.id}`}>Published content URL</label>
                <input id={`content-url-${deal.id}`} className={inputCls} type="url" value={contentUrl} onChange={(e) => setContentUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor={`content-platform-${deal.id}`}>Platform</label>
                  <select id={`content-platform-${deal.id}`} className={inputCls} value={contentPlatform} onChange={(e) => setContentPlatform(e.target.value)}>
                    <option value="YouTube">YouTube</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor={`content-date-${deal.id}`}>Publication date</label>
                  <input id={`content-date-${deal.id}`} className={inputCls} type="date" value={contentDate} onChange={(e) => setContentDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={labelCls} htmlFor={`content-notes-${deal.id}`}>Delivery notes (optional)</label>
                <input id={`content-notes-${deal.id}`} className={inputCls} value={contentNotes} onChange={(e) => setContentNotes(e.target.value)} placeholder="e.g. Dedicated video, 10 minutes" />
              </div>
              <button type="button" className={btnPrimary} disabled={submitMut.isPending || !contentUrl.trim()} onClick={() => submitMut.mutate()}>
                {submitMut.isPending ? "Submitting…" : "Submit content"}
              </button>
              {contentMsg && <p className="text-sm text-[var(--dim)]" role="status">{contentMsg}</p>}
            </div>
          )}
          {deal.stage === "content_submitted" && (
            <div className="mt-3">
              <p className="text-sm font-bold">Content submitted successfully</p>
              <p className="mt-1 text-sm text-[var(--dim)]">Create the invoice from the agreed price — it is pre-filled with the brand, the agreed price and your content link. Review it before sending.</p>
              <button type="button" className={btnPrimary + " mt-2"} disabled={invoiceMut.isPending} onClick={() => invoiceMut.mutate()}>
                {invoiceMut.isPending ? "Creating…" : "Create invoice"}
              </button>
              {invoiceMsg && <p className="mt-2 text-sm text-[var(--dim)]" role="status">{invoiceMsg}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DealCard({ deal, data, userId, accessToken, invalidate, index = 0, autoResearch, onAutoResearchDone }: { deal: Deal; data: Dash; userId: string; accessToken?: string; invalidate: () => void; index?: number; autoResearch?: boolean; onAutoResearchDone?: () => void }) {
  const reduce = useReducedMotion();
  const [subject, setSubject] = useState(deal.pitchSubject ?? "");
  const [body, setBody] = useState(deal.pitchBody ?? "");
  const [email, setEmail] = useState(deal.brandEmail ?? "");
  const [price, setPrice] = useState(deal.agreedPrice != null ? String(deal.agreedPrice) : "");
  const [sendMsg, setSendMsg] = useState("");
  const [pitchFallback, setPitchFallback] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);
  // True when the send failed only because the Gmail permission was
  // never granted — the panel below offers the one-tap grant.
  const [needsGmailGrant, setNeedsGmailGrant] = useState(false);
  const [showContacts, setShowContacts] = useState(false);

  const genMut = useMutation({
    mutationFn: () => api.generatePitch({ userId, accessToken, dealId: deal.id }),
    onSuccess: (r) => { setSubject(r.subject); setBody(r.body); setPitchOpen(true); invalidate(); toast.success("Pitch written — review it below"); },
    onError: () => toast.error("Could not write the pitch. Try again."),
  });
  // One-click send: delivers the pitch straight from the creator's own
  // Gmail. Edits are saved first so the sent pitch matches the screen.
  // The Gmail permission is granted on demand (see the grant panel
  // below) — sign-in never asks for it.
  const sendMut = useMutation({
    mutationFn: async () => {
      if (subject.trim() && body.trim()) {
        await api.savePitch({ userId, accessToken, dealId: deal.id, subject, body });
      }
      const token = await getGoogleProviderToken();
      if (!token) {
        return {
          status: "gmail_not_connected",
          message: "Sign in with Google first, then tap Send again and allow Gmail sending — or download the draft below.",
          fromEmail: null,
          draft: null,
        };
      }
      return api.sendPitch({ userId, accessToken, dealId: deal.id, gmailToken: token });
    },
    onSuccess: (r) => {
      if (r.status === "sent") {
        setSendMsg(r.message);
        setNeedsGmailGrant(false);
        toast.success("Pitch sent from your Gmail");
        invalidate();
      } else if (r.status === "needs_pitch" || r.status === "needs_email") {
        setSendMsg(r.message);
        toast.error(r.message);
      } else if (r.status === "gmail_scope_missing") {
        setSendMsg(r.message);
        setNeedsGmailGrant(true);
        setPitchFallback(true);
      } else if (r.status === "gmail_not_connected" || r.status === "gmail_auth_failed") {
        setSendMsg(r.message);
        toast.error(r.message);
        setPitchFallback(true);
      } else {
        setSendMsg(r.message);
      }
    },
    onError: (e) => {
      // The server's own error text is in the Error (the api client
      // throws it). Show it when it says something useful, instead of
      // hiding every failure behind the same generic line — "Could
      // not send" on its own never tells the creator what to fix.
      const detail = e instanceof Error ? e.message : "";
      const isAuth = /401|403|unauthor|expired|sign in/i.test(detail);
      const msg = isAuth
        ? "Your sign-in expired — sign out and sign in again with Google, then tap Send."
        : detail && !/^Request failed/i.test(detail)
          ? detail
          : "Could not send. Try again, or download the draft.";
      setSendMsg(msg);
      toast.error(msg);
      setPitchFallback(true);
    },
  });
  // Fallback only: the .eml download path. One-click send (sendMut) is
  // the main path now.
  const draftMut = useMutation({
    mutationFn: () => api.requestSendPitch({ userId, accessToken, dealId: deal.id }),
    onSuccess: (r) => {
      setSendMsg(r.message);
      if (r.draft) {
        downloadTextFile(`pitch-${deal.brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.eml`, emlFor(r.draft, r.fromEmail));
        toast.success("Pitch draft saved & downloaded — send it from your Gmail");
      }
      invalidate();
    },
    onError: () => { setSendMsg("Could not save the draft. Try again."); toast.error("Could not save the draft. Try again."); },
  });
  const stageLabel = STAGES.find((s) => s.key === deal.stage)?.label ?? deal.stage;

  return (
    <motion.li {...itemAnim(index, reduce)} className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-xl font-bold [overflow-wrap:anywhere]">{deal.brandName}</p>
          <p className="text-sm text-[var(--dim)]">
            {stageLabel}
            {deal.pitchSentAt ? ` · pitch sent ${new Date(deal.pitchSentAt).toLocaleDateString()}` : ""}
          </p>
        </div>
        <button type="button" aria-label={`Delete deal with ${deal.brandName}`} className={btnGhost} onClick={() => api.deleteDeal({ userId, accessToken, id: deal.id }).then(invalidate)}>Delete</button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor={`deal-stage-${deal.id}`}>Stage</label>
          <select
            id={`deal-stage-${deal.id}`} className={inputCls} value={deal.stage}
            onChange={(e) => api.updateDeal({ userId, accessToken, id: deal.id, stage: e.target.value as "prospect" | "pitch_ready" | "pitched" | "reply_received" | "negotiating" | "approved" | "content_production" | "content_submitted" | "invoiced" | "paid" | "lost" }).then(invalidate)}
          >
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor={`deal-price-${deal.id}`}>Agreed price</label>
          <input
            id={`deal-price-${deal.id}`} className={inputCls} inputMode="decimal" value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => {
              const v = parseFloat(price);
              if (!Number.isNaN(v)) api.updateDeal({ userId, accessToken, id: deal.id, agreedPrice: v }).then(invalidate);
            }}
            placeholder={data.calculations[0] ? String(Math.round(data.calculations[0].priceMid)) : "500"}
          />
        </div>
        <div className="col-span-2">
          <label className={labelCls} htmlFor={`deal-email-${deal.id}`}>Brand email</label>
          <input
            id={`deal-email-${deal.id}`} className={inputCls} type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => api.updateDeal({ userId, accessToken, id: deal.id, brandEmail: email.trim() || null }).then(invalidate)}
            placeholder="partnerships@brand.com"
          />
          {deal.brandEmail && deal.brandEmailCategory && (
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              Contact type: {deal.brandEmailCategory}
              {deal.brandEmailSource && deal.brandEmailSource !== "manual" ? (
                <> · Source: <a href={deal.brandEmailSource} target="_blank" rel="noreferrer" className="underline">Official website</a></>
              ) : deal.brandEmailSource === "manual" ? (
                <> · Added manually</>
              ) : null}
            </p>
          )}
          {!deal.brandEmail && deal.research && Array.isArray(deal.research.contacts) && deal.research.contacts.length === 0 && (!Array.isArray(deal.research.phones) || deal.research.phones.length === 0) && (
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              No public email or phone found — most brands only take messages through a form. Add an email manually
              {deal.research.contactPageUrl ? (
                <> or <a href={deal.research.contactPageUrl} target="_blank" rel="noreferrer" className="underline">contact them through their website</a></>
              ) : deal.research.website ? (
                <> or <a href={deal.research.website} target="_blank" rel="noreferrer" className="underline">visit the official contact page</a></>
              ) : " or visit the official contact page"}
              .
            </p>
          )}
          <button type="button" className="mt-2 text-sm font-semibold text-[var(--accent)] underline" onClick={() => setShowContacts(true)}>
            View discovered contacts
          </button>
          <BrandContactsSheet open={showContacts} onClose={() => setShowContacts(false)} deal={deal} userId={userId} accessToken={accessToken} invalidate={invalidate} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={genMut.isPending} onClick={() => genMut.mutate()}>
          {genMut.isPending
            ? <span className="inline-flex items-center gap-2"><Spinner /> Writing your pitch…</span>
            : deal.pitchSubject ? "Rewrite pitch" : "Write my pitch"}
        </button>
        {(deal.pitchSubject || pitchOpen) && (
          <button type="button" className={btnGhost} aria-expanded={pitchOpen} onClick={() => setPitchOpen((o) => !o)}>
            {pitchOpen ? "Hide pitch" : "View pitch"}
          </button>
        )}
      </div>

      {pitchOpen && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          transition={SPRING_UI}
          className="mt-4 space-y-3 border-t border-[var(--border)] pt-4"
        >
          <SendsFrom data={data} />
          <div>
            <label className={labelCls} htmlFor={`pitch-subj-${deal.id}`}>Subject</label>
            <input id={`pitch-subj-${deal.id}`} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor={`pitch-body-${deal.id}`}>Email body</label>
            <textarea id={`pitch-body-${deal.id}`} className={inputCls} rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button" className={btnGhost}
              onClick={() => api.savePitch({ userId, accessToken, dealId: deal.id, subject, body }).then(() => { invalidate(); setSendMsg("Pitch saved."); })}
            >
              Save edits
            </button>
            <button type="button" className={btnPrimary} disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
              {sendMut.isPending ? "Sending…" : "Send pitch"}
            </button>
            {pitchFallback && (
              <button type="button" className={btnGhost} disabled={draftMut.isPending} onClick={() => draftMut.mutate()}>
                {draftMut.isPending ? "Preparing…" : "Download draft (.eml)"}
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--dim)]">
            Send delivers it straight from your Gmail in one tap. Nothing goes through anyone else's account.
          </p>
        </motion.div>
      )}
      {sendMsg && <p className="mt-3 text-sm text-[var(--dim)]" role="status">{sendMsg}</p>}
      {needsGmailGrant && <GmailGrantPanel />}
      {deal.research?.sponsorship && (deal.research.sponsorship.evidence || deal.research.sponsorship.classification) && (
        <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">Why this brand</p>
            {deal.research.sponsorship.classification && (
              <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${classificationMeta(deal.research.sponsorship.classification).cls}`}>
                {classificationMeta(deal.research.sponsorship.classification).label}
              </span>
            )}
          </div>
          {(deal.research.sponsorship.hqCountry || deal.research.sponsorship.industry || deal.research.sponsorship.creatorMarket) && (
            <p className="mt-1 text-sm text-[var(--dim)]">
              {[deal.research.sponsorship.industry, deal.research.sponsorship.hqCountry ? `Headquarters: ${deal.research.sponsorship.hqCountry}` : null, deal.research.sponsorship.creatorMarket ? `Creator market: ${deal.research.sponsorship.creatorMarket}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
          {deal.research.sponsorship.evidence && (
            <p className="mt-1.5 text-sm leading-relaxed">{deal.research.sponsorship.evidence}</p>
          )}
          {(deal.research.sponsorship.exampleCreator || deal.research.sponsorship.platform || deal.research.sponsorship.evidenceDate) && (
            <p className="mt-1 text-sm text-[var(--dim)]">
              {[deal.research.sponsorship.exampleCreator, deal.research.sponsorship.platform, deal.research.sponsorship.evidenceDate].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            {deal.research.sponsorship.evidenceUrl && (
              <a href={deal.research.sponsorship.evidenceUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">View Sponsorship Evidence</a>
            )}
            {deal.research.sponsorship.partnershipUrl && (
              <a href={deal.research.sponsorship.partnershipUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">View Partnership Page</a>
            )}
          </div>
        </div>
      )}
      <BrandResearchSection deal={deal} userId={userId} accessToken={accessToken} invalidate={invalidate} autoResearch={autoResearch} onAutoResearchDone={onAutoResearchDone} />
      <DealConversationSection deal={deal} userId={userId} accessToken={accessToken} invalidate={invalidate} />
    </motion.li>
  );
}

/* Reply tracking + notifications — the Deals tab header. Shows
   whether Gmail reply tracking is on (so brand replies are found
   automatically), lets the creator enable it (grants gmail.readonly
   and stores an encrypted refresh token on the server), and shows
   unread brand-reply notifications with a badge. When Gmail is
   disconnected or the permission expired, it warns and offers to
   reconnect — previously synced messages are never lost. */
function ReplyTrackingSection({ userId, accessToken, invalidate }: { userId: string; accessToken?: string; invalidate: () => void }) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const statusQuery = useQuery({
    queryKey: ["gmail-status", userId],
    queryFn: () => api.getGmailStatus({ userId, accessToken }),
  });
  const notifQuery = useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => api.listNotifications({ userId, accessToken, limit: 30 }),
  });
  const status = statusQuery.data;
  const unread = notifQuery.data?.unreadCount ?? 0;
  const notifications = notifQuery.data?.notifications ?? [];

  const enableMut = useMutation({
    mutationFn: async () => {
      // Grant gmail.readonly (Google shows the permission screen),
      // then, on return, the session carries a refresh token — save
      // it encrypted on the server. If the session already has one
      // (the creator just came back from granting), save it now.
      const refresh = await getGoogleProviderRefreshToken();
      if (refresh) {
        return api.saveGmailToken({ userId, accessToken, refreshToken: refresh });
      }
      await requestGmailReadScope();
      return null;
    },
    onSuccess: (r) => {
      if (r) {
        setStatusMsg(`Reply tracking is on for ${r.email}. DealRate checks your inbox every 30 minutes.`);
        toast.success("Reply tracking is on");
        invalidate();
      }
    },
    onError: (e) => { setStatusMsg(e instanceof Error ? e.message : "Could not enable reply tracking. Try again."); toast.error("Could not enable reply tracking. Try again."); },
  });
  const syncMut = useMutation({
    mutationFn: async () => {
      const token = await getGoogleProviderToken();
      if (!token) throw new Error("Sign in with Google first, then tap Check for replies again.");
      return api.syncGmailNow({ userId, accessToken, gmailToken: token });
    },
    onSuccess: (r) => {
      if (r.newMessages > 0) {
        setStatusMsg(`${r.newMessages} new brand ${r.newMessages === 1 ? "reply" : "replies"} found.`);
        toast.success("New brand replies found");
      } else if (r.error) {
        setStatusMsg(r.error);
      } else {
        setStatusMsg("No new replies right now.");
      }
      invalidate();
    },
    onError: (e) => { setStatusMsg(e instanceof Error ? e.message : "Could not check for replies. Try again."); toast.error("Could not check for replies. Try again."); },
  });
  const readAllMut = useMutation({
    mutationFn: () => api.markAllNotificationsRead({ userId, accessToken }),
    onSuccess: () => invalidate(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnGhost + " relative"}
          aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
          onClick={() => setNotifOpen((o) => !o)}
        >
          Notifications
          {unread > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1.5 text-[11px] font-bold text-white">{unread}</span>
          )}
        </button>
        <button type="button" className={btnGhost} disabled={syncMut.isPending} onClick={() => syncMut.mutate()}>
          {syncMut.isPending ? "Checking…" : "Check for replies now"}
        </button>
      </div>
      {notifOpen && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <button type="button" className="text-xs font-semibold text-[var(--accent)] underline" onClick={() => readAllMut.mutate()}>Mark all read</button>
            )}
          </div>
          {notifications.length === 0 && (
            <p className="mt-2 text-sm text-[var(--dim)]">No notifications yet. When a brand replies to your pitch, it shows up here.</p>
          )}
          {notifications.length > 0 && (
            <ul className="mt-2 space-y-2">
              {notifications.map((n) => (
                <li key={n.id} className="text-sm">
                  <p className="font-medium">{n.title}</p>
                  {n.body && <p className="text-[var(--dim)]">{n.body}</p>}
                  <p className="text-xs text-[var(--dim)]">{new Date(n.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {statusQuery.isPending && (
        <p className="text-sm text-[var(--dim)]">Checking reply tracking…</p>
      )}
      {!statusQuery.isPending && status && !status.connected && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
          <p className="text-sm font-bold">Reply tracking is off</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">Turn it on and DealRate will watch your Gmail for brand replies, understand them, and update your deals — you will not have to check Gmail yourself. It asks Google for permission to read your inbox, and the connection is stored encrypted on the server.</p>
          <button type="button" className={btnPrimary + " mt-3"} disabled={enableMut.isPending} onClick={() => enableMut.mutate()}>
            {enableMut.isPending ? "Enabling…" : "Enable reply tracking"}
          </button>
        </div>
      )}
      {!statusQuery.isPending && status && status.connected && status.invalid && (
        <div className="rounded-2xl border border-[var(--amber)] bg-[var(--surface-alt)] px-4 py-3.5" role="alert">
          <p className="text-sm font-bold">Gmail needs reconnecting</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">DealRate can no longer read your inbox — the Gmail permission expired or was revoked. Your previously synced replies are safe. Tap below to reconnect.</p>
          <button type="button" className={btnPrimary + " mt-3"} disabled={enableMut.isPending} onClick={() => enableMut.mutate()}>
            {enableMut.isPending ? "Reconnecting…" : "Reconnect Gmail"}
          </button>
        </div>
      )}
      {!statusQuery.isPending && status && status.connected && !status.invalid && (
        <p className="text-sm text-[var(--dim)]">
          Reply tracking is on{status.email ? ` for ${status.email}` : ""}{status.lastSyncAt ? ` · last checked ${new Date(status.lastSyncAt).toLocaleString()}` : ""}. DealRate checks your inbox every 30 minutes.
        </p>
      )}
      {statusMsg && <p className="text-sm text-[var(--dim)]" role="status">{statusMsg}</p>}
    </div>
  );
}

function DealsTab({ data, userId, accessToken, invalidate, autoResearchDealId, onAutoResearchDone }: { data: Dash; userId: string; accessToken?: string; invalidate: () => void; autoResearchDealId?: number | null; onAutoResearchDone?: () => void }) {
  const [brandName, setBrandName] = useState("");
  const addMut = useMutation({
    mutationFn: () => api.createDeal({ userId, accessToken, brandName: brandName.trim(), deliverable: "dedicated", agreedPrice: data.calculations[0]?.priceMid, currency: "USD" }),
    onSuccess: (r) => { setBrandName(""); invalidate(); toast.success(r.created ? "Deal added to your pipeline" : "That brand already has a deal in your pipeline"); },
    onError: () => toast.error("Could not add that deal. Try again."),
  });
  return (
    <div className="space-y-6">
      <PageIntro
        accent="keep it moving."
        description="Track every pitch till it's paid."
        visual={<IntroPipeVisual />}
      />
      <ReplyTrackingSection userId={userId} accessToken={accessToken} invalidate={invalidate} />
      <section aria-label="Deal pipeline">
        <SectionTitle right={<span className="flex-none whitespace-nowrap rounded-full bg-[var(--violet)] px-2.5 py-1 text-xs font-bold text-[var(--accent-ink)]">PRO</span>}>Deal pipeline</SectionTitle>
        <p className="mt-1 text-sm text-[var(--dim)]">First pitch to paid. Pitch, agree the price, invoice in one tap.</p>
        <div className="mt-3"><SendsFrom data={data} /></div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (brandName.trim()) addMut.mutate(); }}
        >
          <input aria-label="New deal brand name" className={inputCls} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Add a brand deal…" />
          <button type="submit" className={btnPrimary} disabled={addMut.isPending || !brandName.trim()}>Add</button>
        </form>
      </section>
      {data.deals.length === 0 && <p className="text-sm text-[var(--dim)]">No deals yet. Start one from the Brands tab, or add a brand above.</p>}
      <ul className="space-y-4">
        {data.deals.map((d, i) => <DealCard key={d.id} deal={d} data={data} userId={userId} accessToken={accessToken} invalidate={invalidate} index={i} autoResearch={autoResearchDealId != null && d.id === autoResearchDealId} onAutoResearchDone={onAutoResearchDone} />)}
      </ul>
    </div>
  );
}

/* ---------------- Invoices tab ---------------- */

/* ---------------- Compact account settings ----------------
   The minimal account experience, opened from the profile
   dropdown — not a separate Account Center page. Only real,
   working controls: identity, subscription status, the one
   supported preference (button sounds), and delete account.
   No legal links here; those live in the footer. */

function AccountSettingsSheet({ open, onClose, data, userName, userEmail, userAvatar, demoMode, userId, accessToken, onSignOut, invalidate, onGoPlan }: {
  open: boolean;
  onClose: () => void;
  data: Dash;
  userName: string | null;
  userEmail: string | null;
  userAvatar: string | null;
  demoMode: boolean;
  userId: string | null;
  accessToken: string | null;
  onSignOut: () => void;
  invalidate: () => void;
  onGoPlan: () => void;
}) {
  const reduce = useReducedMotion();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => readSoundMuted());
  useEffect(() => {
    if (!open) return;
    setMuted(readSoundMuted());
    setConfirmDelete(false);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ muted?: boolean }>).detail;
      setMuted(typeof detail?.muted === "boolean" ? detail.muted : readSoundMuted());
    };
    window.addEventListener("bpt-sound-muted-changed", onChange);
    return () => window.removeEventListener("bpt-sound-muted-changed", onChange);
  }, [open ]);
  const isPro = data.plan === "pro" || data.proActive;
  const planDetail = data.proActive && data.proExpiresAt
    ? `Pro — ${data.proBilling === "annual" ? "Annual" : "Monthly"} · ends ${fmtDateIN(data.proExpiresAt)}`
    : data.plan === "pro"
      ? "Pro — on for this workspace"
      : "Free plan";
  const deleteMut = useMutation({
    mutationFn: () => api.deleteAccountData({ userId: userId ?? "", accessToken: accessToken ?? undefined }),
    onSuccess: () => {
      toast.success("Your account data in this app has been deleted.");
      sfx("success");
      onSignOut();
    },
    onError: () => { toast.error("Could not delete your data just now. Try again."); sfx("error"); },
  });
  const toggleSound = () => {
    const next = !muted;
    setSoundMuted(next);
    setMuted(next);
    if (!next) sfx("toggle");
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            initial={reduce ? { opacity: 0 } : { y: "105%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "105%" }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="sheet-glass fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-3xl rounded-t-[28px] px-6 pb-safe pt-3"
          >
            <span className="sheet-shimmer" aria-hidden />
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" aria-hidden />
            <div className="mt-3 flex items-center justify-between gap-2">
              <h2 className="display-tight font-headline text-[22px] font-bold">Settings</h2>
              <button type="button" className={btnGhost} onClick={onClose}>Close</button>
            </div>
            <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <UserAvatar name={userName} email={userEmail} avatarUrl={userAvatar} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold" title={userName ?? undefined}>{userName ?? "Creator"}</p>
                <p className="truncate text-sm text-[var(--dim)]" title={userEmail ?? undefined}>{userEmail}</p>
                {demoMode && <p className="mt-0.5 text-xs font-medium text-[var(--amber)]">Demo session — read-only, nothing is saved.</p>}
              </div>
              <span className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${isPro ? "bg-[var(--violet)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--dim)]"}`}>
                {isPro ? "PRO" : "FREE"}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-bold">Subscription</p>
                <p className="truncate text-sm text-[var(--dim)]">{planDetail}</p>
              </div>
              <button type="button" className={btnSmall + " flex-none"} onClick={() => { onClose(); onGoPlan(); }}>Manage</button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-bold">Sound effects</p>
                <p className="text-sm text-[var(--dim)]">Button sounds in the app</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!muted}
                aria-label="Sound effects"
                onClick={toggleSound}
                className={`btn-press relative h-7 w-12 flex-none rounded-full transition-colors ${muted ? "bg-[var(--surface-alt)]" : "bg-[var(--accent)]"}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${muted ? "left-0.5" : "left-[22px]"}`} />
              </button>
            </div>
            <div className="mt-3 rounded-2xl border border-[var(--danger)]/40 bg-[var(--surface)] px-4 py-3.5">
              {!confirmDelete ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--danger)]">Delete account</p>
                    <p className="text-sm text-[var(--dim)]">Permanently remove your saved data</p>
                  </div>
                  <button type="button" className="btn-press min-h-[40px] flex-none rounded-xl border border-[var(--danger)]/50 px-3.5 text-sm font-semibold text-[var(--danger)]" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </button>
                </div>
              ) : (
                <div role="alertdialog" aria-label="Confirm delete account">
                  <p className="text-sm leading-relaxed">
                    Delete your account data? This permanently removes your saved rate cards, brands, deals, invoices, drafts and payment records from this app. It cannot be undone. (Your Google account itself is not touched.)
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-press inline-flex min-h-[44px] items-center rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={deleteMut.isPending || demoMode} onClick={() => deleteMut.mutate()}>
                      {deleteMut.isPending ? "Deleting…" : "Yes, delete my data"}
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setConfirmDelete(false)}>Keep my account</button>
                  </div>
                  {demoMode && <p className="mt-2 text-xs text-[var(--dim)]">The demo session has no account data to delete.</p>}
                </div>
              )}
            </div>
            <div className="h-4" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------------- Designed invoice preview ---------------- */

function InvoicePreview({ inv, fromEmail, open, onClose }: { inv: Invoice; fromEmail: string | null; open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const html = invoiceHtml(inv, fromEmail);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="inv-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            key="inv-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice ${inv.invoiceNumber}`}
            initial={reduce ? { opacity: 0 } : { y: "105%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "105%" }}
            transition={reduce ? { duration: 0.15 } : { duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[88dvh] w-full max-w-3xl flex-col rounded-t-[28px] bg-[var(--surface)] px-4 pb-safe pt-3"
          >
            <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" aria-hidden />
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="font-display text-lg font-bold">Invoice {inv.invoiceNumber}</p>
              <button type="button" className={btnGhost} onClick={onClose}>Close</button>
            </div>
            <iframe
              ref={frameRef}
              title={`Invoice ${inv.invoiceNumber}`}
              srcDoc={html}
              className="mt-3 min-h-0 flex-1 rounded-2xl border border-[var(--border)] bg-white"
            />
            <div className="flex flex-wrap gap-2 py-3">
              <button type="button" className={btnPrimary} onClick={() => downloadHtmlFile(`invoice-${inv.invoiceNumber}.html`, html)}>
                Download
              </button>
              <button type="button" className={btnGhost} onClick={() => frameRef.current?.contentWindow?.print()}>
                Print / Save as PDF
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function InvoiceCard({ inv, data, userId, accessToken, invalidate, index = 0 }: { inv: Invoice; data: Dash; userId: string; accessToken?: string; invalidate: () => void; index?: number }) {
  const reduce = useReducedMotion();
  const [msg, setMsg] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lastDraft, setLastDraft] = useState<{ toEmail: string; subject: string; body: string } | null>(null);
  const [remFallback, setRemFallback] = useState(false);
  // True when a send failed only because the Gmail permission was
  // never granted — the panel below offers the one-tap grant.
  const [needsGmailGrant, setNeedsGmailGrant] = useState(false);
  const overdue = inv.daysOverdue > 0 && inv.status !== "paid";
  const statusColor =
    inv.status === "paid" ? "text-[var(--accent)]" : overdue ? "text-[var(--danger)]" : "text-[var(--dim)]";
  // One-click reminder: delivers it straight from the creator's own Gmail.
  const remSendMut = useMutation({
    mutationFn: async () => {
      const token = await getGoogleProviderToken();
      if (!token) {
        return {
          status: "gmail_not_connected",
          message: "Sign in with Google first, then tap Send again and allow Gmail sending — or download the reminder draft below.",
          fromEmail: null,
          draft: null,
        };
      }
      return api.sendInvoiceReminder({ userId, accessToken, invoiceId: inv.id, gmailToken: token });
    },
    onSuccess: (r) => {
      if (r.status === "sent") {
        setMsg(r.message);
        setNeedsGmailGrant(false);
        toast.success("Reminder sent from your Gmail");
        invalidate();
      } else if (r.status === "needs_email") {
        setMsg(r.message);
        toast.error(r.message);
      } else if (r.status === "gmail_scope_missing") {
        setMsg(r.message);
        setNeedsGmailGrant(true);
        setRemFallback(true);
      } else if (r.status === "gmail_not_connected" || r.status === "gmail_auth_failed") {
        setMsg(r.message);
        toast.error(r.message);
        setRemFallback(true);
      } else {
        setMsg(r.message);
      }
    },
    onError: () => {
      setMsg("Could not send the reminder. Try again, or download the draft.");
      toast.error("Could not send the reminder. Try again, or download the draft.");
      setRemFallback(true);
    },
  });
  // Fallback only: the .eml reminder draft. One-click send is the main path now.
  const remDraftMut = useMutation({
    mutationFn: () => api.requestInvoiceReminder({ userId, accessToken, invoiceId: inv.id }),
    onSuccess: (r) => {
      setMsg(r.message);
      setLastDraft(r.draft ?? null);
      if (r.draft) {
        downloadTextFile(`reminder-${inv.invoiceNumber}.eml`, emlFor(r.draft, r.fromEmail));
        toast.success("Reminder draft saved & downloaded — send it from your Gmail");
      }
      invalidate();
    },
    onError: () => { setMsg("Could not queue the reminder. Try again."); toast.error("Could not queue the reminder. Try again."); },
  });
  // One-click invoice send: emails the invoice straight from the
  // creator's own Gmail and marks it sent.
  const invSendMut = useMutation({
    mutationFn: async () => {
      const token = await getGoogleProviderToken();
      if (!token) {
        return {
          status: "gmail_not_connected",
          message: "Sign in with Google first, then tap Send again and allow Gmail sending — or download the invoice below.",
          fromEmail: null,
          draft: null,
        };
      }
      return api.sendInvoice({ userId, accessToken, invoiceId: inv.id, gmailToken: token });
    },
    onSuccess: (r) => {
      if (r.status === "sent") {
        setMsg(r.message);
        setNeedsGmailGrant(false);
        toast.success("Invoice sent from your Gmail");
        invalidate();
      } else if (r.status === "needs_email") {
        setMsg(r.message);
        toast.error(r.message);
      } else if (r.status === "gmail_scope_missing") {
        setMsg(r.message);
        setNeedsGmailGrant(true);
      } else if (r.status === "gmail_not_connected" || r.status === "gmail_auth_failed") {
        setMsg(r.message);
        toast.error(r.message);
      } else {
        setMsg(r.message);
      }
    },
    onError: () => {
      setMsg("Could not send the invoice. Try again, or download it below.");
      toast.error("Could not send the invoice. Try again, or download it below.");
    },
  });
  return (
    <motion.li {...itemAnim(index, reduce)} className="card overflow-hidden">
      <div className="border-b-4 border-[var(--accent)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">Invoice</p>
            <p className="font-display text-2xl font-bold [overflow-wrap:anywhere]">{inv.invoiceNumber}</p>
          </div>
          <p className={`tnum font-display text-3xl font-bold ${statusColor}`}>
            <AnimatedAmount amount={inv.amount} currency={inv.currency} />
          </p>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-[var(--dim)]">Billed to</dt><dd className="font-medium [overflow-wrap:anywhere]">{inv.brandName}{inv.brandEmail ? ` · ${inv.brandEmail}` : ""}</dd></div>
          <div><dt className="text-[var(--dim)]">Status</dt><dd className="font-medium capitalize">{overdue ? `Overdue by ${inv.daysOverdue} day${inv.daysOverdue === 1 ? "" : "s"}` : inv.status}</dd></div>
          <div><dt className="text-[var(--dim)]">Issued</dt><dd className="font-medium">{inv.issueDate}</dd></div>
          <div><dt className="text-[var(--dim)]">Due</dt><dd className="font-medium">{inv.dueDate}</dd></div>
          {inv.description && <div className="col-span-2"><dt className="text-[var(--dim)]">For</dt><dd className="font-medium">{inv.description}</dd></div>}
          {inv.reminderCount > 0 && (
            <div className="col-span-2"><dt className="text-[var(--dim)]">Reminders sent</dt><dd className="font-medium">{inv.reminderCount}{inv.lastReminderAt ? ` · last ${new Date(inv.lastReminderAt).toLocaleDateString()}` : ""}</dd></div>
          )}
        </dl>
      </div>
      <div className="px-5 pt-3"><SendsFrom data={data} /></div>
      <div className="flex flex-wrap gap-2 p-4">
        {inv.status === "draft" && (
          <>
            <button type="button" className={btnPrimary} onClick={() => api.updateInvoiceStatus({ userId, accessToken, id: inv.id, status: "sent" }).then(invalidate)}>Mark as sent</button>
            <button type="button" className={btnPrimary} disabled={invSendMut.isPending} onClick={() => invSendMut.mutate()}>
              {invSendMut.isPending ? "Sending…" : "Send invoice"}
            </button>
          </>
        )}
        {inv.status !== "paid" && (
          <>
            <button type="button" className={btnGhost} disabled={remSendMut.isPending} onClick={() => remSendMut.mutate()}>
              {remSendMut.isPending ? "Sending…" : "Send payment reminder"}
            </button>
            {remFallback && (
              <button type="button" className={btnGhost} disabled={remDraftMut.isPending} onClick={() => remDraftMut.mutate()}>
                {remDraftMut.isPending ? "Preparing…" : "Download reminder (.eml)"}
              </button>
            )}
            <button type="button" className={btnGhost} onClick={() => setPreviewOpen(true)}>
              View invoice
            </button>
            <button type="button" className={btnGhost} onClick={() => downloadHtmlFile(`invoice-${inv.invoiceNumber}.html`, invoiceHtml(inv, data.senderEmail))}>
              Download invoice
            </button>
            <button type="button" className={btnPrimary} onClick={() => api.updateInvoiceStatus({ userId, accessToken, id: inv.id, status: "paid" }).then(invalidate)}>Mark paid</button>
          </>
        )}
        {inv.status === "paid" && <span className="px-2 py-2 font-semibold text-[var(--accent)]">Paid — deal closed.</span>}
        <button type="button" aria-label={`Delete invoice ${inv.invoiceNumber}`} className={btnGhost} onClick={() => api.deleteInvoice({ userId, accessToken, id: inv.id }).then(invalidate)}>Delete</button>
      </div>
      {lastDraft && (
        <p className="px-4 pb-2 text-xs text-[var(--dim)]">Reminder downloaded as a draft — open it and send it from your Gmail.</p>
      )}
      {msg && <p className="px-4 pb-4 text-sm text-[var(--dim)]" role="status">{msg}</p>}
      {needsGmailGrant && (
        <div className="px-4 pb-4"><GmailGrantPanel /></div>
      )}
      <InvoicePreview inv={inv} fromEmail={data.senderEmail} open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </motion.li>
  );
}

function InvoicesTab({ data, userId, accessToken, invalidate }: { data: Dash; userId: string; accessToken?: string; invalidate: () => void }) {
  const [brandName, setBrandName] = useState("");
  const [brandEmail, setBrandEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [desc, setDesc] = useState("");
  const [dueDays, setDueDays] = useState("30");
  const [checkMsg, setCheckMsg] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      api.createInvoice({
        userId, accessToken,
        brandName: brandName.trim(), brandEmail: brandEmail.trim() || undefined,
        amount: parseFloat(amount) || 0, currency, description: desc.trim(),
        dueInDays: parseInt(dueDays) || 30,
      }),
    onSuccess: () => { setBrandName(""); setBrandEmail(""); setAmount(""); setDesc(""); invalidate(); toast.success("Invoice created"); },
    onError: () => toast.error("Could not create that invoice. Try again."),
  });
  const checkMut = useMutation({
    mutationFn: () => api.checkOverdueInvoices({ userId, accessToken }),
    onSuccess: (r) => {
      setCheckMsg(`Checked ${r.checked} open invoices: ${r.overdue} overdue, ${r.remindersQueued} reminder draft(s) saved.`);
      if (r.overdue > 0) toast.success(`${r.overdue} overdue invoice${r.overdue === 1 ? "" : "s"} flagged — reminder drafts saved`);
      invalidate();
    },
  });

  const outbox = data.reminders;
  /* Stamp on the intro sheet mirrors the newest real invoice:
     PAID only when it is actually paid, SENT when sent/overdue,
     and no stamp at all for a draft or an empty list. */
  const newest = data.invoices[0];
  const introStamp: "PAID" | "SENT" | null =
    newest?.status === "paid" ? "PAID" : newest && newest.status !== "draft" ? "SENT" : null;

  return (
    <div className="space-y-8">
      <PageIntro
        accent="payment, on track."
        description="Send invoices. Get reminders. Get paid."
        visual={<IntroSheetVisual stamp={introStamp} />}
      />
      <section aria-label="Invoices">
        <SectionTitle right={<span className="flex-none whitespace-nowrap rounded-full bg-[var(--violet)] px-2.5 py-1 text-xs font-bold text-[var(--accent-ink)]">PRO</span>}>Invoices</SectionTitle>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Due 30 days after issue. A daily check flags overdue invoices and saves a reminder draft from your Gmail.
        </p>
        <div className="mt-3"><SendsFrom data={data} /></div>
        <button type="button" className={btnGhost + " mt-3"} disabled={checkMut.isPending} onClick={() => checkMut.mutate()}>
          {checkMut.isPending ? "Checking…" : "Run the overdue check now"}
        </button>
        {checkMsg && <p className="mt-2 text-sm text-[var(--dim)]" role="status">{checkMsg}</p>}

        <form
          className="mt-4 grid grid-cols-2 gap-3 card p-4"
          onSubmit={(e) => { e.preventDefault(); if (brandName.trim() && parseFloat(amount) > 0) createMut.mutate(); }}
        >
          <div>
            <label className={labelCls} htmlFor="inv-brand">Brand name</label>
            <input id="inv-brand" className={inputCls} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="BrandCo" />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-email">Brand email</label>
            <input id="inv-email" className={inputCls} type="email" value={brandEmail} onChange={(e) => setBrandEmail(e.target.value)} placeholder="accounts@brand.com" />
          </div>
          <div>
            <label className={labelCls} htmlFor="inv-amount">Amount</label>
            <input id="inv-amount" className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1200" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="inv-cur">Currency</label>
              <select id="inv-cur" className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="USD">USD</option>
                <option value="INR">INR</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="inv-due">Due in days</label>
              <input id="inv-due" className={inputCls} inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
            </div>
          </div>
          <div className="col-span-2">
            <label className={labelCls} htmlFor="inv-desc">Description</label>
            <input id="inv-desc" className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Paste the video link or describe the work — e.g. Dedicated video, product launch" />
          </div>
          <button type="submit" className={btnPrimary + " col-span-2"} disabled={createMut.isPending}>Create invoice</button>
        </form>
      </section>

      {data.invoices.length === 0 && <p className="text-sm text-[var(--dim)]">No invoices yet. Create one above, or from an approved deal.</p>}
      <ul className="space-y-4">
        {data.invoices.map((inv, i) => <InvoiceCard key={inv.id} inv={inv} data={data} userId={userId} accessToken={accessToken} invalidate={invalidate} index={i} />)}
      </ul>

      {outbox.length > 0 && (
        <section aria-label="Email outbox">
          <SectionTitle>Email outbox</SectionTitle>
          <ul className="mt-3 card divide-y divide-[var(--border)] px-4">
            {outbox.map((r) => (
              <li key={r.id} className="py-3">
                <p className="font-medium [overflow-wrap:anywhere]">{r.subject}</p>
                <p className="text-sm text-[var(--dim)] [overflow-wrap:anywhere]">
                  {r.kind === "pitch" ? "Pitch" : "Payment reminder"} · to {r.toEmail ?? "—"} ·{" "}
                  {r.fromEmail ? `from ${r.fromEmail} · ` : ""}
                  {r.status === "sent" ? "Sent" : r.status === "queued" ? "Queued" : "Draft — not sent"} · {new Date(r.createdAt).toLocaleString()}
                </p>
                {r.status === "drafted" && (
                  <button
                    type="button" className={btnGhost + " mt-2"}
                    onClick={() => downloadTextFile(`${r.kind === "pitch" ? "pitch" : "reminder"}-${r.id}.eml`, emlFor({ toEmail: r.toEmail ?? "", subject: r.subject, body: r.body }, r.fromEmail))}
                  >
                    Download draft (.eml)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ---------------- Owner tab (owner only) ----------------
   Login setup, the Supabase fields and the USD→INR
   rate live here. This tab renders ONLY when the signed-in email is
   OWNER_EMAIL (see the tab list in App) — customers never see it.
   The Supabase URL, anon key and payment links the app actually uses
   come from the OWNER_CONFIG block at the top of this file; the forms
   below edit the saved fallbacks in the app settings, which are used
   only when a config value is left blank. */

function OwnerTab({ data, invalidate, inrRate, userId, accessToken }: { data: Dash; invalidate: () => void; inrRate: number; userId: string | null; accessToken: string | null }) {
  /* Manual-payment admin: pending submissions to approve/reject.
     The server re-checks the owner identity on every call, so this
     list is only ever filled for the owner's own sign-in. */
  const pendingQ = useQuery({
    queryKey: ["manual-payments-admin", userId],
    queryFn: () => api.listManualPayments({ userId: userId ?? "", accessToken: accessToken ?? undefined }),
    enabled: !!userId,
  });
  const reviewMut = useMutation({
    mutationFn: (args: { id: number; decision: "approve" | "reject" }) =>
      api.reviewManualPayment({ userId: userId ?? "", accessToken: accessToken ?? undefined, ...args }),
    onSuccess: (res) => {
      pendingQ.refetch();
      invalidate();
      toast.success(res.status === "approved" ? "Approved — Pro is on for that account." : "Submission rejected.");
      sfx("success");
    },
    onError: () => { toast.error("Could not save that decision. Try again."); sfx("error"); },
  });
  const currentAppUrl = appRedirectUrl();
  const [rate, setRate] = useState(String(inrRate));
  const [sbUrl, setSbUrl] = useState(data.supabaseUrl ?? DEFAULT_SUPABASE_URL);
  const [sbKey, setSbKey] = useState("");
  const [sbMsg, setSbMsg] = useState("");
  const [sbError, setSbError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const setMut = useMutation({
    mutationFn: (args: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(args),
    onSuccess: (res: any) => {
      if (res && res.ok === false && res.error) { toast.error(res.error); }
      else { invalidate(); toast.success("Saved"); }
    },
    onError: () => toast.error("Could not save. Try again."),
  });
  const sbMut = useMutation({
    mutationFn: (args: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(args),
    onSuccess: (res: any) => {
      if (res && res.ok === false && res.error) { setSbError(res.error); setSbMsg(""); }
      else { setSbError(""); setSbMsg("Supabase login saved. Reloading — you'll see the login screen next."); setSbKey(""); resetSupabaseClient(); invalidate(); setTimeout(() => window.location.reload(), 600); }
    },
    onError: (e: any) => setSbError(e?.message ?? "Could not save. Check the key and try again."),
  });
  const clearMut = useMutation({
    mutationFn: () => api.updateSettings({ clearSupabase: true }),
    onSuccess: (res: any) => {
      if (res && res.ok === false && res.error) { setSbError(res.error); }
      else { setSbMsg("Supabase login cleared. The app is back in setup mode."); setSbError(""); setSbKey(""); resetSupabaseClient(); invalidate(); }
    },
  });
  return (
    <div className="space-y-8">
      <section aria-label="Owner">
        <SectionTitle>Owner</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Only you see this screen — it appears only when you're signed in as {OWNER_EMAIL}. The Supabase URL and anon key in the OWNER_CONFIG block at the top of the code are what every phone uses; the forms here edit the saved fallbacks. Pro payments run through Razorpay Orders created on the backend — the keys live only in server environment variables (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET), never in this app.
        </p>
      </section>
      <section aria-label="Supabase login setup" className="card p-5">
        <SectionTitle>Login setup</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Owner-only, done once. The calculator and YouTube fetch stay open to everyone; Google sign-in creates a free account, and Brands / Deals / Invoices additionally need the Pro plan flag above.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${data.supabaseConfigured ? "bg-[var(--accent)]" : "bg-[var(--amber)]"}`} aria-hidden />
          <p className="text-sm font-semibold">{data.supabaseConfigured ? `Login is configured${data.supabaseKeyHint ? ` — key ${data.supabaseKeyHint}` : ""}` : "Login not configured yet — setup mode"}</p>
        </div>
        {data.supabaseConfigured && data.supabaseUrl && <p className="mt-1 text-xs text-[var(--dim)]">Project: {data.supabaseUrl}</p>}

        <ol className="mt-4 space-y-2 text-sm leading-relaxed list-decimal pl-5">
          <li>Open your Supabase project <strong>athtnktzxtmtaquvpmvl</strong> → <strong>Project Settings → API Keys</strong>.</li>
          <li>Tap <strong>View legacy API keys</strong>, then copy the <strong>anon public</strong> key — the very long one starting with <strong>eyJ</strong>.</li>
          <li>Paste it below and save. <strong>Never</strong> paste the publishable key (<code>sb_publishable_…</code>) or the secret / service_role key.</li>
          <li>Login is Google-only — there is no email-and-password sign-in or sign-up in this app. In Supabase → <strong>Authentication → Providers → Email</strong>, turn Email sign-in <strong>off</strong> so nobody can create a password account on this project; the app also rejects any non-Google session on its own, so a typed address can never unlock features or become a sender.</li>
          <li>Turn on Google sign-in: in <strong>Google Cloud Console → APIs &amp; Services → Credentials</strong>, create an <strong>OAuth client ID</strong> (type: Web application) and add this Authorized redirect URI: <code>https://athtnktzxtmtaquvpmvl.supabase.co/auth/v1/callback</code></li>
          <li>Copy that client's <strong>Client ID</strong> and <strong>Client Secret</strong> into Supabase → <strong>Authentication → Providers → Google</strong> and enable it. The secret goes only into Supabase — never into this app.</li>
          <li>
            Tell Supabase where sign-in returns to — this step is what stops the “localhost refused to connect” error. In Supabase → <strong>Authentication → URL Configuration</strong>:
            <ul className="mt-1.5 space-y-1.5 list-disc pl-5">
              <li>Set the <strong>Site URL</strong> to this app's real address (shown below). Supabase starts with <code>http://localhost:3000</code> there — <strong>replace it</strong>. As long as localhost stays in that box, Google sends people to localhost after they tap Continue, and that page never loads.</li>
              <li>Under <strong>Redirect URLs</strong>, add the same address, and remove any <code>localhost</code> entry there too. The app always asks Supabase to return to the address below — the page you're on right now — never to localhost; Supabase only honours that when the address is listed here <em>and</em> the Site URL above is no longer localhost.</li>
            </ul>
            <span className="mt-2 block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1.5">This app's address — use it for both fields</span>
              <input
                aria-label="This app's address for the Supabase Site URL and Redirect URLs"
                className={inputCls}
                readOnly
                value={currentAppUrl}
                onFocus={(e) => e.target.select()}
              />
            </span>
          </li>
        </ol>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSbError(""); setSbMsg("");
            const url = sbUrl.trim();
            const key = sbKey.trim();
            if (!url.includes("supabase.co")) { setSbError("That doesn't look like a Supabase URL — it should contain supabase.co"); return; }
            if (!data.supabaseConfigured && !key) { setSbError("Paste the legacy anon public key (starts with eyJ) to enable login."); return; }
            if (key && !key.startsWith("eyJ")) {
              if (key.startsWith("sb_publishable_")) setSbError("That's the publishable key (sb_publishable_). Use the legacy anon public key instead — View legacy API keys → anon public, starts with eyJ.");
              else if (key.startsWith("sb_secret_")) setSbError("Never enter the secret key. Use the legacy anon public key (starts with eyJ).");
              else setSbError("That key doesn't start with eyJ. Copy the legacy anon public key from Supabase.");
              return;
            }
            sbMut.mutate({ supabaseUrl: url, ...(key ? { supabaseAnonKey: key } : {}) });
          }}
        >
          <div>
            <label className={labelCls} htmlFor="sb-url">Supabase project URL</label>
            <input id="sb-url" className={inputCls} value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} placeholder="https://athtnktzxtmtaquvpmvl.supabase.co" />
          </div>
          <div>
            <label className={labelCls} htmlFor="sb-key">Legacy anon public key (starts with eyJ)</label>
            <input id="sb-key" type="password" autoComplete="off" className={inputCls} value={sbKey} onChange={(e) => setSbKey(e.target.value)} placeholder={data.supabaseConfigured ? "Leave blank to keep the saved key ••••" : "eyJhbGciOi… (paste the full long key)"} />
            <p className="mt-1 text-xs text-[var(--dim)]">Stored in this app's settings so the login screen can connect to your Supabase project. The anon key is designed to be used in browsers — your data protection is Supabase Row Level Security. Never enter the service_role / secret key here.</p>
          </div>
          {sbError && <div role="alert" className="rounded-[var(--radius)] border border-[var(--danger)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm">{sbError}</div>}
          {sbMsg && <p role="status" className="text-sm font-medium text-[var(--accent)]">{sbMsg}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={sbMut.isPending}>{sbMut.isPending ? "Saving…" : data.supabaseConfigured ? "Save Supabase settings" : "Save & turn on login"}</button>
            {data.supabaseConfigured && !confirmClear && (
              <button type="button" className={btnGhost} disabled={clearMut.isPending} onClick={() => setConfirmClear(true)}>Clear saved key</button>
            )}
            {data.supabaseConfigured && confirmClear && (
              <>
                <button type="button" className="rounded-[var(--radius)] bg-[var(--danger)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={clearMut.isPending} onClick={() => { clearMut.mutate(); setConfirmClear(false); }}>Yes, remove key &amp; turn off login</button>
                <button type="button" className={btnGhost} onClick={() => setConfirmClear(false)}>Cancel</button>
              </>
            )}
          </div>
        </form>
      </section>
      <section aria-label="Exchange rate" className="card p-5">
        <SectionTitle>Exchange rate</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">Calculator prices are worked out in USD, then converted at this rate so the result matches the currency the rest of the app shows. The default also lives in OWNER_CONFIG.</p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = parseFloat(rate);
            if (v > 0) setMut.mutate({ inrRate: v });
          }}
        >
          <div>
            <label className={labelCls} htmlFor="set-rate">USD → INR rate</label>
            <input id="set-rate" className={inputCls + " w-36"} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <button type="submit" className={btnGhost} disabled={setMut.isPending}>Save rate</button>
        </form>
      </section>
      <section aria-label="Pro payments" className="card p-5">
        <SectionTitle>Pro payments (Razorpay)</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Pro checkout uses Razorpay Orders created on the backend — there are no payment links to paste any more. Add the Razorpay <strong>test</strong> Key ID and Key Secret as server environment variables (<code>RAZORPAY_KEY_ID</code> / <code>RAZORPAY_KEY_SECRET</code>), plus <code>RAZORPAY_WEBHOOK_SECRET</code> for the payment.captured webhook. Going live later means changing only those variables. Until the keys exist, the Plan screen shows “Pro opens soon” with the notify link. Secrets never go in this app, in the database, or in chat.
        </p>
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="text-sm font-bold">Payment mode</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            <strong>Automatic</strong> is the standard Upgrade flow: the app creates a Razorpay Order and checkout unlocks Pro after signature verification — it activates once the Razorpay keys are set as server environment variables (until then the Plan screen shows “Pro opens soon”). <strong>Manual</strong> (Phase 1, fallback): buyers pay on your Razorpay.me link and submit their payment ID; you approve below. Switch back to Manual only if you need the fallback.
          </p>
          <div className="mt-3 flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label="Payment mode">
            {(["manual", "automatic"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-sound="toggle"
                aria-pressed={data.paymentMode === mode}
                disabled={setMut.isPending}
                onClick={() => setMut.mutate({ paymentMode: mode })}
                className={`btn-press min-h-[44px] flex-1 rounded-full text-sm font-bold capitalize ${data.paymentMode === mode ? "bg-[var(--accent)]/12 text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(200,255,61,0.45)]" : "text-[var(--dim)]"}`}
              >
                {mode === "manual" ? "Manual" : "Automatic"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--dim)]">Currently: <strong className="text-[var(--text)]">{data.paymentMode === "automatic" ? "Automatic" : "Manual"}</strong></p>
        </div>
      </section>
      <section aria-label="Manual payment approvals" className="card p-5">
        <SectionTitle>Manual payment approvals</SectionTitle>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Payments people submitted after paying on your Razorpay.me link. Check the payment ID in your Razorpay dashboard first — approving switches Pro on for the matched account (30 days Monthly, 365 days Annual, from the approval).
        </p>
        {pendingQ.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-[var(--dim)]" role="status"><Spinner /> Loading submissions…</p>
        ) : pendingQ.isError ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Could not load submissions. <button type="button" className="font-semibold text-[var(--text)] underline" onClick={() => pendingQ.refetch()}>Try again</button></p>
        ) : (pendingQ.data?.payments.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-[var(--dim)]">No submissions yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pendingQ.data!.payments.map((p) => (
              <li key={p.id} className="rounded-2xl bg-[var(--surface-alt)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold" title={p.username}>{p.username}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                      Pro {p.billing === "annual" ? "Annual" : "Monthly"} · ID <span className="break-all">{p.txnId}</span> · {fmtDateIN(p.createdAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--dim)]">
                      Matched account: {p.accountProActive && p.accountProExpiresAt ? `Pro active until ${fmtDateIN(p.accountProExpiresAt)}` : "Free account (no active Pro)"}
                    </p>
                  </div>
                  <span className={`flex-none whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${p.status === "pending" ? "bg-[var(--amber)]/15 text-[var(--amber)]" : p.status === "approved" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-[var(--surface)] text-[var(--dim)]"}`}>
                    {p.status === "pending" ? "Pending" : p.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
                {p.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={btnSmall} disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ id: p.id, decision: "approve" })}>
                      Approve — turn Pro on
                    </button>
                    <button type="button" className={btnGhost} disabled={reviewMut.isPending} onClick={() => reviewMut.mutate({ id: p.id, decision: "reject" })}>
                      Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Business details and demo" className="card p-5">
        <SectionTitle>Business details &amp; reviewer demo</SectionTitle>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--dim)]">
          <p>
            The public pages (About, Pricing, Contact, Terms, Privacy, Cancellation and Refunds, Shipping, Disclaimer) and the footers read the business name ({BUSINESS_CONFIG.businessName}), product name ({BUSINESS_CONFIG.productName}), address, phone, support email ({BUSINESS_CONFIG.supportEmail}), WhatsApp number and Razorpay.me link from the <strong>BUSINESS_CONFIG</strong> block at the top of the app code — all set to the real business details. Edit them there to change them everywhere at once. (The support email is separate from your owner sign-in, {OWNER_EMAIL}, which still gates this screen.)
          </p>
          <p>
            Reviewer demo account (for Razorpay's review): username <strong className="text-[var(--text)]">{DEMO_LOGIN.username}</strong>, password <strong className="text-[var(--text)]">{DEMO_LOGIN.password}</strong> — entered under “Reviewer demo sign-in” in the sign-in sheet. It opens a read-only demo session: the calculator, Plan and pricing, and all public pages are visible; nothing can be saved, bought or sent. Change the password or disable it in the DEMO_LOGIN block.
          </p>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Info pages (the eight public pages) ----------------
   Public: no login needed. Reached from the footer on every screen,
   the upgrade screen, or
   directly through the page's own #/page address in the app URL.
   The wording lives in the INFO_PAGES block at the top of this file
   so the owner can edit it in one place. "Back" returns to the
   screen the reader came from. */

function LegalPage({ page, onBack }: { page: InfoPageKey; onBack: () => void }) {
  const content = INFO_PAGES[page];
  const whatsappDigits = BUSINESS_CONFIG.whatsappNumber.replace(/\D/g, "");
  return (
    <div className="space-y-6">
      <div>
        <button type="button" className={btnGhost} onClick={onBack} aria-label="Back">
          ← Back
        </button>
        <h1 className="font-headline mt-4 text-[28px] font-extrabold leading-tight">{content.title}</h1>
        <p className="mt-1 text-sm font-medium text-[var(--dim)]">{BUSINESS_CONFIG.businessName}</p>
      </div>
      <div className="card space-y-4 p-5">
        {content.paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-[var(--dim)]">{p}</p>
        ))}
        {page === "contact" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={`mailto:${BUSINESS_CONFIG.supportEmail}`}
              className={btnPrimary + " inline-flex items-center justify-center"}
            >
              Email us
            </a>
            {whatsappDigits && (
              <a
                href={`https://wa.me/${whatsappDigits}`}
                target="_blank"
                rel="noreferrer"
                className={btnGhost + " inline-flex items-center justify-center"}
              >
                WhatsApp us
              </a>
            )}
          </div>
        )}
      </div>
      <p className="text-xs leading-relaxed text-[var(--dim)]">
        {BUSINESS_CONFIG.productName} · {BUSINESS_CONFIG.businessName} · {BUSINESS_CONFIG.businessAddress} · {BUSINESS_CONFIG.businessPhone} · {BUSINESS_CONFIG.supportEmail}
      </p>
    </div>
  );
}

/* Shared date helper: used by the Plan page (subscription dates) and the Settings sheet. */

function fmtDateIN(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* ---------------- Manual payment panel (Phase 1) ----------------
   Shown on the Plan screen while the payment-mode flag is "manual":
   the buyer pays on the owner's Razorpay.me link, then submits the
   plan they paid for plus the Razorpay payment ID or UPI
   transaction ID. The claim is saved as "pending"; Pro turns on
   only when the owner approves it on the Owner screen. */
function ManualPayPanel({ billing, data, signedIn, userId, accessToken, onOpenSignIn, invalidate }: {
  billing: "monthly" | "annual";
  data: Dash;
  signedIn: boolean;
  userId: string | null;
  accessToken: string | null;
  onOpenSignIn: () => void;
  invalidate: () => void;
}) {
  const link = BUSINESS_CONFIG.razorpayMeLink.trim();
  const price = billing === "annual" ? PRICING.annual.price : PRICING.monthly.price;
  const [txnId, setTxnId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  /* Notify-me, shown only while the owner's payment link is not
     added yet. The email stays on this device (same list the
     automatic-mode "Pro opens soon" state uses) until the owner
     wires a real waitlist. */
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyDone, setNotifyDone] = useState(false);
  const submitNotify = () => {
    const email = notifyEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Enter a valid email so we can reach you."); return; }
    try {
      const key = "bpt-pro-notify";
      const list: string[] = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      if (!list.includes(email)) list.push(email);
      window.localStorage.setItem(key, JSON.stringify(list));
    } catch { /* storage unavailable — the toast still confirms */ }
    setNotifyDone(true);
    toast.success("You're on the list — we'll email you when Pro opens.");
    sfx("success");
  };
  const pending = data.manualPayments.find((m) => m.status === "pending");
  const submitMut = useMutation({
    mutationFn: () => api.submitManualPayment({ userId: userId ?? "", accessToken: accessToken ?? undefined, billing, txnId: txnId.trim() }),
    onSuccess: () => {
      setTxnId("");
      setFormOpen(false);
      invalidate();
      toast.success("Payment details saved — pending review. Pro turns on as soon as your payment is approved.");
      sfx("success");
    },
    onError: () => { toast.error("Could not save those details. Check the payment ID and try again."); sfx("error"); },
  });

  return (
    <div>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className={btnPrimary + " w-full"}
          aria-label={`Pay ${formatMoney(price, "INR")} for Pro ${billing === "annual" ? "Annual" : "Monthly"} on Razorpay`}
        >
          Pay {formatMoney(price, "INR")} on Razorpay
        </a>
      ) : (
        <button type="button" className={btnPrimary + " w-full"} disabled aria-disabled="true">
          Pro opens soon
        </button>
      )}
      <p className="mt-2.5 text-center text-sm font-medium text-[var(--text)]">Pay with UPI, cards, netbanking or wallets. Secure payment via Razorpay.</p>
      <p className="mt-1.5 text-center text-xs leading-relaxed text-[var(--dim)]">
        {link
          ? "After paying, submit your payment ID below. Your payment is checked by hand, and Pro turns on once it is approved — usually the same day."
          : "The owner's Razorpay payment link is not added yet, so payment is not open right now."}
      </p>
      {!link && (
        <div className="mt-3">
          {notifyDone ? (
            <p className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-[var(--surface-alt)] px-4 text-center text-sm font-bold text-[var(--accent)]">
              <IconCheck size={17} /> You're on the list
            </p>
          ) : notifyOpen ? (
            <form
              onSubmit={(e) => { e.preventDefault(); submitNotify(); }}
              className="flex gap-2"
            >
              <input
                aria-label="Email for the Pro launch notification"
                type="email"
                autoComplete="email"
                className={inputCls + " min-w-0 flex-1"}
                placeholder="you@example.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
              />
              <button type="submit" className={btnPrimary + " flex-none"}>Notify me</button>
            </form>
          ) : (
            <button type="button" className="btn-press mx-auto block min-h-[44px] px-3 text-sm font-semibold text-[var(--dim)] underline" onClick={() => setNotifyOpen(true)}>
              Notify me when Pro opens
            </button>
          )}
        </div>
      )}
      {pending ? (
        <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm font-semibold text-[var(--amber)]">
          Payment submitted — pending review. Pro turns on as soon as it's approved.
        </p>
      ) : link ? (
        <div className="mt-3">
          {!formOpen ? (
            <button type="button" className={btnSmall + " w-full"} onClick={() => (signedIn ? setFormOpen(true) : onOpenSignIn())}>
              I've paid — submit my payment ID
            </button>
          ) : (
            <form
              className="space-y-2.5 rounded-2xl bg-[var(--surface-alt)] p-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (txnId.trim().length < 4) { toast.error("Enter the full Razorpay payment ID or UPI transaction ID."); return; }
                submitMut.mutate();
              }}
            >
              <p className="text-sm font-semibold">
                Plan paid for: Pro {billing === "annual" ? "Annual (365 days)" : "Monthly (30 days)"} — {formatMoney(price, "INR")}
              </p>
              <p className="text-xs leading-relaxed text-[var(--dim)]">Wrong plan? Change the Monthly / Annual switch above before submitting — the switch decides which plan gets approved.</p>
              <div>
                <label className={labelCls} htmlFor="manual-txn">Razorpay payment ID or UPI transaction ID</label>
                <input
                  id="manual-txn"
                  className={inputCls}
                  placeholder="pay_… or the UPI transaction ID"
                  autoComplete="off"
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                />
              </div>
              <p className="text-xs leading-relaxed text-[var(--dim)]">Submitted as {data.senderEmail ?? "your sign-in account"}. It is saved as pending — Pro is not on until the owner approves this payment.</p>
              <button type="submit" className={btnPrimary + " w-full"} disabled={submitMut.isPending}>
                {submitMut.isPending ? "Saving…" : "Submit for review"}
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Plan tab ----------------
   Plans only: Free + Pro cards and the billing toggle (INR only —
   no currency switch anywhere). "Buy now" creates a Razorpay Order
   on the BACKEND (api.createProOrder — the amount comes from the
   backend price config, never from this screen), then opens the
   Razorpay Checkout popup with the order id and the public Key ID,
   prefilled with the signed-in user's name and email. Pro unlocks
   only after the backend verifies the payment signature
   (api.verifyProPayment) — never on the popup's say-so alone. While
   the Razorpay keys are missing on the server, the button reads
   "Pro opens soon" with the "Notify me when Pro opens" link; once
   keys exist, Buy now shows and the notify link hides. The Refund
   Policy page (profile menu) carries the 7-day money-back terms. */

function PlanTab({ data, invalidate, signedIn, userId, accessToken, userEmail, userName, onOpenSignIn, onOpenLegal }: {
  data: Dash;
  invalidate: () => void;
  signedIn: boolean;
  userId: string | null;
  accessToken: string | null;
  userEmail: string | null;
  userName: string | null;
  onOpenSignIn: () => void;
  onOpenLegal: (page: InfoPageKey) => void;
}) {
  /* Payment feature flag from the server: "automatic" (Razorpay
     Orders checkout with server-side signature verification) is
     the user-facing Upgrade flow and the default. "manual"
     (Phase 1 — Razorpay.me link + payment-ID submission + owner
     approval) appears only when the owner switches the flag back
     on the Owner screen, as a fallback. */
  const manualMode = data.paymentMode !== "automatic";
  const reduce = useReducedMotion();
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const monthlyOff = percentOff(PRICING.monthly.price, PRICING.monthly.was);
  const annualOff = percentOff(PRICING.annual.price, PRICING.annual.was);
  const annualPerMonth = Math.round(PRICING.annual.price / 12);
  /* What Annual saves versus its full price — the crossed annual
     MRP minus the annual price (₹4,788 − ₹1,399 = ₹3,389), the same
     reference the "% off" figures use. Calculated, never typed. */
  const annualSavings = PRICING.annual.was - PRICING.annual.price;
  const selected = PRICING[billing];
  /* The workspace plan flag (owner's manual switch) still counts as
     Pro, as does the user's own verified subscription. */
  const workspacePro = data.plan === "pro";
  const pro = workspacePro || data.proActive;
  const setMut = useMutation({
    mutationFn: (args: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(args),
    onSuccess: (res: any) => {
      if (res && res.ok === false && res.error) { toast.error(res.error); }
      else { invalidate(); toast.success("Saved"); }
    },
    onError: () => toast.error("Could not save. Try again."),
  });

  /* Checkout setup state from the backend: keys configured or not,
     test vs live mode, and the public Key ID. The secret never
     reaches this code. */
  const checkoutInfo = useQuery({
    queryKey: ["pro-checkout-info"],
    queryFn: () => api.getProCheckoutInfo({}),
    staleTime: 60_000,
  });
  const keysReady = checkoutInfo.data?.configured === true;
  const keysLoading = checkoutInfo.isPending;

  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [paySuccess, setPaySuccess] = useState(false);
  useEffect(() => { setPayError(null); setPaySuccess(false); }, [billing]);

  const verifyMut = useMutation({
    mutationFn: (args: { orderId: string; paymentId: string; signature: string }) =>
      api.verifyProPayment({ userId: userId ?? "", accessToken: accessToken ?? undefined, ...args }),
  });

  /* The full Buy now flow: backend order → Checkout popup →
     backend signature verification → Pro. Every failure path lands
     on a clear message with a Try again button, and Pro is never
     touched on failure, cancellation or a network error. */
  const buyNow = async (forBilling: "monthly" | "annual") => {
    setPayError(null);
    setPaySuccess(false);
    if (!signedIn || !userId) {
      // The order (and the Pro it unlocks) belongs to an account.
      toast.error("Sign in first, so Pro lands on your account.");
      onOpenSignIn();
      return;
    }
    setPayBusy(true);
    let order: ApiResponse<typeof api, "createProOrder">;
    try {
      order = await api.createProOrder({ userId, accessToken: accessToken ?? undefined, billing: forBilling });
    } catch {
      setPayBusy(false);
      setPayError("We couldn't reach the payment server — check your connection and try again. No charge was made.");
      sfx("error");
      return;
    }
    if (!order.ok || !order.orderId || !order.keyId) {
      setPayBusy(false);
      setPayError(order.message || "The payment couldn't be started just now. No charge was made — please try again.");
      sfx("error");
      return;
    }
    let RazorpayCtor: any;
    try {
      RazorpayCtor = await loadRazorpayCheckout();
    } catch {
      setPayBusy(false);
      setPayError("The Razorpay payment window couldn't load — check your connection and try again. No charge was made.");
      sfx("error");
      return;
    }
    const rzp = new RazorpayCtor({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: "INR",
      name: BUSINESS_CONFIG.productName,
      description: forBilling === "monthly" ? "Pro — Monthly" : "Pro — Annual",
      prefill: { name: userName ?? "", email: userEmail ?? "" },
      theme: { color: "#14141b" },
      modal: {
        ondismiss: () => {
          setPayBusy(false);
          setPayError("Payment was cancelled — no charge was made. Tap “Try again” whenever you're ready.");
        },
      },
      handler: (resp: any) => {
        // Checkout says the payment completed — but Pro unlocks
        // only after the BACKEND verifies the signature.
        verifyMut.mutate(
          {
            orderId: String(resp?.razorpay_order_id ?? order.orderId),
            paymentId: String(resp?.razorpay_payment_id ?? ""),
            signature: String(resp?.razorpay_signature ?? ""),
          },
          {
            onSuccess: (res) => {
              setPayBusy(false);
              if (res.ok) {
                setPaySuccess(true);
                toast.success("Payment verified — Pro is on. Welcome to Pro!");
                sfx("success");
                invalidate();
              } else {
                setPayError(res.message);
                sfx("error");
              }
            },
            onError: () => {
              setPayBusy(false);
              setPayError("Your payment went through but we couldn't verify it just now — if Pro doesn't appear in a minute, your payment is also confirmed by Razorpay's webhook once the app is on its public address. No second payment is needed.");
              sfx("error");
            },
          },
        );
      },
    });
    rzp.on("payment.failed", (resp: any) => {
      setPayBusy(false);
      const reason = typeof resp?.error?.description === "string" && resp.error.description
        ? resp.error.description
        : "The payment didn't go through.";
      setPayError(`${reason} No charge was made — tap “Try again” to retry.`);
      sfx("error");
    });
    rzp.open();
  };

  /* Renewal reminder for a subscriber whose plan ends within
     5 days — renewing extends Pro from the current expiry date.
     A cancelled pass gets no reminder: reminders stop on cancel. */
  const expiringSoon = data.proActive && !data.proCancelled && data.proDaysLeft !== null && data.proDaysLeft <= 5;
  const expiryLabel = data.proExpiresAt
    ? new Date(data.proExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  /* Manage subscription (moved here from the removed Account page):
     cancel Pro and the payment history with receipts live on the
     Plan page now, so nothing is lost when the Account Center goes. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelMut = useMutation({
    mutationFn: () => api.cancelPro({ userId: userId ?? "", accessToken: accessToken ?? undefined }),
    onSuccess: (res) => {
      setConfirmCancel(false);
      invalidate();
      toast.success(res.proExpiresAt
        ? `Pro cancelled — it stays on until ${fmtDateIN(res.proExpiresAt)}. No refund is automatic; see the Refund Policy.`
        : "Pro cancelled.");
      sfx("success");
    },
    onError: () => { toast.error("Could not cancel just now. Try again."); sfx("error"); },
  });
  const downloadReceipt = (label: string, lines: string[]) => {
    downloadTextFile(`receipt-${label}.txt`, lines.join("\n"));
  };
  /* Payment history: verified/failed Razorpay payments plus the
     user's manual submissions with their review state. Pending
     checkout orders (started, never paid) are not payments and are
     left out. */
  const history: { key: string; date: string; amountInr: number; paymentId: string | null; status: string; billing: string }[] = [
    ...data.proPayments
      .filter((p) => p.status !== "pending")
      .map((p) => ({
        key: `pro-${p.id}`,
        date: p.verifiedAt ?? p.createdAt,
        amountInr: p.amountInr,
        paymentId: p.paymentId,
        status: p.status === "verified" ? "Paid" : "Failed",
        billing: p.billing,
      })),
    ...data.manualPayments.map((m) => ({
      key: `man-${m.id}`,
      date: m.createdAt,
      amountInr: (m.billing === "annual" ? PRICING.annual.price : PRICING.monthly.price),
      paymentId: m.txnId,
      status: m.status === "approved" ? "Paid" : m.status === "rejected" ? "Rejected" : "Pending review",
      billing: m.billing,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const showManage = signedIn && (data.proActive || history.length > 0);

  /* Notify-me state: shown only while the Razorpay keys are missing
     (the "Pro opens soon" state). The email is kept on this device
     until the owner wires a real waitlist. */
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyDone, setNotifyDone] = useState(false);
  const submitNotify = () => {
    const email = notifyEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Enter a valid email so we can reach you."); return; }
    try {
      const key = "bpt-pro-notify";
      const list: string[] = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      if (!list.includes(email)) list.push(email);
      window.localStorage.setItem(key, JSON.stringify(list));
    } catch { /* storage unavailable — the toast still confirms */ }
    setNotifyDone(true);
    toast.success("You're on the list — we'll email you when Pro opens.");
    sfx("success");
  };

  const buyLabel = `Buy now — ${formatMoney(selected.price, "INR")}${billing === "monthly" ? "/mo" : "/yr"}`;

  return (
    <div className="relative space-y-8">
      <div className="ambient-glow" aria-hidden />
      <PageIntro
        accent="Stop leaving money behind."
        description="Find brands, pitch, manage deals and organise invoices from one workspace."
        value="One well-priced deal could cover your Pro plan."
        visual={<IntroMemberVisual />}
      />
      {expiringSoon && expiryLabel && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--amber)] p-4" role="status">
          <p className="min-w-0 text-sm leading-relaxed">
            <strong>Your Pro plan ends on {expiryLabel}</strong> — {data.proDaysLeft} {data.proDaysLeft === 1 ? "day" : "days"} left. Renew now and the new period is added on top, so nothing is lost.
          </p>
          <button
            type="button"
            className={btnPrimary + " flex-none"}
            disabled={payBusy}
            onClick={() => {
              if (manualMode) {
                document.getElementById("pro-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
              } else {
                buyNow(data.proBilling === "monthly" ? "monthly" : "annual");
              }
            }}
          >
            {manualMode ? "Renew below" : "Buy now"}
          </button>
        </div>
      )}
      <section aria-label="Plans">
        <SectionTitle>Choose your plan</SectionTitle>

        <div className="mt-4 flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label="Billing period">
          {([["monthly", "Monthly"], ["annual", `Annual · Save ${formatMoney(annualSavings, "INR")}`]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-sound="toggle"
              aria-pressed={billing === key}
              onClick={() => setBilling(key)}
              className={`btn-press min-h-[44px] flex-1 rounded-full text-sm font-bold ${billing === key ? "bg-[var(--accent)]/12 text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(200,255,61,0.45)]" : "text-[var(--dim)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
          A <strong className="text-[var(--text)]">free account</strong> saves your rate cards. <strong className="text-[var(--text)]">Pro</strong> adds the brand finder, deal pipeline and invoices — and starts only after a verified payment. Signing in never turns Pro on by itself.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <motion.div {...itemAnim(0, reduce)} className="card p-5 opacity-75">
            <p className="text-xl font-bold">Free</p>
            <p className="tnum font-display mt-1 text-4xl font-bold">{formatMoney(0, "INR")}</p>
            <p className="mt-1 text-sm text-[var(--dim)]">Free account. No Pro subscription required.</p>
            <ul className="mt-4 space-y-2 text-sm text-[var(--dim)]">
              <li>Price calculator — no account needed</li>
              <li>Live YouTube channel fetch</li>
              <li>Save rate cards with a free account</li>
            </ul>
            {!pro && <p className="mt-4 text-sm font-bold text-[var(--accent)]">Your current plan</p>}
          </motion.div>

          <motion.div {...itemAnim(1, reduce)} className="pro-card relative p-6" id="pro-card">
            <span className="absolute -top-3 left-5 whitespace-nowrap rounded-full bg-[var(--violet)] px-3 py-1 text-xs font-bold text-[var(--accent-ink)]">Best value</span>
            <p className="mt-1 text-[22px] font-bold">Pro</p>
            {billing === "monthly" ? (
              <p className="tnum mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-4xl font-bold">{formatMoney(PRICING.monthly.price, "INR")}</span>
                <span className="text-[var(--dim)]">/ month</span>
                <s className="text-[var(--dim)]">{formatMoney(PRICING.monthly.was, "INR")}</s>
                <span className="rounded-full bg-[var(--violet)] px-2 py-0.5 text-xs font-bold text-[var(--accent-ink)]">{monthlyOff}% off</span>
              </p>
            ) : (
              <>
                <p className="tnum mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-4xl font-bold">{formatMoney(PRICING.annual.price, "INR")}</span>
                  <span className="text-[var(--dim)]">/ year</span>
                  <s className="text-[var(--dim)]">{formatMoney(PRICING.annual.was, "INR")}</s>
                  <span className="rounded-full bg-[var(--violet)] px-2 py-0.5 text-xs font-bold text-[var(--accent-ink)]">{annualOff}% off</span>
                </p>
                <p className="tnum mt-1 text-sm text-[var(--dim)]">That's {formatMoney(annualPerMonth, "INR")}/month — was {formatMoney(PRICING.monthly.was, "INR")}/month.</p>
              </>
            )}
            <ul className="mt-4 space-y-2.5 text-sm">
              {["Brand finder — live web search", "Pitches sent from your Gmail", "Deal pipeline, pitch to paid", "Invoices + 30-day reminders"].map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex-none text-[var(--accent)]"><IconCheck size={16} /></span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            {!pro && (
              <div className="mt-5">
                {manualMode ? (
                  <ManualPayPanel
                    billing={billing}
                    data={data}
                    signedIn={signedIn}
                    userId={userId}
                    accessToken={accessToken}
                    onOpenSignIn={onOpenSignIn}
                    invalidate={invalidate}
                  />
                ) : keysReady ? (
                  <>
                    <button type="button" className={btnPrimary + " w-full"} disabled={payBusy} onClick={() => buyNow(billing)}>
                      {payBusy ? "Opening secure checkout…" : buyLabel}
                    </button>
                    <p className="mt-2.5 text-center text-sm font-medium text-[var(--text)]">Pay with UPI, cards, netbanking or wallets. Secure payment via Razorpay.</p>
                    {checkoutInfo.data?.mode === "test" && (
                      <p className="mt-1 text-center text-xs text-[var(--dim)]">Test keys are on — Razorpay runs in test mode, so no real money moves.</p>
                    )}
                  </>
                ) : keysLoading ? (
                  <button type="button" className={btnPrimary + " w-full"} disabled>
                    Checking checkout…
                  </button>
                ) : (
                  <>
                    <button type="button" className={btnPrimary + " w-full"} disabled aria-disabled="true">
                      Pro opens soon
                    </button>
                    <div className="mt-3">
                      {notifyDone ? (
                        <p className="flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-[var(--surface-alt)] px-4 text-center text-sm font-bold text-[var(--accent)]">
                          <IconCheck size={17} /> You're on the list
                        </p>
                      ) : notifyOpen ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); submitNotify(); }}
                          className="flex gap-2"
                        >
                          <input
                            aria-label="Email for the Pro launch notification"
                            type="email"
                            autoComplete="email"
                            className={inputCls + " min-w-0 flex-1"}
                            placeholder="you@example.com"
                            value={notifyEmail}
                            onChange={(e) => setNotifyEmail(e.target.value)}
                          />
                          <button type="submit" className={btnPrimary + " flex-none"}>Notify me</button>
                        </form>
                      ) : (
                        <button type="button" className="btn-press mx-auto block min-h-[44px] px-3 text-sm font-semibold text-[var(--dim)] underline" onClick={() => setNotifyOpen(true)}>
                          Notify me when Pro opens
                        </button>
                      )}
                    </div>
                  </>
                )}
                {paySuccess && (
                  <p role="status" className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm font-semibold text-[var(--accent)]">
                    <IconCheck size={17} /> Payment verified — Pro is on. Your plan and renewal date are in the profile menu at the top.
                  </p>
                )}
                {payError && (
                  <div role="alert" className="mt-3 rounded-2xl border border-[var(--amber)] bg-[var(--surface-alt)] px-3.5 py-3">
                    <p className="text-sm leading-relaxed">{payError}</p>
                    <button type="button" className={btnSmall + " mt-2.5"} disabled={payBusy} onClick={() => buyNow(billing)}>
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )}
            {pro && (
              <>
                <p className="mt-4 text-sm font-bold text-[var(--accent)]">
                  {data.proActive && expiryLabel
                    ? `Pro is on — ${data.proBilling === "annual" ? "Annual" : "Monthly"} plan, ends ${expiryLabel}`
                    : "Pro is on for this workspace"}
                </p>
                {data.proActive && data.proCancelled && (
                  <p className="mt-1.5 text-sm text-[var(--dim)]">Cancelled — Pro stays on until the date above, then your account returns to Free.</p>
                )}
                {workspacePro && (
                  <button type="button" className={btnGhost + " mt-3"} disabled={setMut.isPending} onClick={() => setMut.mutate({ plan: "free" })}>
                    Back to Free
                  </button>
                )}
              </>
            )}
          </motion.div>
        </div>
        {!pro && !manualMode && keysReady && (
          <p className="mt-3 text-sm text-[var(--dim)]">
            Tap “Buy now” and Razorpay Checkout opens — UPI, cards, netbanking and wallets. Pro switches on only after Razorpay confirms the payment and the signature is verified on the server.
          </p>
        )}
        {!pro && (
          <p className="mt-3 text-center text-xs leading-relaxed text-[var(--dim)]">
            By upgrading you agree to the{" "}
            <button type="button" className="btn-press font-semibold text-[var(--text)] underline underline-offset-2" onClick={() => onOpenLegal("terms")}>Terms and Conditions</button>
            {" "}and the{" "}
            <button type="button" className="btn-press font-semibold text-[var(--text)] underline underline-offset-2" onClick={() => onOpenLegal("privacy")}>Privacy Policy</button>.
            {" "}Refunds follow the{" "}
            <button type="button" className="btn-press font-semibold text-[var(--text)] underline underline-offset-2" onClick={() => onOpenLegal("refund")}>Cancellation and Refund Policy</button>.
          </p>
        )}
      </section>
      {showManage && (
        <section aria-label="Manage subscription" className="card p-5">
          <SectionTitle>Manage subscription</SectionTitle>
          {data.proActive && (
            <div className="mt-3 space-y-1.5 text-sm">
              <p className="flex justify-between gap-3"><span className="text-[var(--dim)]">Plan</span><span className="font-bold">{data.proBilling === "annual" ? "Pro — Annual" : "Pro — Monthly"}</span></p>
              <p className="flex justify-between gap-3"><span className="text-[var(--dim)]">Started</span><span className="font-bold">{fmtDateIN(data.proStartsAt)}</span></p>
              <p className="flex justify-between gap-3"><span className="text-[var(--dim)]">Expires</span><span className="font-bold">{fmtDateIN(data.proExpiresAt)}</span></p>
              {data.proDaysLeft !== null && (
                <p className="flex justify-between gap-3"><span className="text-[var(--dim)]">Days left</span><span className="font-bold">{data.proDaysLeft}</span></p>
              )}
            </div>
          )}
          {data.proActive && !data.proCancelled && (
            <div className="mt-4">
              {!confirmCancel ? (
                <button type="button" className={btnGhost + " w-full justify-between"} onClick={() => setConfirmCancel(true)}>
                  <span>Cancel Pro</span>
                  <span aria-hidden>→</span>
                </button>
              ) : (
                <div className="rounded-2xl border border-[var(--amber)] bg-[var(--surface-alt)] px-4 py-3.5" role="alertdialog" aria-label="Confirm cancel Pro">
                  <p className="text-sm leading-relaxed">
                    Cancel Pro? Access stays until <strong>{fmtDateIN(data.proExpiresAt)}</strong>, reminders stop, and nothing is refunded automatically — refunds follow the Cancellation and Refund Policy.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-press inline-flex min-h-[44px] items-center rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={cancelMut.isPending} onClick={() => cancelMut.mutate()}>
                      {cancelMut.isPending ? "Cancelling…" : "Yes, cancel Pro"}
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setConfirmCancel(false)}>Keep Pro</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {data.proActive && data.proCancelled && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
              Cancelled — Pro stays on until {fmtDateIN(data.proExpiresAt)}, then your account returns to Free. Reminders are off and nothing was refunded automatically.
            </p>
          )}
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <p className="text-sm font-bold">Payment history</p>
            {history.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--dim)]">No payments yet. When you buy Pro, every payment shows here with its receipt.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {history.map((h) => (
                  <li key={h.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="tnum text-sm font-bold">
                        {formatMoney(h.amountInr, "INR")} <span className="font-medium text-[var(--dim)]">· Pro {h.billing === "annual" ? "Annual" : "Monthly"}</span>
                      </p>
                      <p className="truncate text-xs text-[var(--dim)]" title={h.paymentId ?? undefined}>
                        {fmtDateIN(h.date)}{h.paymentId ? ` · ID ${h.paymentId}` : ""}
                      </p>
                    </div>
                    <span className={`flex-none whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${h.status === "Paid" ? "bg-[var(--accent)]/15 text-[var(--accent)]" : h.status === "Pending review" ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--surface-alt)] text-[var(--dim)]"}`}>
                      {h.status}
                    </span>
                    {h.status === "Paid" && (
                      <button
                        type="button"
                        className={btnSmall + " flex-none"}
                        onClick={() => downloadReceipt(h.paymentId ?? h.key, [
                          `${BUSINESS_CONFIG.businessName}`,
                          `Payment receipt — ${BUSINESS_CONFIG.productName} Pro`,
                          ``,
                          `Plan: Pro ${h.billing === "annual" ? "Annual (365 days)" : "Monthly (30 days)"}`,
                          `Amount paid: ${formatMoney(h.amountInr, "INR")}`,
                          `Date: ${fmtDateIN(h.date)}`,
                          h.paymentId ? `Razorpay payment ID: ${h.paymentId}` : null,
                          `Billed to: ${userEmail ?? ""}`,
                          `Status: Paid`,
                          ``,
                          SHIPPING_NOTE,
                        ].filter((l) => l !== null) as string[])}
                      >
                        Download receipt
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
