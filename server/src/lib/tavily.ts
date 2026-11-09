// Tavily Search API — the standalone replacement for Muse's live web
// search in discoverBrands. Tavily (unlike Brave) permits storing the
// returned results, which is what the distillation step needs.

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export async function searchTavily(
  apiKey: string,
  query: string,
): Promise<TavilyResult[]> {
  if (!apiKey) {
    throw new Error(
      "Brand search isn't configured yet. Try again once search is set up.",
    );
  }
  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 10,
      }),
      signal: AbortSignal.timeout(30000),
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
      content?: string;
      snippet?: string;
    }[];
  };
  return (payload.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? r.snippet ?? "",
  }));
}
