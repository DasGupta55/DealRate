// Daily overdue cron — POST /api/cron/overdue.
//
// Protected by a shared secret: header `x-cron-secret` must equal
// CRON_SECRET (and CRON_SECRET must be set). Anything else gets 401 and
// nothing runs. On success it runs the same checkOverdueInvoices logic
// with no user scope (checks everyone's sent/overdue invoices, flags the
// past-due ones, saves at most one reminder draft per invoice per 7 days).
// Drafts only — nothing is sent.

import { loadEnv } from "./lib/env";
import { createServiceClient } from "./lib/db";
import { runOverdueCheck } from "./actions/invoices";
import { runGmailSync } from "./lib/gmailSync";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireCronSecret(req: Request, env: ReturnType<typeof loadEnv>): boolean {
  const secret = req.headers.get("x-cron-secret");
  return Boolean(env.cronSecret && secret && secret === env.cronSecret);
}

export async function handleCronRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const env = loadEnv();
  if (!requireCronSecret(req, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const db = createServiceClient(env);
    if (!db) {
      return json({ error: "The database is not configured yet." }, 500);
    }
    const result = await runOverdueCheck(db, null);
    return json(result, 200);
  } catch (e) {
    if (e instanceof Error) {
      return json({ error: e.message || "Something went wrong." }, 500);
    }
    return json({ error: "Something went wrong." }, 500);
  }
}

// Gmail reply sync cron — POST /api/cron/gmail-sync.
//
// Same shared-secret protection as the overdue cron. On success it
// runs the reply sync for every creator who connected Gmail for
// reply tracking: refresh each stored token, check their deals for
// brand replies, classify them, save them, notify and move stages.
// Nothing is sent and nothing is auto-approved here.
export async function handleGmailSyncRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const env = loadEnv();
  if (!requireCronSecret(req, env)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    const db = createServiceClient(env);
    if (!db) {
      return json({ error: "The database is not configured yet." }, 500);
    }
    const result = await runGmailSync(db, env);
    return json(result, 200);
  } catch (e) {
    if (e instanceof Error) {
      return json({ error: e.message || "Something went wrong." }, 500);
    }
    return json({ error: "Something went wrong." }, 500);
  }
}
