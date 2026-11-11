// Verification for the brand email discovery + pitch price fixes.
// Run: npx tsx server/src/test-verify.ts  (from public-website/)
import { pitchFeeText, pitchFeeForms } from "./actions/deals";
import { discoverBrandEmails, bestContact } from "./lib/brandEmail";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // --- Test A: creator enters 25,000 ---
  const feeA = pitchFeeText(25000);
  check("A: fee for 25000 is '25,000'", feeA === "25,000", `got ${feeA}`);
  check("A: no USD in fee", feeA !== null && !/usd|\$/i.test(feeA), `got ${feeA}`);
  check(
    "A: gate accepts '25,000' or '25000'",
    pitchFeeForms(25000).includes("25,000") && pitchFeeForms(25000).includes("25000"),
    `got ${JSON.stringify(pitchFeeForms(25000))}`,
  );

  // --- Test B: creator enters 50,000 (previous amount not reused) ---
  const feeB = pitchFeeText(50000);
  check("B: fee for 50000 is '50,000'", feeB === "50,000", `got ${feeB}`);
  check("B: 50000 does not reuse 25000", feeB !== "25,000" && feeB !== "25000");

  // --- Test C: no price entered ---
  check("C: no price -> fee null (available on request)", pitchFeeText(null) === null);
  check("C: no price -> no fee forms", pitchFeeForms(null).length === 0);
  check("C: zero price -> fee null", pitchFeeText(0) === null);

  // --- Test D: multiple brand emails, rank influencers first ---
  const found = await discoverBrandEmails({
    brandName: "Example",
    website: null,
    candidatePages: [
      {
        url: "https://acmebrand.com/contact",
        title: "Contact Example",
        content:
          "Reach us at support@acmebrand.com or marketing@acmebrand.com. Creators write to influencers@acmebrand.com. Billing queries: billing@acmebrand.com.",
      },
    ],
  });
  const emails = found.map((c) => c.email);
  check(
    "D: support and billing are excluded",
    !emails.includes("support@acmebrand.com") && !emails.includes("billing@acmebrand.com"),
    `got ${JSON.stringify(emails)}`,
  );
  const best = bestContact(found);
  check(
    "D: best contact is influencers@acmebrand.com",
    best?.email === "influencers@acmebrand.com",
    `got ${best?.email}`,
  );
  check(
    "D: best category is Influencer Partnerships",
    best?.category === "Influencer Partnerships",
    `got ${best?.category}`,
  );
  check(
    "D: best has a source URL",
    typeof best?.sourceUrl === "string" && (best?.sourceUrl ?? "").includes("acmebrand.com"),
    `got ${best?.sourceUrl}`,
  );
  check(
    "D: marketing is ranked below influencers",
    (found.findIndex((c) => c.email === "marketing@acmebrand.com") ?? -1) >
      (found.findIndex((c) => c.email === "influencers@acmebrand.com") ?? -1),
    `order: ${JSON.stringify(emails)}`,
  );

  // --- Test E: no email anywhere ---
  const none = await discoverBrandEmails({
    brandName: "NoMailBrand",
    website: null,
    candidatePages: [],
  });
  check("E: no emails -> empty list", none.length === 0, `got ${none.length}`);
  check("E: no emails -> no best contact", bestContact(none) === null);

  // --- Ranking: partnership page boosts a generic address ---
  const boosted = await discoverBrandEmails({
    brandName: "Boost",
    website: null,
    candidatePages: [
      {
        url: "https://boost.example/creator-partnerships",
        title: "Creator Partnerships",
        content: "Write to hello@boost.example to collaborate.",
      },
      {
        url: "https://boost.example/about",
        title: "About",
        content: "General enquiries: info@boost.example.",
      },
    ],
  });
  check(
    "Ranking: hello@ on a partnerships page outranks generic info@",
    bestContact(boosted)?.email === "hello@boost.example",
    `got ${bestContact(boosted)?.email}`,
  );

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("test error", e);
  process.exit(1);
});
