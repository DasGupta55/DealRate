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
  const results = await searchTavily(
    ctx.env.tavilyApiKey ?? "",
    `brands influencer marketing creator partnership program ${args.niche} creators ${args.country} apply`,
  );
  const top = results.slice(0, 10);
  type Suggestion = { name: string; why: string; sourceUrl: string | null };
  let suggestions: Suggestion[] = [];
  try {
    const distilled = await chatGroqJson<{
      brands: { name: string; why: string; sourceUrl: string }[];
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
    suggestions = (distilled.brands ?? []).map((b) => ({
      name: b.name,
      why: b.why,
      sourceUrl: b.sourceUrl || null,
    }));
  } catch {
    // Fallback: raw search sources, exactly as in the source.
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
