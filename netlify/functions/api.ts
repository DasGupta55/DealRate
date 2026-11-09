// Netlify adapter — the ONE function that serves /api/*, the webhook and
// the cron (netlify.toml redirects /api/* to it; the deploy-config agent
// writes netlify.toml). It builds a Web Request from the Netlify event
// (method, path, headers, body — honouring event.isBase64Encoded), calls
// handleApiRequest, and returns { statusCode, headers, body }.

import { handleApiRequest } from "../../server/src/router";

export const handler = async (event: any): Promise<any> => {
  const rawUrl = event.rawUrl as string | undefined;
  const host =
    event.headers?.host ?? event.headers?.Host ?? "localhost";
  const url = rawUrl ?? `https://${host}${event.path ?? "/api"}`;

  const headers = new Headers();
  const rawHeaders = (event.headers ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value === "string") headers.set(key, value);
  }

  let body: BodyInit | undefined;
  if (event.body) {
    body = event.isBase64Encoded
      ? Buffer.from(event.body as string, "base64")
      : (event.body as string);
  }
  const method = (event.httpMethod ?? "GET") as string;
  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = body;
  }

  const res = await handleApiRequest(new Request(url, init));
  const text = await res.text();
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  return { statusCode: res.status, headers: outHeaders, body: text };
};
