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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleCronRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const env = loadEnv();
  const secret = req.headers.get("x-cron-secret");
  if (!env.cronSecret || !secret || secret !== env.cronSecret) {
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
