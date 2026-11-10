// AI Brand Research — when a brand enters Deals, research the company
// from public sources so the creator can pitch with real facts.
//
// Sources are Tavily web search (official site first) distilled by
// Groq into one short, sourced finding per topic. Nothing is invented:
// a topic with no public evidence is null, and the UI shows "Not found
// in public sources" instead of claiming the company works with
// creators. Results are saved on the deal with the date they were
// checked, and reused for 30 days unless the creator refreshes.

import { z } from "zod";
import { requireProPlan, requireVerifiedUser } from "../lib/auth";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type BrandRow,
  type DealRow,
} from "../lib/db";
import { chatGroqJson } from "../lib/groq";
import { searchTavily, type TavilyResult } from "../lib/tavily";
import {
  userIdArg,
  type BrandResearch,
} from "./common";

const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const researchBrandSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
  force: z.boolean().optional(),
});

type ResearchJson = Omit<BrandResearch, "checkedAt" | "sources"> & {
  sources: { title: string; url: string }[];
};

export async function researchBrand(
  ctx: ActionCtx,
  args: z.infer<typeof researchBrandSchema>,
): Promise<{ research: BrandResearch }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);

  const { data: dealData, error: dealError } = await db
    .from("deals")
    .select("*")
    .eq("id", args.dealId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(dealError, "researchBrand deal");
  const deal = (dealData ?? null) as DealRow | null;
  if (!deal) throw new Error("Deal not found");

  // Reuse fresh research instead of searching again.
  const existing = (deal.research_json ?? null) as ResearchJson | string | null;
  const checkedAt = deal.research_checked_at
    ? new Date(deal.research_checked_at).getTime()
    : 0;
  if (existing && !args.force && Date.now() - checkedAt < RESEARCH_TTL_MS) {
    const parsed =
      typeof existing === "string"
        ? (JSON.parse(existing) as ResearchJson)
        : existing;
    return {
      research: {
        ...parsed,
        checkedAt: deal.research_checked_at as string,
      },
    };
  }

  // Official website (from the saved brand) + creator country for the
  // country-specific angle.
  const { data: brandData } = await db
    .from("brands")
    .select("*")
    .eq("owner_id", args.userId)
    .eq("name", deal.brand_name)
    .order("id", { ascending: false })
    .limit(1);
  const brand = ((brandData ?? []) as BrandRow[])[0];
  const { data: calcData } = await db
    .from("calculations")
    .select("audience_country")
    .eq("owner_id", args.userId)
    .order("id", { ascending: false })
    .limit(1);
  const country =
    ((calcData ?? []) as { audience_country: string | null }[])[0]
      ?.audience_country ?? null;

  const name = deal.brand_name;
  const queries = [
    `${name} official website products services`,
    `${name} influencer creator partnership program affiliate`,
    `${name} influencer marketing campaign collaboration`,
  ];
  const settled = await Promise.allSettled(
    queries.map((q) => searchTavily(ctx.env.tavilyApiKey ?? "", q)),
  );
  const results: TavilyResult[] = settled.flatMap((s) =>
    s.status === "fulfilled" ? s.value : [],
  );
  if (results.length === 0) {
    throw new Error(
      "Brand research is unavailable right now. Try again in a moment.",
    );
  }
  // Prefer official sources first, then deduplicate by URL.
  const official = results.filter((r) => {
    const host = (r.url ?? "").toLowerCase();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return slug.length > 2 && host.includes(slug);
  });
  const rest = results.filter((r) => !official.includes(r));
  const ordered = [...official, ...rest];
  const seen = new Set<string>();
  const sources = ordered
    .filter((r) => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .slice(0, 8);

  const distilled = await chatGroqJson<ResearchJson>(
    ctx.env.groqApiKey ?? "",
    "You research a company from web search results. Reply with a single JSON object only — no other text, no explanations.",
    [
      `Research the company "${name}" using ONLY the web search results below. Prioritize its official website and official pages over third-party articles.`,
      ``,
      `For each topic, write one short summary (1–3 sentences) using only facts present in the results, or null when there is no evidence. Never invent a product, program, campaign, partnership, or contact detail. Never claim the company works with creators, runs a creator program, or has an affiliate program unless a result actually says so.`,
      ``,
      `Topics (JSON keys): website (the official website URL, or null), products (products and services), marketing (marketing activities), influencerCollaborations (existing influencer collaborations, with names when the results give them), creatorProgram (creator partnership program, if one exists), campaigns (influencer marketing campaigns), affiliate (affiliate opportunities), countryOpportunities (partnership opportunities relevant to creators in ${country ?? "the creator's country"}), contact (publicly available business/partnership contact information).`,
      `Also return sources: up to 8 of the result links that support the findings, as {title, url}. Use only URLs from the results below.`,
      ``,
      `Search results:`,
      ...ordered.slice(0, 12).map(
        (r, i) => `${i + 1}. ${r.title} — ${r.url}\n${r.content ?? ""}`,
      ),
    ].join("\n"),
  );

  const checkedAtIso = new Date().toISOString();
  const research: BrandResearch = {
    website: distilled.website ?? brand?.website ?? null,
    products: distilled.products ?? null,
    marketing: distilled.marketing ?? null,
    influencerCollaborations: distilled.influencerCollaborations ?? null,
    creatorProgram: distilled.creatorProgram ?? null,
    campaigns: distilled.campaigns ?? null,
    affiliate: distilled.affiliate ?? null,
    countryOpportunities: distilled.countryOpportunities ?? null,
    contact: distilled.contact ?? null,
    sources: (distilled.sources ?? []).filter((s) => s?.url).slice(0, 8),
    checkedAt: checkedAtIso,
  };

  // Save on the deal. If the migration has not been run yet the
  // columns do not exist — say so plainly instead of failing silently.
  const { error: saveError } = await db
    .from("deals")
    .update({
      research_json: research,
      research_checked_at: checkedAtIso,
    })
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  if (saveError) {
    const msg = String(
      (saveError as { message?: string }).message ?? saveError,
    );
    if (/column|research_json|research_checked_at/i.test(msg)) {
      throw new Error(
        "Research storage isn't set up yet — run the migration SQL in the Supabase SQL Editor (supabase/migrations/002_add_deal_research.sql), then try again.",
      );
    }
    dbThrow(saveError, "researchBrand save");
  }
  return { research };
}
