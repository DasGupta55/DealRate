// HTTP router — the single entry point for every /api/* request.
//
// Wire protocol: POST {origin}/api/<actionName>, JSON body = the action's
// args, header `Authorization: Bearer <supabase access token>` when signed
// in. Response = the action's JSON result. Error = HTTP 400/401/403/500
// with body {error: "<message>"} — never a stack trace.
// Also: POST /api/webhooks/razorpay (raw body + X-Razorpay-Signature) and
// POST /api/cron/overdue (header x-cron-secret must equal CRON_SECRET).
//
// CORS: allow the request origin if it equals PUBLIC_URL or is localhost
// (dev); always allow same-origin. No credentials mode is needed beyond
// the Authorization header.

import { ZodError } from "zod";
import { Actions, ActionSchemas } from "./actions";
import { handleRazorpayWebhookRequest } from "./webhook";
import { handleCronRequest, handleGmailSyncRequest } from "./cron";
import { loadEnv, type Env } from "./lib/env";
import { createServiceClient, type ActionCtx } from "./lib/db";
import { HttpError } from "./lib/errors";

function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  if (env.publicUrl && origin === env.publicUrl.replace(/\/+$/, "")) {
    return origin;
  }
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = allowedOrigin(origin, env);
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  env: Env,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, env),
    },
  });
}

export async function handleApiRequest(req: Request): Promise<Response> {
  const env = loadEnv();
  const url = new URL(req.url);
  const pathname = url.pathname;
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin, env),
    });
  }

  try {
    if (pathname === "/api/webhooks/razorpay") {
      return await handleRazorpayWebhookRequest(req);
    }
    if (pathname === "/api/cron/overdue") {
      return await handleCronRequest(req);
    }
    if (pathname === "/api/cron/gmail-sync") {
      return await handleGmailSyncRequest(req);
    }
    const match = pathname.match(/^\/api\/([A-Za-z0-9]+)$/);
    if (!match) {
      return json({ error: "Not found" }, 404, origin, env);
    }
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin, env);
    }
    const name = match[1] as string;
    const handler = Actions[name];
    const schema = ActionSchemas[name];
    if (!handler || !schema) {
      return json({ error: `Unknown action: ${name}` }, 404, origin, env);
    }

    let body: unknown = {};
    const text = await req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Invalid JSON body." }, 400, origin, env);
      }
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json(
        { error: "Request body must be a JSON object." },
        400,
        origin,
        env,
      );
    }
    const record = body as Record<string, unknown>;

    // Token: Authorization Bearer header first, fall back to
    // args.accessToken (the source's convention).
    const authHeader = req.headers.get("authorization");
    const bearer =
      authHeader?.startsWith("Bearer ") && authHeader.slice(7).trim()
        ? authHeader.slice(7).trim()
        : undefined;
    const accessToken =
      bearer ??
      (typeof record.accessToken === "string" ? record.accessToken : undefined);

    let args: unknown;
    try {
      args = schema.parse({ ...record, accessToken });
    } catch (e) {
      if (e instanceof ZodError) {
        const first = e.issues[0];
        return json(
          { error: first?.message ?? "Invalid request." },
          400,
          origin,
          env,
        );
      }
      throw e;
    }

    const ctx: ActionCtx = {
      db: createServiceClient(env),
      env,
      accessToken,
    };
    const result = await handler(ctx, args);
    return json(result ?? {}, 200, origin, env);
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message }, e.status, origin, env);
    }
    if (e instanceof Error) {
      return json(
        { error: e.message || "Something went wrong." },
        500,
        origin,
        env,
      );
    }
    return json({ error: "Something went wrong." }, 500, origin, env);
  }
}
