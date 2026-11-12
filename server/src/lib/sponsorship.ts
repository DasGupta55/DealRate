// Sponsorship evidence discovery — the heart of the global Brand
// Finder. Given a niche and a creator/audience market, it searches
// for brands that actually pay creators in that market, classifies
// each one by the strength of its paid-sponsorship evidence, and
// ranks verified paid brands first.
//
// The selected market is the creator's audience, NOT the brand's
// headquarters. A US company that sponsors Indian creators is a
// valid result for market = India. A brand is only recommended for
// a market when there is reasonable evidence it accepts creators
// from that market, has worked with them, or runs campaigns
// targeting that market.

import { searchTavily, type TavilyResult } from "./tavily";
import { chatAiJson } from "./ai";
import type { Env } from "./env";

export const SPONSORSHIP_CLASSIFICATIONS = [
  "verified_paid",
  "active_program",
  "international_paid",
  "potential",
  "affiliate_only",
] as const;

export type SponsorshipClassification =
  (typeof SPONSORSHIP_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<SponsorshipClassification, string> = {
  verified_paid: "Verified Paid Collaborations",
  active_program: "Active Paid Creator Program",
  international_paid: "International Paid Partnership",
  potential: "Potential Partnership",
  affiliate_only: "Affiliate Only",
};

/** Lower number = stronger evidence = ranks first. */
export const CLASSIFICATION_RANK: Record<SponsorshipClassification, number> = {
  verified_paid: 0,
  active_program: 1,
  international_paid: 2,
  potential: 3,
  affiliate_only: 4,
};

export interface SponsorshipEvidence {
  /** One plain sentence describing the paid activity that was found. */
  evidence: string | null;
  /** Creator or campaign name, where the evidence names one. */
  exampleCreator: string | null;
  /** Platform the evidence was on: YouTube, Instagram, etc. */
  platform: string | null;
  /** Date or year of the campaign/evidence, when stated. */
  evidenceDate: string | null;
  /** Direct link to the sponsored video, post, or campaign page. */
  evidenceUrl: string | null;
  /** Official creator / partnership program page, when one exists. */
  partnershipUrl: string | null;
}

export interface DiscoveredBrand extends SponsorshipEvidence {
  name: string;
  website: string | null;
  hqCountry: string | null;
  industry: string | null;
  classification: SponsorshipClassification;
  /** Why this brand fits the niche and market (one short sentence). */
  why: string;
  sourceUrl: string | null;
}

export interface DiscoveredAgency {
  name: string;
  website: string | null;
  why: string;
  sourceUrl: string | null;
}

export interface SponsorshipDiscovery {
  brands: DiscoveredBrand[];
  agencies: DiscoveredAgency[];
}

/** Publications, listicles and aggregators that are sources of
 *  evidence, never brands to recommend. The AI prompt excludes
 *  these, and this is a backstop for the most common offenders. */
const NON_BRAND_NAMES = new Set(
  [
    "business insider",
    "forbes",
    "techcrunch",
    "yourstory",
    "hindustan times",
    "times of india",
    "economic times",
    "the verge",
    "wired",
    "mashable",
    "buzzfeed",
    "ndtv",
    "india today",
    "livemint",
    "moneycontrol",
    "inc42",
    "theprint",
    "scroll.in",
    "the wire",
    "quartz",
    "bloomberg",
    "reuters",
    "cnbc",
    "the guardian",
    "bbc",
    "wikipedia",
    "reddit",
    "quora",
    "medium",
    "linkedin",
    "crunchbase",
    "glassdoor",
    "indeed",
    "g2",
    "capterra",
    "trustpilot",
    "product hunt",
  ].map((s) => s.toLowerCase()),
);

/** A result that is a publication, a listicle, or an aggregator is
 *  a source of evidence, never a brand. Exported for testing. */
export function isNonBrand(name: string, url: string | null): boolean {
  const lower = name.trim().toLowerCase();
  if (NON_BRAND_NAMES.has(lower)) return true;
  // A result whose title is a listicle ("Top 10…", "Best tech
  // brands in India") is an article, not a brand. A real brand
  // that merely starts with "Best" (e.g. Best Buy) is not blocked
  // — only "Best …" followed by a list word is.
  if (/^top\b/i.test(lower)) return true;
  if (
    /^best\b/i.test(lower) &&
    /\b(in|for|brands|companies|agencies|tools|apps|products|sites)\b/i.test(lower)
  ) {
    return true;
  }
  if (/^(how|why|what)\b/i.test(lower)) return true;
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      for (const blocked of NON_BRAND_NAMES) {
        if (host.includes(blocked.replace(/[^a-z]/g, ""))) return true;
      }
    } catch {
      /* ignore a bad URL here; the AI still filters it */
    }
  }
  return false;
}

/** The three search angles. Together they cover paid evidence,
 *  official creator programs, and international brands targeting
 *  the market — instead of one generic query. */
export function sponsorshipQueries(niche: string, country: string): string[] {
  return [
    `${niche} brands sponsored ${country} YouTuber paid collaboration`,
    `${niche} creator partnership program ${country} apply paid`,
    `${niche} brands influencer marketing ${country} paid campaign`,
  ];
}

const DISTILL_SYSTEM =
  "You extract structured data from web search results. Reply with a single JSON object only, no other text. " +
  "Never invent a brand, a campaign, a price, a payment amount, or a contact. " +
  "Use only brands and evidence actually named in the results. " +
  "If a result gives no evidence for a brand, say so — do not upgrade it to a stronger category.";

/** The system prompt for the distillation. Exported so the prompt
 *  can be verified against the live AI with sample results. */
export { DISTILL_SYSTEM };

/** Build the distillation prompt for a niche, market and set of
 *  search results. Exported so the prompt can be verified against
 *  the live AI with sample results. */
export function buildDistillPrompt(
  niche: string,
  country: string,
  results: TavilyResult[],
): string {
  return [
    `Find brands that actually PAY creators in the ${niche} niche for the ${country} creator/audience market. The market is the creator's audience, NOT the brand's HQ — a foreign company that sponsors ${country} creators IS valid.`,
    ``,
    `RULES:`,
    `1. Only real companies that sell a product or service in this niche. A brand SELLS something (food, clothes, phones). An agency's business is connecting brands with creators — if its main work is matchmaking, it is an agency, not a brand. Never list articles, publications, listicles, agencies or marketplaces as brands — those go in "agencies".`,
    `2. Gifting, barter or affiliate is NOT paid sponsorship — classify as affiliate_only or potential, never verified_paid.`,
    `3. Classify honestly from the evidence only: verified_paid (proof of paid work with ${country} creators), active_program (an active paid program open to ${country} creators), international_paid (foreign company with paid work targeting ${country}), potential (contact exists but paid work unconfirmed — use this when unsure), affiliate_only (affiliate only, no fixed fee).`,
    `4. For each brand give: website, HQ country, industry, one evidence sentence, example creator/campaign if named, platform, date if stated, evidence link, partnership page link. Leave a field null when the results don't state it — never guess.`,
    `5. Rank by evidence strength, verified first. Return at most 6 brands and 3 agencies. Fewer is fine — don't pad with weak matches.`,
    ``,
    `Return JSON in exactly this shape:`,
    `{"brands": [{"name": "...", "website": "...", "hqCountry": "...", "industry": "...", "classification": "verified_paid|active_program|international_paid|potential|affiliate_only", "evidence": "...", "exampleCreator": "...", "platform": "...", "evidenceDate": "...", "evidenceUrl": "...", "partnershipUrl": "...", "why": "...", "sourceUrl": "..."}], "agencies": [{"name": "...", "website": "...", "why": "...", "sourceUrl": "..."}]}`,
    ``,
    `Search results:`,
    results
      .map((r, i) => `${i + 1}. ${r.title} — ${r.content ?? ""} — ${r.url ?? ""}`)
      .join("\n"),
  ].join("\n");
}

interface DistilledBrand {
  name?: string;
  website?: string | null;
  hqCountry?: string | null;
  industry?: string | null;
  classification?: string;
  evidence?: string | null;
  exampleCreator?: string | null;
  platform?: string | null;
  evidenceDate?: string | null;
  evidenceUrl?: string | null;
  partnershipUrl?: string | null;
  why?: string;
  reason?: string;
  sourceUrl?: string | null;
  url?: string | null;
}

function toClassification(value: string | undefined): SponsorshipClassification {
  if (
    value &&
    (SPONSORSHIP_CLASSIFICATIONS as readonly string[]).includes(value)
  ) {
    return value as SponsorshipClassification;
  }
  return "potential";
}

/**
 * Distill a set of search results into ranked, classified brands
 * plus a separate agencies list. Exported so it can be tested with
 * realistic sample results without calling the search API.
 */
export async function distillSponsorshipResults(
  env: Env,
  niche: string,
  country: string,
  results: TavilyResult[],
): Promise<SponsorshipDiscovery> {
  const top = results.slice(0, 12);
  // The AI step is the one that can fail transiently (a bad reply, a
  // parse error). Retry it once before giving up — a valid empty
  // result (no real brands found) is not an error and is not retried.
  let distilled: {
    brands?: DistilledBrand[];
    agencies?: {
      name?: string;
      website?: string | null;
      why?: string;
      reason?: string;
      sourceUrl?: string | null;
      url?: string | null;
    }[];
  } | null = null;
  for (let attempt = 0; attempt < 2 && !distilled; attempt++) {
    try {
      distilled = await chatAiJson<{
        brands?: DistilledBrand[];
        agencies?: {
          name?: string;
          website?: string | null;
          why?: string;
          reason?: string;
          sourceUrl?: string | null;
          url?: string | null;
        }[];
      }>(env, DISTILL_SYSTEM, buildDistillPrompt(niche, country, top), {
        // The distillation returns up to 6 brands + 3 agencies of
        // JSON. Keep the prompt and the answer short on purpose: a
        // long detailed prompt plus a 3500-token reply made the
        // search run ~25-30s and time out. 12 results in, 6 brands
        // out, 2500 tokens is enough room for the full answer and
        // keeps the whole search to a few seconds. Other AI calls
        // keep their own budgets.
        // Uses the default 120b model (no model override): with the
        // short prompt the 120b answers in ~4s, and it is more
        // reliable than the fast 20b at telling real brands apart
        // from agencies on messy real search results — the 20b
        // returned 0 brands and only agencies for Food and Finance.
        maxTokens: 2500,
      });
    } catch {
      distilled = null;
    }
  }
  let discovery: SponsorshipDiscovery = { brands: [], agencies: [] };
  if (distilled) {
    const seen = new Set<string>();
    const brands: DiscoveredBrand[] = [];
    for (const b of distilled.brands ?? []) {
      const name = (b.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      if (isNonBrand(name, b.sourceUrl ?? b.url ?? null)) continue;
      seen.add(name.toLowerCase());
      const classification = toClassification(b.classification);
      // A brand the AI put in a paid category without any evidence
      // sentence is downgraded — the category must be earned.
      const evidence = (b.evidence ?? "").trim() || null;
      const honestClassification =
        (classification === "verified_paid" ||
          classification === "international_paid") &&
        !evidence
          ? "potential"
          : classification;
      brands.push({
        name,
        website: (b.website ?? "").trim() || null,
        hqCountry: (b.hqCountry ?? "").trim() || null,
        industry: (b.industry ?? "").trim() || null,
        classification: honestClassification,
        evidence,
        exampleCreator: (b.exampleCreator ?? "").trim() || null,
        platform: (b.platform ?? "").trim() || null,
        evidenceDate: (b.evidenceDate ?? "").trim() || null,
        evidenceUrl: (b.evidenceUrl ?? "").trim() || null,
        partnershipUrl: (b.partnershipUrl ?? "").trim() || null,
        why: (b.why ?? b.reason ?? "").trim(),
        sourceUrl: (b.sourceUrl ?? b.url ?? null) || null,
      });
    }
    // Enforce the evidence-strength ranking server-side, so the
    // order never depends on the model's ordering.
    brands.sort(
      (a, b) => CLASSIFICATION_RANK[a.classification] - CLASSIFICATION_RANK[b.classification],
    );
    const agencies: DiscoveredAgency[] = [];
    const seenAgency = new Set<string>();
    for (const a of distilled.agencies ?? []) {
      const name = (a.name ?? "").trim();
      if (!name || seenAgency.has(name.toLowerCase())) continue;
      seenAgency.add(name.toLowerCase());
      agencies.push({
        name,
        website: (a.website ?? "").trim() || null,
        why: (a.why ?? a.reason ?? "").trim(),
        sourceUrl: (a.sourceUrl ?? a.url ?? null) || null,
      });
    }
    discovery = { brands: brands.slice(0, 8), agencies: agencies.slice(0, 4) };
  }
  return discovery;
}

/**
 * Run the three-angle search and distill it into ranked, classified
 * brands plus a separate agencies list. Returns the raw Tavily
 * results too, so the caller can see what the search found.
 */
export async function discoverSponsorshipBrands(
  env: Env,
  niche: string,
  country: string,
): Promise<{ discovery: SponsorshipDiscovery; raw: TavilyResult[] }> {
  const queries = sponsorshipQueries(niche, country);
  const settled = await Promise.allSettled(
    queries.map((q) => searchTavily(env.tavilyApiKey ?? "", q)),
  );
  const byUrl = new Map<string, TavilyResult>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value) {
      if (!r.url || byUrl.has(r.url)) continue;
      byUrl.set(r.url, r);
    }
  }
  const raw = [...byUrl.values()];
  const discovery = await distillSponsorshipResults(env, niche, country, raw);
  return { discovery, raw };
}
