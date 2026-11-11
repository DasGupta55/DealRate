// Typed environment readers — DealRate standalone server.
//
// Every secret/config value comes from process.env. No real defaults and
// no secret value is ever hardcoded here; only the variable NAMES are
// referenced. `loadEnv()` is called fresh per request so a redeploy (or a
// Netlify env change) is picked up without a code change.

export interface Env {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  youtubeApiKey?: string;
  tavilyApiKey?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  publicUrl?: string;
  cronSecret?: string;
}

/** The Supabase project URL used when the settings row has none stored. */
export const DEFAULT_SUPABASE_URL =
  "https://athtnktzxtmtaquvpmvl.supabase.co";

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function loadEnv(): Env {
  const e = process.env;
  return {
    supabaseUrl: clean(e.SUPABASE_URL),
    supabaseAnonKey: clean(e.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: clean(e.SUPABASE_SERVICE_ROLE_KEY),
    youtubeApiKey: clean(e.YOUTUBE_API_KEY),
    tavilyApiKey: clean(e.TAVILY_API_KEY),
    groqApiKey: clean(e.GROQ_API_KEY),
    geminiApiKey: clean(e.GEMINI_API_KEY),
    razorpayKeyId: clean(e.RAZORPAY_KEY_ID),
    razorpayKeySecret: clean(e.RAZORPAY_KEY_SECRET),
    razorpayWebhookSecret: clean(e.RAZORPAY_WEBHOOK_SECRET),
    publicUrl: clean(e.PUBLIC_URL),
    cronSecret: clean(e.CRON_SECRET),
  };
}
