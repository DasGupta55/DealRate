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
  bestContact,
  discoverBrandEmails,
} from "../lib/brandEmail";
import {
  dbThrow,
  requireDb,
  type ActionCtx,
  type BrandRow,
  type DealRow,
} from "../lib/db";
import { chatAiJson } from "../lib/ai";
import { searchTavily, type TavilyResult } from "../lib/tavily";
import {
  userIdArg,
  type BrandContact,
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

  // Reuse fresh research instead of searching again — but only when it
  // already includes discovered contacts. Research saved before email
  // discovery existed has no contacts, so it falls through to a fresh
  // run that discovers them.
  const existing = (deal.research_json ?? null) as ResearchJson | string | null;
  const checkedAt = deal.research_checked_at
    ? new Date(deal.research_checked_at).getTime()
    : 0;
  if (existing && !args.force && Date.now() - checkedAt < RESEARCH_TTL_MS) {
    const parsed =
      typeof existing === "string"
        ? (JSON.parse(existing) as ResearchJson)
        : existing;
    const cachedContacts = (parsed as { contacts?: BrandContact[] }).contacts ?? [];
    const cachedPhones = (parsed as { phones?: { phone: string; sourceUrl: string | null }[] }).phones ?? [];
    const cachedContactPage = (parsed as { contactPageUrl?: string | null }).contactPageUrl ?? null;
    // A guessed contact-page URL alone is not discovered contact data:
    // research that found no email and no phone falls through to a
    // fresh run, so the wider email search gets a chance to find one.
    if (cachedContacts.length > 0 || cachedPhones.length > 0) {
      // Fill the deal's email from the cached best contact when the
      // creator has not set one (or it was auto-filled before).
      const currentEmail = (deal.brand_email ?? "").trim();
      const manual = deal.brand_email_manual ?? false;
      if (!currentEmail || !manual) {
        const best = bestContact(
          cachedContacts.map((c) => ({
            email: c.email,
            category: c.category ?? "",
            sourceUrl: c.sourceUrl,
            rankScore: c.rankScore,
            mxVerified: c.mxVerified,
          })),
        );
        if (best && best.email !== currentEmail) {
          const { error: fillError } = await db
            .from("deals")
            .update({
              brand_email: best.email,
              brand_email_source: best.sourceUrl,
              brand_email_category: best.category,
              brand_email_manual: false,
            })
            .eq("id", args.dealId)
            .eq("owner_id", args.userId);
          if (fillError) {
            const msg = String(
              (fillError as { message?: string }).message ?? fillError,
            );
            if (/column|brand_email_source|brand_email_category|brand_email_manual/i.test(msg)) {
              await db
                .from("deals")
                .update({ brand_email: best.email })
                .eq("id", args.dealId)
                .eq("owner_id", args.userId);
            }
          }
        }
      }
      return {
        research: {
          ...parsed,
          contacts: cachedContacts,
          phones: cachedPhones,
          contactPageUrl: cachedContactPage,
          checkedAt: deal.research_checked_at as string,
        },
      };
    }
    // No contacts cached — fall through to a fresh run.
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

  const distilled = await chatAiJson<ResearchJson>(
    ctx.env,
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
  // Discover the brand's publicly listed sponsorship contacts from
  // its official pages and the search results. Best-effort: if the
  // pages cannot be fetched, research still returns without contacts.
  let contacts: BrandContact[] = [];
  let phones: { phone: string; sourceUrl: string | null }[] = [];
  let contactPageUrl: string | null = null;
  try {
    const discovered = await discoverBrandEmails({
      brandName: name,
      website: distilled.website ?? brand?.website ?? null,
      candidatePages: sources.map((s) => ({
        url: s.url,
        title: s.title,
        content: results.find((r) => r.url === s.url)?.content ?? "",
      })),
    });
    contacts = discovered.contacts.map((c) => ({
      id: null,
      email: c.email,
      category: c.category,
      sourceUrl: c.sourceUrl,
      rankScore: c.rankScore,
      mxVerified: c.mxVerified,
    }));
    phones = discovered.phones;
    contactPageUrl = discovered.contactPageUrl;
  } catch {
    contacts = [];
    phones = [];
    contactPageUrl = null;
  }

  // Fallback: nothing on the brand's own pages. Search the wider web
  // specifically for the brand's contact email — business directories
  // and listings often publish a general official email the brand's
  // own site does not (for example a business@ address). Only runs
  // when the first pass found nothing, so brands that do publish an
  // email do not pay for the extra search.
  if (contacts.length === 0) {
    try {
      const emailQueries = [
        `${name} contact email`,
        `${name} business email partnerships`,
      ];
      const emailSettled = await Promise.allSettled(
        emailQueries.map((q) => searchTavily(ctx.env.tavilyApiKey ?? "", q)),
      );
      const emailResults: TavilyResult[] = emailSettled.flatMap((s) =>
        s.status === "fulfilled" ? s.value : [],
      );
      if (emailResults.length > 0) {
        const discovered2 = await discoverBrandEmails({
          brandName: name,
          website: distilled.website ?? brand?.website ?? null,
          candidatePages: emailResults.map((r) => ({
            url: r.url ?? "",
            title: r.title ?? "",
            content: r.content ?? "",
          })),
        });
        contacts = discovered2.contacts.map((c) => ({
          id: null,
          email: c.email,
          category: c.category,
          sourceUrl: c.sourceUrl,
          rankScore: c.rankScore,
          mxVerified: c.mxVerified,
        }));
        phones = [...phones, ...discovered2.phones];
        if (!contactPageUrl) contactPageUrl = discovered2.contactPageUrl;
      }
    } catch {
      // Best-effort fallback — the research still stands without contacts.
    }
  }

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
    contacts,
    phones,
    contactPageUrl,
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
        "Research storage isn't set up yet — run the migration SQL in the Supabase SQL Editor (supabase/migrations/003_brand_contacts.sql), then try again.",
      );
    }
    dbThrow(saveError, "researchBrand save");
  }

  // Persist the discovered contacts and auto-fill the deal's brand
  // email with the best one — but never overwrite an email the
  // creator typed themselves. Best-effort: if the contacts table or
  // the provenance columns do not exist yet (migration not run), the
  // research above still stands and the email is filled without its
  // provenance.
  if (contacts.length > 0) {
    const best = bestContact(
      contacts.map((c) => ({
        email: c.email,
        category: c.category ?? "",
        sourceUrl: c.sourceUrl,
        rankScore: c.rankScore,
        mxVerified: c.mxVerified,
      })),
    );
    await db.from("brand_contacts").delete().eq("deal_id", args.dealId).eq("owner_id", args.userId);
    const { error: contactsError } = await db.from("brand_contacts").insert(
      contacts.map((c) => ({
        owner_id: args.userId,
        deal_id: args.dealId,
        email: c.email,
        category: c.category,
        source_url: c.sourceUrl,
        rank_score: c.rankScore,
        mx_verified: c.mxVerified,
      })),
    );
    const contactsTableMissing =
      contactsError &&
      /relation|does not exist|column|brand_contacts/i.test(
        String((contactsError as { message?: string }).message ?? contactsError),
      );
    if (!contactsTableMissing && contactsError) {
      dbThrow(contactsError, "researchBrand save contacts");
    }
    const currentEmail = (deal.brand_email ?? "").trim();
    const manual = deal.brand_email_manual ?? false;
    if (best && (!currentEmail || !manual)) {
      const emailPatch: Record<string, unknown> = {
        brand_email: best.email,
        brand_email_source: best.sourceUrl,
        brand_email_category: best.category,
        brand_email_manual: false,
      };
      const { error: emailError } = await db
        .from("deals")
        .update(emailPatch)
        .eq("id", args.dealId)
        .eq("owner_id", args.userId);
      if (emailError) {
        const msg = String(
          (emailError as { message?: string }).message ?? emailError,
        );
        if (/column|brand_email_source|brand_email_category|brand_email_manual/i.test(msg)) {
          // Provenance columns missing — fill just the email.
          await db
            .from("deals")
            .update({ brand_email: best.email })
            .eq("id", args.dealId)
            .eq("owner_id", args.userId);
        } else {
          dbThrow(emailError, "researchBrand fill brand email");
        }
      }
    }
  }

  return { research };
}

export const listBrandContactsSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
});

/** The discovered contacts saved for a deal, best-ranked first. */
export async function listBrandContacts(
  ctx: ActionCtx,
  args: z.infer<typeof listBrandContactsSchema>,
): Promise<{ contacts: BrandContact[] }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("brand_contacts")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("owner_id", args.userId)
    .order("rank_score", { ascending: false })
    .order("id", { ascending: true });
  if (error) {
    const msg = String((error as { message?: string }).message ?? error);
    if (/relation|does not exist|column|brand_contacts/i.test(msg)) {
      return { contacts: [] };
    }
    dbThrow(error, "listBrandContacts");
  }
  const rows = (data ?? []) as {
    id: number;
    email: string;
    category: string | null;
    source_url: string | null;
    rank_score: number;
    mx_verified: boolean | null;
  }[];
  return {
    contacts: rows.map((r) => ({
      id: r.id,
      email: r.email,
      category: r.category,
      sourceUrl: r.source_url,
      rankScore: r.rank_score,
      mxVerified: r.mx_verified,
    })),
  };
}

export const selectBrandContactSchema = z.object({
  userId: userIdArg,
  accessToken: z.string().optional(),
  dealId: z.number(),
  contactId: z.number(),
});

/** Use one of the discovered contacts as the deal's brand email.
 *  The creator picks it explicitly, so it is not a manual email and
 *  a later refresh may replace it with a better-ranked contact. */
export async function selectBrandContact(
  ctx: ActionCtx,
  args: z.infer<typeof selectBrandContactSchema>,
): Promise<{ ok: true; email: string }> {
  const db = requireDb(ctx);
  await requireVerifiedUser(ctx, args.userId, args.accessToken);
  await requireProPlan(ctx, args.userId);
  const { data, error } = await db
    .from("brand_contacts")
    .select("*")
    .eq("id", args.contactId)
    .eq("deal_id", args.dealId)
    .eq("owner_id", args.userId)
    .limit(1)
    .maybeSingle();
  dbThrow(error, "selectBrandContact contact");
  const contact = (data ?? null) as {
    email: string;
    category: string | null;
    source_url: string | null;
  } | null;
  if (!contact) throw new Error("Contact not found");
  const patch: Record<string, unknown> = {
    brand_email: contact.email,
    brand_email_source: contact.source_url,
    brand_email_category: contact.category,
    brand_email_manual: false,
  };
  const { error: updateError } = await db
    .from("deals")
    .update(patch)
    .eq("id", args.dealId)
    .eq("owner_id", args.userId);
  if (updateError) {
    const msg = String(
      (updateError as { message?: string }).message ?? updateError,
    );
    if (/column|brand_email_source|brand_email_category|brand_email_manual/i.test(msg)) {
      const { error: retryError } = await db
        .from("deals")
        .update({ brand_email: contact.email })
        .eq("id", args.dealId)
        .eq("owner_id", args.userId);
      dbThrow(retryError, "selectBrandContact deal");
    } else {
      dbThrow(updateError, "selectBrandContact deal");
    }
  }
  return { ok: true, email: contact.email };
}
