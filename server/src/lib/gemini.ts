// Gemini chat (Google AI Studio REST API) — the fallback AI provider
// for DealRate when Groq is unavailable, rate-limited, or returns an
// error. Same interface as the Groq helper so the fallback wrapper
// can swap providers without changing callers.
//
// Model: gemini-3-flash-preview (verified 2026-11-11). Older names
// (gemini-2.0-flash, gemini-2.5-flash) return 404 for a newly created
// key, and some names hang instead of erroring, so use this exact
// model. The key is passed as the `key` query parameter, which is
// where the Gemini API reads it. The reply is requested as JSON.

const MODEL = "gemini-3-flash-preview";
const MAX_TOKENS = 1200;

export async function chatGemini(
  apiKey: string,
  system: string,
  prompt: string,
  opts?: { maxTokens?: number },
): Promise<string> {
  if (!apiKey) {
    throw new Error("AI generation isn't configured yet.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: opts?.maxTokens ?? MAX_TOKENS,
        },
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
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text.trim()) {
    throw new Error("AI generation returned an empty reply.");
  }
  return text;
}

/** Ask for a single JSON object and parse it. Throws on any failure so
 *  callers can run their template/source fallback. */
export async function chatGeminiJson<T>(
  apiKey: string,
  system: string,
  prompt: string,
  opts?: { maxTokens?: number },
): Promise<T> {
  const text = await chatGemini(apiKey, system, prompt, { maxTokens: opts?.maxTokens });
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
