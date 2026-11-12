// Web search with a backup — Tavily first, Exa when Tavily fails.
//
// Tavily is the primary discovery API for the Brand Finder. When it
// fails (credits exhausted, outage, or any error) and an Exa key is
// configured, the same query is retried against Exa so the search
// still completes. Exa is never the first choice: it only runs on a
// Tavily failure, so it costs nothing on a normal day. When Exa is
// not configured (or also fails), the original Tavily error is
// re-thrown so the caller sees the real failure.

import type { Env } from "./env";
import { searchExa } from "./exa";
import { searchTavily, type TavilyResult } from "./tavily";

export async function searchWeb(
  env: Env,
  query: string,
): Promise<TavilyResult[]> {
  try {
    return await searchTavily(env.tavilyApiKey ?? "", query);
  } catch (tavilyErr) {
    if (!env.exaApiKey) throw tavilyErr;
    console.log(
      `[search] tavily failed, falling back to exa query="${query}"`,
    );
    return await searchExa(env.exaApiKey, query);
  }
}
