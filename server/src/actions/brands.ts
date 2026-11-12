// Brands: web-search discovery (Tavily + Groq distillation) and CRUD.

import { z } from "zod";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import { discoverSponsorshipBrands } from "../lib/sponsorship";
import { bestContact, discoverBrandEmails } from "../lib/brandEmail";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type BrandRow,
} from "../lib/db";
import { userIdArg } from "./common";
import { createDeal } from "./deals";

export const discoverBrandsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  niche: z.string().min(2),
  country: z.string().min(2),
});

/** A search is cached for 24 hours: if the creator already has
 *  suggestions for this exact niche + market from a recent search,
 *  return those instead of spending Tavily and AI calls again.
 *  Dismissed brands are deleted, so they never come back. */
const SEARCH_CACHE_HOURS = 24;

export async function discoverBrands(
  ctx: ActionCtx,
  args: z.infer<typeof discoverBrandsSchema>,
): Promise<{ found: number; message: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const niche = args.niche.trim();
  const country = args.country.trim();

  // Cached results first — same niche + market searched recently.
  const cacheCutoff = new Date(
    Date.now() - SEARCH_CACHE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: cachedData } = await db
    .from("brands")
    .select("id")
    .eq("owner_id", args.userId)
    .eq("is_suggestion", true)
    .eq("niche", niche)
    .eq("creator_market", country)
    .gte("created_at", cacheCutoff)
    .limit(1);
  if ((cachedData ?? []).length > 0) {
    return {
      found: 0,
      message: `Showing your recent ${niche} results for ${country} — search again tomorrow for fresh ones.`,
    };
  }

  const { discovery } = await discoverSponsorshipBrands(ctx.env, niche, country);
  // NOTE: contact emails are NOT looked up here. Fetching each
  // brand's contact pages adds up to ~10s on top of the web search +
  // AI distillation, and the combined call then exceeds Netlify's
  // function time limit and fails with a 504. The brands are saved
  // first (email blank), the search returns fast, and the client
  // immediately calls enrichBrandEmails as a second call to fill the
  // emails in — they land on the cards a few seconds later.
  const { data: existingData, error: existingError } = await db
    .from("brands")
    .select("*")
    .eq("owner_id", args.userId);
  dbThrow(existingError, "discoverBrands existing");
  const existingNames = new Set(
    ((existingData ?? []) as BrandRow[]).map((b) => b.name.toLowerCase()),
  );
  const existingWebsites = new Set(
    ((existingData ?? []) as BrandRow[])
      .map((b) => (b.website ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  let added = 0;
  for (const s of discovery.brands) {
    if (!s.name.trim() || existingNames.has(s.name.toLowerCase())) continue;
    const website = (s.website ?? "").trim() || null;
    if (website && existingWebsites.has(website.toLowerCase())) continue;
    const { error } = await db.from("brands").insert({
      owner_id: args.userId,
      name: s.name.trim(),
      website,
      contact_email: null, // filled in by enrichBrandEmails, right after the search
      niche,
      notes: s.why,
      source_url: s.sourceUrl,
      is_suggestion: true,
      hq_country: s.hqCountry,
      classification: s.classification,
      creator_market: country,
      industry: s.industry,
      evidence_json: {
        evidence: s.evidence,
        exampleCreator: s.exampleCreator,
        platform: s.platform,
        evidenceDate: s.evidenceDate,
        evidenceUrl: s.evidenceUrl,
        partnershipUrl: s.partnershipUrl,
        contactPageUrl: null, // filled in by enrichBrandEmails, right after the search
      },
    });
    dbThrow(error, "discoverBrands insert");
    added++;
  }
  let agenciesAdded = 0;
  for (const a of discovery.agencies) {
    if (!a.name.trim() || existingNames.has(a.name.toLowerCase())) continue;
    const website = (a.website ?? "").trim() || null;
    if (website && existingWebsites.has(website.toLowerCase())) continue;
    const { error } = await db.from("brands").insert({
      owner_id: args.userId,
      name: a.name.trim(),
      website,
      niche,
      notes: a.why,
      source_url: a.sourceUrl,
      is_suggestion: true,
      is_agency: true,
      creator_market: country,
    });
    dbThrow(error, "discoverBrands agency insert");
    agenciesAdded++;
  }
  const total = added + agenciesAdded;
  return {
    found: total,
    message:
      total > 0
        ? `Added ${added} brand suggestion${added === 1 ? "" : "s"}${agenciesAdded > 0 ? ` and ${agenciesAdded} ${agenciesAdded === 1 ? "agency" : "agencies"}` : ""}. Review them below — verified paid brands are listed first.`
        : "No brands with clear paid sponsorship evidence found for that search. Try a broader niche word.",
  };
}

export const enrichBrandEmailsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  niche: z.string().min(2),
  country: z.string().min(2),
});

/** Fill in contact emails for the brands a search just found.
 * This runs as a SEPARATE call after discoverBrands returns, because
 * fetching each brand's contact pages takes several seconds and the
 * search itself (web search + AI) already uses most of Netlify's
 * function time — doing both in one call fails with a 504. The brands
 * show up immediately; their emails land a few seconds later and the
 * list refreshes. A brand that publishes no public email simply stays
 * blank — that is the honest result, and its contact-page link is
 * saved instead when one is found. */
export async function enrichBrandEmails(
  ctx: ActionCtx,
  args: z.infer<typeof enrichBrandEmailsSchema>,
): Promise<{ enriched: number }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const niche = args.niche.trim();
  const country = args.country.trim();
  const { data, error } = await db
    .from("brands")
    .select("id, name, website, contact_email, evidence_json")
    .eq("owner_id", args.userId)
    .eq("is_suggestion", true)
    .eq("niche", niche)
    .eq("creator_market", country)
    .order("created_at", { ascending: false })
    .limit(8);
  dbThrow(error, "enrichBrandEmails list");
  // Re-process brands with no email, and brands whose stored email is
  // a unicode-escape artefact (e.g. "u003esupport@anker.com") left by
  // the extractor before it stripped those.
  const rows = ((data ?? []) as BrandRow[]).filter(
    (b) => !b.contact_email || /u003[ce]/i.test(b.contact_email),
  );
  let enriched = 0;
  await Promise.allSettled(
    rows.map(async (b) => {
      const website = (b.website ?? "").trim() || null;
      if (!website) return;
      try {
        const found = await Promise.race([
          discoverBrandEmails({
            brandName: b.name,
            website,
            candidatePages: [],
          }),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 8_000),
          ),
        ]);
        if (!found) return;
        const best = bestContact(found.contacts);
        const patch: { contact_email?: string | null; evidence_json?: unknown } = {};
        if (best) patch.contact_email = best.email;
        if (found.contactPageUrl) {
          const prev = (b.evidence_json ?? {}) as Record<string, unknown>;
          patch.evidence_json = { ...prev, contactPageUrl: found.contactPageUrl };
        }
        if (Object.keys(patch).length === 0) return;
        const { error: upErr } = await db
          .from("brands")
          .update(patch)
          .eq("id", b.id);
        dbThrow(upErr, "enrichBrandEmails update");
        enriched++;
      } catch {
        /* no contact found for this brand — leave it blank */
      }
    }),
  );
  return { enriched };
}

export const addBrandSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number().optional(),
  name: z.string().min(1),
  website: z.string().optional(),
  contactEmail: z.string().optional(),
  niche: z.string().optional(),
  notes: z.string().optional(),
});

export async function addBrand(
  ctx: ActionCtx,
  args: z.infer<typeof addBrandSchema>,
): Promise<{ id: number }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  if (args.id) {
    const { error } = await db
      .from("brands")
      .update({
        name: args.name,
        website: args.website ?? null,
        contact_email: args.contactEmail ?? null,
        niche: args.niche ?? null,
        notes: args.notes ?? null,
        is_suggestion: false,
      })
      .eq("id", args.id)
      .eq("owner_id", args.userId);
    dbThrow(error, "addBrand update");
    return { id: args.id };
  }
  const { data, error } = await db
    .from("brands")
    .insert({
      owner_id: args.userId,
      name: args.name,
      website: args.website ?? null,
      contact_email: args.contactEmail ?? null,
      niche: args.niche ?? null,
      notes: args.notes ?? null,
      is_suggestion: false,
    })
    .select("id")
    .single();
  dbThrow(error, "addBrand insert");
  if (!data) throw new Error("addBrand: insert returned no rows");
  return { id: (data as { id: number }).id };
}

export const deleteBrandSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  id: z.number(),
});

export async function deleteBrand(
  ctx: ActionCtx,
  args: z.infer<typeof deleteBrandSchema>,
): Promise<{ ok: true }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { error } = await db
    .from("brands")
    .delete()
    .eq("id", args.id)
    .eq("owner_id", args.userId);
  dbThrow(error, "deleteBrand");
  return { ok: true };
}

// One tap from Brand Finder to a deal in the pipeline: keeps the brand
// on the saved-brands shortlist and creates the deal (or returns the
// existing one when this brand is already in Deals). The client
// navigates to the Deals tab on success.
export const addBrandToDealsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  brandId: z.number(),
});

export async function addBrandToDeals(
  ctx: ActionCtx,
  args: z.infer<typeof addBrandToDealsSchema>,
): Promise<{ dealId: number; created: boolean }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data: brandData, error: brandError } = await db
    .from("brands")
    .select("*")
    .eq("id", args.brandId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(brandError, "addBrandToDeals brand");
  const brand = (brandData ?? null) as BrandRow | null;
  if (!brand) throw new Error("Brand not found");
  // Keep it on the saved-brands shortlist (no-op if already saved).
  const { error: saveError } = await db
    .from("brands")
    .update({ is_suggestion: false })
    .eq("id", args.brandId)
    .eq("owner_id", args.userId);
  dbThrow(saveError, "addBrandToDeals save brand");
  // Default agreed price from the latest calculation, same as the old
  // Start-a-deal button used.
  const { data: calcData, error: calcError } = await db
    .from("calculations")
    .select("price_mid")
    .eq("owner_id", args.userId)
    .order("id", { ascending: false })
    .limit(1);
  dbThrow(calcError, "addBrandToDeals calculation");
  const priceMid = ((calcData ?? []) as { price_mid: number | null }[])[0]
    ?.price_mid ?? null;
  const created = await createDeal(ctx, {
    userId: args.userId,
    accessToken: args.accessToken,
    brandName: brand.name,
    brandEmail: brand.contact_email ?? undefined,
    deliverable: "dedicated",
    agreedPrice: priceMid ?? undefined,
    currency: "USD",
  });
  // Carry the Brand Finder evidence onto the deal, so the pipeline
  // shows why this brand was recommended and what paid activity was
  // found — the research step then adds contacts on top of it.
  if (!brand.is_agency) {
    const ev = (brand.evidence_json ?? null) as {
      evidence?: string | null;
      exampleCreator?: string | null;
      platform?: string | null;
      evidenceDate?: string | null;
      evidenceUrl?: string | null;
      partnershipUrl?: string | null;
    } | null;
    const sponsorship = {
      hqCountry: brand.hq_country ?? null,
      classification: brand.classification ?? null,
      creatorMarket: brand.creator_market ?? null,
      industry: brand.industry ?? null,
      evidence: ev?.evidence ?? null,
      exampleCreator: ev?.exampleCreator ?? null,
      platform: ev?.platform ?? null,
      evidenceDate: ev?.evidenceDate ?? null,
      evidenceUrl: ev?.evidenceUrl ?? null,
      partnershipUrl: ev?.partnershipUrl ?? null,
    };
    const hasSponsorship =
      sponsorship.hqCountry !== null ||
      sponsorship.classification !== null ||
      sponsorship.evidence !== null ||
      sponsorship.partnershipUrl !== null;
    if (hasSponsorship) {
      const { data: dealData, error: dealReadError } = await db
        .from("deals")
        .select("research_json")
        .eq("id", created.id)
        .eq("owner_id", args.userId)
        .limit(1)
        .maybeSingle();
      dbThrow(dealReadError, "addBrandToDeals read deal research");
      const existing =
        ((dealData as { research_json?: Record<string, unknown> } | null)
          ?.research_json ?? {}) as Record<string, unknown>;
      const { error: researchError } = await db
        .from("deals")
        .update({
          research_json: { ...existing, sponsorship },
        })
        .eq("id", created.id)
        .eq("owner_id", args.userId);
      dbThrow(researchError, "addBrandToDeals save sponsorship");
    }
  }
  return { dealId: created.id, created: created.created };
}
