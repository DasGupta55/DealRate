// AI provider fallback — one entry point for every JSON AI call in
// DealRate. Groq is tried first (fast, and the pitches already read
// well). If Groq fails for any reason — quota, outage, bad reply —
// Gemini is tried automatically, with no user action. Only when both
// fail does the call throw, so callers can run their template or
// source fallback. The app never dies because one provider is down.

import type { Env } from "./env";
import { chatGeminiJson } from "./gemini";
import { chatGroqJson } from "./groq";

export async function chatAiJson<T>(
  env: Env,
  system: string,
  prompt: string,
  opts?: { maxTokens?: number },
): Promise<T> {
  const groqKey = env.groqApiKey ?? "";
  const geminiKey = env.geminiApiKey ?? "";
  try {
    return await chatGroqJson<T>(groqKey, system, prompt, { maxTokens: opts?.maxTokens });
  } catch (groqErr) {
    if (!geminiKey) throw groqErr;
    return await chatGeminiJson<T>(geminiKey, system, prompt, { maxTokens: opts?.maxTokens });
  }
}
