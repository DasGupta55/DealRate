// Build the sponsorship distillation prompt from realistic sample
// search results (Technology + India), and print it so it can be
// run against the live AI. The samples cover the brief's key cases:
// a brand with paid Indian-creator evidence, a US brand that
// sponsored Indian YouTubers (Test E), a company with no paid
// evidence (Test F), a Business Insider article (Test G), and an
// influencer agency (Test G).
//
// Run: npx tsx server/src/test-distill-prompt.ts > /tmp/distill-prompt.txt

import { buildDistillPrompt, DISTILL_SYSTEM } from "./lib/sponsorship";

const SAMPLE_RESULTS = [
  {
    title: "boAt sponsors Technical Guruji — paid collaboration",
    url: "https://www.youtube.com/watch?v=example-boat-tg",
    content:
      "Technical Guruji uploaded a sponsored video for boAt in March 2025, a paid partnership promoting boAt's new earbuds to his Indian audience. The video is marked as a paid promotion.",
  },
  {
    title: "boAt creator partnership program",
    url: "https://www.boat-lifestyle.com/pages/creator-program",
    content:
      "boAt runs a creator program for Indian creators. Creators can apply to collaborate on product launches and are paid for sponsored content.",
  },
  {
    title: "NordVPN sponsors Indian YouTubers",
    url: "https://www.youtube.com/watch?v=example-nordvpn-india",
    content:
      "NordVPN, a US-based company, sponsored several Indian tech YouTubers in 2025, including paid dedicated videos promoting NordVPN to Indian audiences.",
  },
  {
    title: "Noise — smart wearables brand India",
    url: "https://www.gonoise.com",
    content:
      "Noise is an Indian smart wearable brand selling smartwatches and earbuds in India. It runs marketing campaigns and works with influencers.",
  },
  {
    title: "Business Insider: The rising stars of influencer marketing",
    url: "https://www.businessinsider.com/rising-stars-influencer-marketing-2025",
    content:
      "Business Insider profiles the top creators and agencies shaping influencer marketing, including several Indian creators and the agencies that represent them.",
  },
  {
    title: "Chtrbox — influencer marketing platform India",
    url: "https://www.chtrbox.com",
    content:
      "Chtrbox is an influencer marketing platform and agency in India that connects brands with creators for paid campaigns.",
  },
  {
    title: "Samsung India creator program",
    url: "https://www.samsung.com/in/creators",
    content:
      "Samsung India invites creators to join its creator program and collaborate on Galaxy product launches.",
  },
];

console.log("=== SYSTEM ===");
console.log(DISTILL_SYSTEM);
console.log("\n=== USER ===");
console.log(buildDistillPrompt("Technology", "India", SAMPLE_RESULTS));
