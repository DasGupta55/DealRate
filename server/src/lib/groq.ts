// Groq chat completions (OpenAI-compatible API) — the standalone
// replacement for the runtime's structured-output inference in
// discoverBrands and generatePitch.
//
// Model: openai/gpt-oss-120b. It spends several hundred tokens reasoning
// first, so max_tokens is 1200 — with a small limit it returns empty text.
// Headers MUST include a browser User-Agent (plus Accept) or Groq returns
// 403 error 1010. The visible reply is in choices[0].message.content.

const MODEL = "openai/gpt-oss-120b";
const MAX_TOKENS = 1200;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function chatGroq(
  apiKey: string,
  system: string,
  prompt: string,
  opts?: { json?: boolean },
): Promise<string> {
  if (!apiKey) {
    throw new Error("AI generation isn't configured yet.");
  }
  let res: Response;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        ...(opts?.json
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error("AI generation is unavailable right now. Try again.");
  }
  if (!res.ok) {
    throw new Error("AI generation is unavailable right now. Try again.");
  }
  const payload = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error("AI generation returned an empty reply.");
  }
  return text;
}

/** Ask for a single JSON object and parse it. Throws on any failure so
 *  callers can run their template/source fallback. */
export async function chatGroqJson<T>(
  apiKey: string,
  system: string,
  prompt: string,
): Promise<T> {
  const text = await chatGroq(apiKey, system, prompt, { json: true });
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("AI generation returned text that isn't JSON.");
  }
}
