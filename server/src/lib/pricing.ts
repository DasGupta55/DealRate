// Pricing model — copied verbatim from the Brand Pricing Tool v2 source
// (server/src/actions.ts). The client mirrors these tables for its live
// preview; the server is the source of truth for Pro prices and for the
// niche/deliverable multipliers used by calculatePrice.

export const COUNTRY_CPM: Record<string, number> = {
  US: 28, UK: 24, Canada: 24, Australia: 22, Germany: 20, UAE: 18,
  Global: 15, Brazil: 9, India: 6, Philippines: 6, Indonesia: 5,
  Pakistan: 4, Bangladesh: 4,
};

export const NICHE_MULT: Record<string, number> = {
  Finance: 1.8, Tech: 1.6, Business: 1.6, Education: 1.4, Beauty: 1.2,
  Fitness: 1.2, Fashion: 1.1, Travel: 1.1, Food: 1.0, "Lifestyle / Vlog": 1.0,
  "Comedy / Entertainment": 0.9, Gaming: 0.85, Music: 0.8,
};

export const DELIVERABLE_MULT: Record<string, number> = {
  dedicated: 1.0, integration: 0.55, short: 0.35, post: 0.15,
};

export const DELIVERABLE_LABEL: Record<string, string> = {
  dedicated: "Dedicated video",
  integration: "60–90s integration",
  short: "Short / Reel",
  post: "Community post",
};

export function engagementFactor(pct: number): number {
  const f = 1 + (pct - 3) * 0.08;
  return Math.min(1.5, Math.max(0.75, f));
}

export function computePrice(input: {
  avgViews: number;
  engagementPct: number;
  cpm: number;
  nicheMult: number;
  deliverableMult: number;
}) {
  const ef = engagementFactor(input.engagementPct);
  const mid =
    (input.avgViews / 1000) *
    input.cpm *
    input.nicheMult *
    input.deliverableMult *
    ef;
  return { engagementFactor: ef, mid, low: mid * 0.8, high: mid * 1.25 };
}

/* ---------- Pro plan pricing — INR ONLY (backend config) ----------
   THE single editable Pro price list, mirrored in the client only
   for display. Checkout amounts are read from THIS object, never
   from anything the client sends, so a buyer cannot change the
   price. Razorpay amounts are in the smallest unit (paise):
   ₹189 = 18900, ₹1,399 = 139900. Pro lasts 30 days (monthly) or
   365 days (annual) from the verified payment. */
export const PRO_PRICING_INR = {
  monthly: { amountInr: 189, wasInr: 399, days: 30 },
  annual: { amountInr: 1399, wasInr: 4788, days: 365 },
} as const;
export type ProBilling = keyof typeof PRO_PRICING_INR;

export function todayKolkata(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
