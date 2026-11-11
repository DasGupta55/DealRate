// Global Brand Finder tests — the pure logic behind the
// sponsorship discovery (Tests F, G, H from the brief), for the
// parts that do not need a live search API or a live AI call.
// The AI distillation itself (which category a real result gets)
// is verified separately with the live AI on realistic sample
// results; these tests pin the rules that hold regardless of
// what the AI returns.
//
// Run: npx tsx server/src/test-sponsorship.ts

import {
  CLASSIFICATION_RANK,
  isNonBrand,
  sponsorshipQueries,
} from "./lib/sponsorship";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

function main() {
  // --- Test H: the country genuinely changes the search ---
  const india = sponsorshipQueries("Technology", "India");
  const us = sponsorshipQueries("Technology", "United States");
  check(
    "H: three search angles are used",
    india.length === 3,
    JSON.stringify(india),
  );
  check(
    "H: every query names the selected market (India)",
    india.every((q) => q.includes("India")),
    JSON.stringify(india),
  );
  check(
    "H: switching to United States changes every query",
    us.every((q) => q.includes("United States") && !q.includes("India")),
    JSON.stringify(us),
  );
  check(
    "H: the queries cover paid evidence, programs, and campaigns",
    india[0].toLowerCase().includes("paid") &&
      india[1].toLowerCase().includes("partnership program") &&
      india[2].toLowerCase().includes("campaign"),
    JSON.stringify(india),
  );
  const beauty = sponsorshipQueries("Beauty", "India");
  check(
    "H: the niche changes the query too",
    beauty.every((q) => q.includes("Beauty")),
    JSON.stringify(beauty),
  );

  // --- Test G: articles, publications and listicles are not brands ---
  check(
    "G: a Business Insider article is not a brand",
    isNonBrand("Business Insider", "https://www.businessinsider.com/influencer-marketing") === true,
  );
  check(
    "G: a 'Top 10' listicle is not a brand",
    isNonBrand("Top 10 influencer marketing agencies in India", "https://example.com/top-10") === true,
  );
  check(
    "G: a publication name is not a brand",
    isNonBrand("Forbes", "https://www.forbes.com/sites/example") === true,
  );
  check(
    "G: a real brand passes the filter",
    isNonBrand("boAt", "https://www.boat-lifestyle.com") === false,
  );
  check(
    "G: a real brand with a 'best' in its name is not blocked by the word alone",
    isNonBrand("Best Buy", "https://www.bestbuy.com") === false,
  );

  // --- Ranking: verified paid outranks everything else ---
  const ranks = [
    CLASSIFICATION_RANK.verified_paid,
    CLASSIFICATION_RANK.active_program,
    CLASSIFICATION_RANK.international_paid,
    CLASSIFICATION_RANK.potential,
    CLASSIFICATION_RANK.affiliate_only,
  ];
  check(
    "Ranking: verified_paid < active_program < international_paid < potential < affiliate_only",
    ranks.every((r, i) => i === 0 || r > ranks[i - 1]),
    JSON.stringify(ranks),
  );

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
