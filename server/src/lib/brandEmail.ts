// Brand email discovery — find a brand's publicly listed sponsorship
// contact emails from its official pages and web search results.
//
// Sources, in order: the brand's official website and contact /
// partnership / creator pages (fetched and scanned for mailto: links
// and email addresses in the text), plus the Tavily search snippets
// already gathered by brand research. Nothing is fabricated: an
// address only appears when it was actually found on a page or in a
// search result, and every contact records the URL it came from.
//
// Ranking (highest first): influencer / creator / partnership /
// sponsorship addresses, then marketing / business, then affiliate.
// Support, billing, refunds, sales and personal-employee addresses
// are excluded from auto-selection. The domain's MX records are
// checked best-effort so an address on a domain that cannot receive
// mail is never auto-selected. No inbox is ever claimed verified or
// deliverable — MX only says the domain accepts mail.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_RE = /href\s*=\s*["']mailto:([^"'\s?]+)/gi;

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "protonmail.com",
  "proton.me",
  "icloud.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "zoho.com",
]);

// Local parts that are never a sponsorship contact.
const EXCLUDED_LOCAL = [
  "support",
  "help",
  "helpdesk",
  "billing",
  "bill",
  "refund",
  "refunds",
  "sales",
  "career",
  "careers",
  "job",
  "jobs",
  "hr",
  "legal",
  "privacy",
  "abuse",
  "postmaster",
  "webmaster",
  "admin",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "unsubscribe",
  "newsletter",
  "noreply",
];

// Local parts that are placeholders or test values, not a real person
// or role (e.g. the "abc@hotmail.com" a brand's contact page uses as
// a form example). These are never a real contact.
const PLACEHOLDER_LOCAL = new Set([
  "abc",
  "abc123",
  "test",
  "test123",
  "testing",
  "example",
  "demo",
  "sample",
  "xxx",
  "xyz",
  "name",
  "yourname",
  "your-name",
  "firstname",
  "lastname",
  "user",
  "username",
  "someone",
  "anyone",
  "nobody",
  "asdf",
  "qwerty",
]);

const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "test.com",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "company.com",
]);

export interface DiscoveredContact {
  email: string;
  category: string;
  sourceUrl: string | null;
  rankScore: number;
  mxVerified: boolean | null;
}

export interface DiscoveredPhone {
  phone: string;
  sourceUrl: string | null;
}

export interface DiscoveryResult {
  contacts: DiscoveredContact[];
  phones: DiscoveredPhone[];
  /** The brand's contact page, when one was found or can be guessed,
   *  so the creator can reach out through the brand's form when no
   *  public email exists. */
  contactPageUrl: string | null;
}

// Common paths where a brand lists its contact / partnership details.
// Tried proactively when the official website is known, because the
// search results often do not include the contact page at all.
const CONTACT_PATHS = [
  "contact",
  "contact-us",
  "partnerships",
  "partners",
  "collaborate",
  "creators",
  "influencers",
  "about",
  "about-us",
];

// A phone number: it must start with + (international) or contain a
// separator (space, dash, dot or parentheses). A bare run of digits
// with no separator is almost never a phone number on a web page —
// it is an order id, a price, a count or a placeholder. 7-15 digits.
const PHONE_CANDIDATE_RE = /\+[\d\s().-]{6,}\d|\(?\d[\d\s().-]*\d[\s().-]\d[\d\s().-]*\d/g;

function cleanPhone(raw: string): string | null {
  const trimmed = raw.trim();
  // Keep a leading + and the digits only.
  const digits = trimmed.replace(/[^\d]/g, "");
  const plus = trimmed.startsWith("+");
  if (digits.length < 7 || digits.length > 15) return null;
  // Without a country code a phone number is at most 11 digits; a
  // longer bare run is an id, an order number or a timestamp.
  if (!plus && digits.length > 11) return null;
  // All the same digit (99999999) or a round count (100000000) is a
  // placeholder or a statistic, not a phone number.
  if (/^(\d)\1+$/.test(digits)) return null;
  if (/0{5,}$/.test(digits)) return null;
  // A date (20240403) is not a phone number.
  if (/^(19|20)\d{6}$/.test(digits)) return null;
  return plus ? `+${digits}` : digits;
}

function extractPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE_RE)) {
    const raw = m[0] ?? "";
    const cleaned = cleanPhone(raw);
    if (!cleaned) continue;
    // A well-formatted international number (+91 88007 78017) is a
    // phone by format alone. Anything else is only a phone number
    // when it sits next to a phone word (call, tel, mobile,
    // whatsapp, contact) — otherwise it is a price, a product code
    // or a count that happens to have separators.
    const wellFormatted = cleaned.startsWith("+") && /[\s().-]/.test(raw) && cleaned.length >= 11;
    if (wellFormatted) {
      out.push(cleaned);
      continue;
    }
    const start = Math.max(0, (m.index ?? 0) - 60);
    const end = Math.min(text.length, (m.index ?? 0) + raw.length + 60);
    const ctx = text.slice(start, end).toLowerCase();
    if (/phone|call|tel|mobile|whatsapp|contact|helpline|toll[\s-]?free/.test(ctx)) {
      out.push(cleaned);
    }
  }
  return out;
}

function cleanEmail(raw: string): string | null {
  let e = raw.trim().toLowerCase();
  // Strip trailing punctuation the regex may have caught.
  e = e.replace(/[.,;:!?)\]}>"']+$/, "");
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e)) return null;
  const [local, domain] = e.split("@");
  if (!local || !domain) return null;
  if (local.length > 64 || e.length > 254) return null;
  if (local.includes("..") || domain.includes("..")) return null;
  if (domain.startsWith("-") || domain.startsWith(".") || domain.endsWith("-")) return null;
  if (PLACEHOLDER_DOMAINS.has(domain)) return null;
  // Reject anything that looks like a file, image or version string.
  if (/\.(png|jpe?g|gif|webp|svg|css|js|pdf|zip|mp4|woff2?)$/i.test(domain)) return null;
  return e;
}

function localPart(email: string): string {
  return (email.split("@")[0] ?? "").toLowerCase();
}

function domainOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

function isExcluded(email: string): boolean {
  const local = localPart(email);
  if (PLACEHOLDER_LOCAL.has(local)) return true;
  return EXCLUDED_LOCAL.some(
    (bad) => local === bad || local.startsWith(`${bad}.`) || local.startsWith(`${bad}-`) || local.startsWith(`${bad}_`),
  );
}

/** Category label + base score from the local part. Higher is better. */
function categorizeLocal(email: string): { category: string; score: number } {
  const local = localPart(email);
  const has = (...words: string[]) =>
    words.some((w) => local.includes(w));
  if (has("influencer", "influencers", "creator", "creators", "partnership", "partnerships", "collab", "collaboration", "collaborations", "sponsor", "sponsors", "sponsorship", "brandambassador", "ambassador")) {
    return { category: "Influencer Partnerships", score: 30 };
  }
  if (has("affiliate", "affiliates")) {
    return { category: "Affiliate Partnerships", score: 15 };
  }
  if (has("marketing", "pr", "press", "media", "business", "bd", "bizdev", "growth", "outreach")) {
    return { category: "Marketing", score: 20 };
  }
  if (has("info", "hello", "contact", "team", "general", "enquiry", "inquiry")) {
    return { category: "General Contact", score: 10 };
  }
  // A named person (e.g. jane.smith) — a real person, but not a role
  // address. Kept, ranked low; the page it was found on may boost it.
  return { category: "Business Contact", score: 5 };
}

/** Bonus from the page the address was found on. */
function pageBonus(url: string | null, title: string | null): number {
  const hay = `${url ?? ""} ${title ?? ""}`.toLowerCase();
  if (/partner|creator|influencer|collab|sponsor/.test(hay)) return 10;
  if (/affiliate/.test(hay)) return 5;
  if (/contact|about|team/.test(hay)) return 5;
  return 0;
}

function extractFromText(text: string): string[] {
  return [...(text.match(EMAIL_RE) ?? [])]
    .map((e) => cleanEmail(e))
    .filter((e): e is string => e !== null);
}

function extractFromHtml(html: string): string[] {
  const found: string[] = [];
  // mailto: links first — a deliberate contact, not a stray mention.
  for (const m of html.matchAll(MAILTO_RE)) {
    const cleaned = cleanEmail(decodeURIComponent(m[1] ?? ""));
    if (cleaned) found.push(cleaned);
  }
  // Then any address in the visible text / markup.
  for (const e of extractFromText(html)) found.push(e);
  return found;
}

async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/html|text/.test(type)) return null;
    const text = await res.text();
    return text.slice(0, 500_000);
  } catch {
    return null;
  }
}

/** Best-effort MX check: true when the domain accepts mail, false
 *  when it definitively has no MX records, null when the lookup
 *  itself failed (unknown, not invalid). */
async function checkMx(domain: string): Promise<boolean | null> {
  try {
    const dns = await import("node:dns/promises");
    const recs = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("mx timeout")), 3000),
      ),
    ]);
    return Array.isArray(recs) && recs.length > 0;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "ENODATA" || code === "ENOTFOUND" || code === "ENOTIMP") return false;
    return null;
  }
}

/** Pick the candidate pages worth fetching: partnership / creator /
 *  contact pages first, then the official site, then the rest. */
function pickPages(
  pages: { url: string; title: string; content: string }[],
  website: string | null,
): { url: string; title: string; content: string }[] {
  const seen = new Set<string>();
  const deduped = pages.filter((p) => {
    if (!p.url || seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
  const score = (p: { url: string; title: string }) => {
    const hay = `${p.url} ${p.title}`.toLowerCase();
    let s = 0;
    if (/partner|creator|influencer|collab|sponsor/.test(hay)) s += 3;
    if (/contact|about/.test(hay)) s += 2;
    if (/affiliate/.test(hay)) s += 1;
    if (website && p.url.replace(/\/$/, "") === website.replace(/\/$/, "")) s += 1;
    return s;
  };
  return [...deduped].sort((a, b) => score(b) - score(a)).slice(0, 4);
}

/**
 * Discover a brand's publicly listed sponsorship contacts.
 * Returns every usable address found, ranked best-first, each with
 * its category, the page it came from, and an MX verdict; the phone
 * numbers found on the brand's pages; and the brand's contact page
 * URL when one was found or can be guessed. Excluded addresses
 * (support, billing, refunds, sales, personal) are dropped from the
 * returned list entirely.
 */
export async function discoverBrandEmails(input: {
  brandName: string;
  website: string | null;
  candidatePages: { url: string; title: string; content: string }[];
}): Promise<DiscoveryResult> {
  const { website, candidatePages } = input;

  // 1. Addresses already visible in the search snippets.
  const found = new Map<string, { sourceUrl: string | null; title: string | null; mailto: boolean }>();
  const add = (email: string, sourceUrl: string | null, title: string | null, mailto: boolean) => {
    const prev = found.get(email);
    if (!prev || (mailto && !prev.mailto)) {
      found.set(email, { sourceUrl, title, mailto });
    }
  };
  const phones = new Map<string, string | null>();
  const addPhone = (phone: string, sourceUrl: string | null) => {
    if (!phones.has(phone)) phones.set(phone, sourceUrl);
  };
  for (const p of candidatePages) {
    for (const e of extractFromText(p.content ?? "")) add(e, p.url, p.title, false);
    for (const ph of extractPhones(p.content ?? "")) addPhone(ph, p.url);
  }

  // 2. Fetch the most promising pages and scan them. The search
  // results often do not include the brand's contact page, so when
  // the official website is known, also try its common contact /
  // partnership paths directly — that is where the email usually is.
  // A contact page already present in the search results counts as
  // the contact page even if it cannot be fetched.
  let contactPageUrl: string | null = null;
  for (const p of candidatePages) {
    const hay = `${p.url} ${p.title}`.toLowerCase();
    if (!contactPageUrl && /contact|partner|creator|influencer|collab/.test(hay)) {
      contactPageUrl = p.url;
    }
  }
  const pages = pickPages(candidatePages, website);
  // Always include the official homepage itself when known.
  if (website && !pages.some((p) => p.url === website)) {
    pages.unshift({ url: website, title: "", content: "" });
  }
  // Proactive contact-page guesses (website + /contact, and so on).
  const base = website ? website.replace(/\/$/, "") : null;
  const guessed: { url: string; title: string; content: string }[] = [];
  if (base) {
    for (const path of CONTACT_PATHS) {
      const url = `${base}/${path}`;
      if (!pages.some((p) => p.url === url)) {
        guessed.push({ url, title: path, content: "" });
      }
    }
  }
  const toFetch = [...pages.slice(0, 4), ...guessed].slice(0, 8);
  const fetched = await Promise.allSettled(
    toFetch.map(async (p) => ({ page: p, html: await fetchPageText(p.url) })),
  );
  // The first contact-ish page that actually loaded, for the
  // "contact via their website" fallback link.
  for (const s of fetched) {
    if (s.status !== "fulfilled" || !s.value.html) continue;
    const { page, html } = s.value;
    const hay = `${page.url} ${page.title}`.toLowerCase();
    if (!contactPageUrl && /contact|partner|creator|influencer|collab/.test(hay)) {
      contactPageUrl = page.url;
    }
    const mailtos = new Set<string>();
    for (const m of html.matchAll(MAILTO_RE)) {
      const cleaned = cleanEmail(decodeURIComponent(m[1] ?? ""));
      if (cleaned) mailtos.add(cleaned);
    }
    for (const e of extractFromHtml(html)) {
      add(e, page.url, page.title, mailtos.has(e));
    }
    for (const ph of extractPhones(html)) addPhone(ph, page.url);
  }
  // No contact page was found in the results: guess the standard
  // /contact URL so the creator still has somewhere to go.
  if (!contactPageUrl && base) contactPageUrl = `${base}/contact`;

  // 3. Validate, categorize and score.
  const brandHost = website
    ? website.replace(/^https?:\/\//, "").split("/")[0].toLowerCase()
    : null;
  const scored: DiscoveredContact[] = [];
  for (const [email, meta] of found) {
    if (isExcluded(email)) continue;
    const { category, score: base } = categorizeLocal(email);
    let score = base + pageBonus(meta.sourceUrl, meta.title);
    if (meta.mailto) score += 3;
    const domain = domainOf(email);
    if (brandHost && domain === brandHost) score += 5;
    if (FREE_PROVIDERS.has(domain)) score -= 20;
    scored.push({ email, category, sourceUrl: meta.sourceUrl, rankScore: score, mxVerified: null });
  }
  scored.sort((a, b) => b.rankScore - a.rankScore);

  // 4. MX-check the top candidates (best-effort, in parallel).
  const toCheck = scored.slice(0, 6);
  const mx = await Promise.allSettled(
    toCheck.map(async (c) => ({ email: c.email, ok: await checkMx(domainOf(c.email)) })),
  );
  const mxByEmail = new Map<string, boolean | null>();
  for (const r of mx) {
    if (r.status === "fulfilled") mxByEmail.set(r.value.email, r.value.ok);
  }
  for (const c of scored) {
    if (mxByEmail.has(c.email)) c.mxVerified = mxByEmail.get(c.email) ?? null;
  }

  const phoneList: DiscoveredPhone[] = [...phones.entries()].map(([phone, sourceUrl]) => ({
    phone,
    sourceUrl,
  }));

  return { contacts: scored, phones: phoneList, contactPageUrl };
}

/** The single best contact to auto-fill: highest ranked, not
 *  excluded, not on a domain that definitively cannot receive mail,
 *  and with a meaningful positive score — a lone low-scoring address
 *  (e.g. a generic address on a free-mail domain) is not a good
 *  enough match to fill in on the creator's behalf. Returns null
 *  when nothing suitable exists. */
export function bestContact(contacts: DiscoveredContact[]): DiscoveredContact | null {
  const usable = contacts.filter(
    (c) => c.mxVerified !== false && c.rankScore >= 10,
  );
  return usable[0] ?? null;
}
