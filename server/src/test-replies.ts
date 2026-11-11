// Reply tracking tests — the safety and stage logic from the
// two-way email brief (Tests A–G), for the parts that do not need a
// live Gmail inbox or a live AI call. The AI classification itself
// (which category a real reply gets) is verified live on the site
// with a real brand reply; these tests pin the rules the AI output
// must pass through before anything changes a deal.
//
// Run: npx tsx server/src/test-replies.ts

import { encryptToken, decryptToken } from "./lib/crypto";
import { isRealAcceptance } from "./lib/replyAi";
import { stageForCategory } from "./lib/gmailSyncUser";
import { dealStageEnum } from "./actions/common";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} — ${detail}`);
  }
}

async function main() {
  // --- Crypto: the stored refresh token round-trips ---
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const secret = "1//0g-test-refresh-token-value";
  const blob = encryptToken(secret, key);
  check(
    "Crypto: encrypted token is not the plaintext",
    blob !== secret && !blob.includes(secret),
    blob.slice(0, 20),
  );
  check("Crypto: decrypt returns the original token", decryptToken(blob, key) === secret);
  const blob2 = encryptToken(secret, key);
  check("Crypto: same token encrypts differently each time (fresh IV)", blob2 !== blob);

  // --- Test A/B distinction: interest is NOT acceptance ---
  check(
    "A: 'interested' is never acceptance",
    isRealAcceptance("interested", null, 25000, "We are interested in working with you.") === false,
  );
  check(
    "A: 'interested' with a price is still not acceptance",
    isRealAcceptance("interested", 25000, 25000, "We are interested, is 25000 ok?") === false,
  );
  // --- Test B: clear acceptance with a stated price ---
  check(
    "B: 'accepting' with a stated price is acceptance",
    isRealAcceptance("accepting", 25000, 25000, "We approve the collaboration at 25000 for one dedicated video.") === true,
  );
  check(
    "B: 'accepting' confirming the creator's price is acceptance",
    isRealAcceptance("accepting", null, 25000, "We confirm and accept your rate of 25000.") === true,
  );
  check(
    "B: 'accepting' with no price and no confirmation is NOT acceptance",
    isRealAcceptance("accepting", null, 25000, "Sounds good, let's do it.") === false,
  );
  check(
    "B: 'accepting' with no agreed price and no stated price is NOT acceptance",
    isRealAcceptance("accepting", null, null, "We approve the collaboration.") === false,
  );
  // --- Test C: negotiation is not acceptance ---
  check(
    "C: 'negotiating' is never acceptance",
    isRealAcceptance("negotiating", 15000, 25000, "Can you do it for 15000?") === false,
  );

  // --- Stage mapping (Tests A–E) ---
  check(
    "A: interested reply moves Pitched -> Reply Received",
    stageForCategory("interested", "pitched") === "reply_received",
  );
  check(
    "A: interested reply does not move a deal already past Pitched",
    stageForCategory("interested", "negotiating") === null,
  );
  check(
    "C: negotiating reply moves the deal to Negotiating",
    stageForCategory("negotiating", "pitched") === "negotiating",
  );
  check(
    "B: accepting reply does NOT auto-move the deal (creator approves)",
    stageForCategory("accepting", "reply_received") === null,
  );
  check(
    "B: confirming terms does NOT auto-move the deal",
    stageForCategory("confirming_terms", "negotiating") === null,
  );
  check(
    "Rejecting reply moves the deal to Lost",
    stageForCategory("rejecting", "pitched") === "lost",
  );
  check(
    "Automated reply never moves a deal",
    stageForCategory("automated", "pitched") === null,
  );
  check(
    "Unrelated mail never moves a deal",
    stageForCategory("unrelated", "pitched") === null,
  );

  // --- The 11-stage pipeline ---
  const stages = dealStageEnum.options;
  const stageList: string[] = [...stages];
  check(
    "Pipeline has the 11 stages (Reply Received, Content in Production, Content Submitted included)",
    stageList.length === 11 &&
      stageList.includes("reply_received") &&
      stageList.includes("content_production") &&
      stageList.includes("content_submitted") &&
      !stageList.includes("content_live"),
    JSON.stringify(stageList),
  );

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
