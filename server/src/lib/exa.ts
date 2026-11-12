// Exa Search API — backup web discovery for the Brand Finder.
// Used only when Tavily fails (credits out, outage, or error).
// Returns the same result shape as Tavily (title / url / content)
// so callers do not change; Exa's `text` field is the snippet.
//
// Exa docs: POST https://api.exa.ai/search, header `x-api-key`,
// body { query, numResults, type }. `type: "auto"` lets Exa pick
// neural or keyword search per query.

import type { TavilyResult } from "./tavily";

export async function searchExa(
  apiKey: string,
  query: string,
): Promise<TavilyResult[]> {
  if (!apiKey) {
    throw new Error(
      "Brand search is unavailable right now. Try again in a moment.",
    );
  }
  let res: Response;
  try {
    res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        query,
        numResults: 10,
        type: "auto",
        // Without `contents.text` Exa returns an empty `text` field;
        // the distillation needs the snippet, so request it.
        contents: { text: true },
      }),
      // Same 8s budget as Tavily: a slow backup must fail fast, not
      // eat the whole function budget.
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(
      "Brand search is unavailable right now. Try again in a moment.",
    );
  }
  if (!res.ok) {
    throw new Error(
      "Brand search is unavailable right now. Try again in a moment.",
    );
  }
  const payload = (await res.json()) as {
    results?: {
      title?: string;
      url?: string;
      text?: string;
      snippet?: string;
    }[];
  };
  return (payload.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.text ?? r.snippet ?? "",
  }));
}
