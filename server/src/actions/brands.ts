// Brands: web-search discovery (Tavily + Groq distillation) and CRUD.

import { z } from "zod";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import { chatGroqJson } from "../lib/groq";
import { searchTavily } from "../lib/tavily";
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

export async function discoverBrands(
  ctx: ActionCtx,
  args: z.infer<typeof discoverBrandsSchema>,
): Promise<{ found: number; message: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  let results = await searchTavily(
    ctx.env.tavilyApiKey ?? "",
    `brands influencer marketing creator partnership program ${args.niche} creators ${args.country} apply`,
  );
  // If the first query comes back empty, retry once with a simpler query
  // before giving up — a keyword-stuffed query can return nothing even
  // when good matches exist.
  if (results.length === 0) {
    results = await searchTavily(
      ctx.env.tavilyApiKey ?? "",
      `${args.niche} brands influencer partnership ${args.country}`,
    );
  }
  const top = results.slice(0, 10);
  type Suggestion = { name: string; why: string; sourceUrl: string | null };
  let suggestions: Suggestion[] = [];
  try {
    const distilled = await chatGroqJson<{
      brands: {
        name: string;
        why?: string;
        reason?: string;
        sourceUrl?: string;
        url?: string;
      }[];
    }>(
      ctx.env.groqApiKey ?? "",
      "You extract structured data from web search results. Reply with a single JSON object only, no other text.",
      `From these web search results, extract up to 6 real brands or creator/affiliate programs a ${args.niche} YouTube creator in ${args.country} could pitch for a paid brand deal. Use only brands actually named in the results. For each, give the brand name, one short sentence on why it fits this niche, and the result URL it came from.\n\nResults:\n${top
        .map(
          (r, i) =>
            `${i + 1}. ${r.title} (web) — ${r.content ?? ""} — ${r.url ?? ""}`,
        )
        .join("\n")}`,
    );
    // The model may name the fields "reason"/"url" instead of
    // "why"/"sourceUrl" — accept either, so notes and links save.
    suggestions = (distilled.brands ?? []).map((b) => ({
      name: b.name,
      why: b.why ?? b.reason ?? "",
      sourceUrl: b.sourceUrl ?? b.url ?? null,
    }));
  } catch {
    suggestions = [];
  }
  // Fallback: if the AI step yields nothing (empty reply or a parse
  // failure), use the raw search sources instead of returning zero.
  if (suggestions.length === 0) {
    suggestions = results.slice(0, 6).map((s) => ({
      name: s.title.slice(0, 60),
      why: "Found in web search results for your niche.",
      sourceUrl: s.url,
    }));
  }
  const { data: existingData, error: existingError } = await db
    .from("brands")
    .select("*")
    .eq("owner_id", args.userId);
  dbThrow(existingError, "discoverBrands existing");
  const existingNames = new Set(
    ((existingData ?? []) as BrandRow[]).map((b) => b.name.toLowerCase()),
  );
  let added = 0;
  for (const s of suggestions) {
    if (!s.name.trim() || existingNames.has(s.name.toLowerCase())) continue;
    const { error } = await db.from("brands").insert({
      owner_id: args.userId,
      name: s.name.trim(),
      niche: args.niche,
      notes: s.why,
      source_url: s.sourceUrl,
      is_suggestion: true,
    });
    dbThrow(error, "discoverBrands insert");
    added++;
  }
  return {
    found: added,
    message:
      added > 0
        ? `Added ${added} brand suggestions. Review them below and keep the ones you want.`
        : "No new brands found for that search. Try a broader niche word.",
  };
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
  return { dealId: created.id, created: created.created };
}
