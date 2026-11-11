// Gmail API send — one-click sending from the creator's own Gmail.
//
// The creator signs in with Google via Supabase using only the basic
// profile scopes (openid / email / profile), so sign-in never shows
// the unverified-app warning. The gmail.send scope is granted
// incrementally, only when the creator taps Send: the client re-runs
// Google sign-in asking for gmail.send on top, and the Supabase
// session then carries a Google access token (provider_token) with
// that scope. The client passes that token to the server on send; the
// server calls the Gmail API with it. No new env vars, no stored
// tokens: the token is only ever used to send the exact email the
// signed-in creator requested, to the brand on their own
// deal/invoice. A token without the scope gets the distinct
// gmail_scope_missing status (see gmailAuthResult) so the client can
// offer the one-tap grant button instead of a generic re-sign-in.
//
// Headers MUST include a browser User-Agent (plus Accept) or Google's
// API front door can reject the request the same way Groq did (403
// error 1010) — see server/src/lib/groq.ts for the same pattern.
//
// The token is verified against Google's userinfo endpoint (not the
// Gmail profile endpoint): userinfo works with the openid/email scopes
// the sign-in token always has, while the Gmail profile endpoint can
// reject a token that only carries gmail.send — which made every send
// fail with a generic "sign in again" even after the scope was granted.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const USERINFO_API = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GmailMessage {
  to: string;
  subject: string;
  body: string;
}

/** True when an error came from Google with a 401/403 — the token is
 *  expired, invalid, or missing the gmail.send scope. Callers map
 *  these to a "sign in again" status instead of a generic error. */
export function isGmailAuthError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.startsWith("gmail_401") ||
      err.message.startsWith("gmail_403"))
  );
}

/** True when Google refused because the token does not carry the
 *  gmail.send scope ("insufficient authentication scopes"). This is
 *  the normal state before the creator grants email permission on
 *  demand — not an expired token and not a broken sign-in. */
export function isGmailScopeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /insufficient authentication scopes|insufficient.*scope/i.test(err.message)
  );
}

// Read Google's own error text (e.g. "API not enabled" vs
// "insufficient authentication scopes") so a failed send can say WHY
// instead of a generic "sign in again". Best effort — never throws.
async function googleDetail(res: Response): Promise<string> {
  try {
    const payload = (await res.clone().json()) as {
      error?: { message?: string; status?: string };
      error_description?: string;
    };
    return (
      payload.error?.message ??
      payload.error?.status ??
      payload.error_description ??
      ""
    );
  } catch {
    return "";
  }
}

async function gmailError(res: Response, fallback: string): Promise<Error> {
  const detail = await googleDetail(res);
  const why = detail ? ` — ${detail}` : "";
  return new Error(`gmail_${res.status}: ${fallback}${why} (HTTP ${res.status})`);
}

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Send one plain-text email from the Gmail account the access token
 *  belongs to. Returns the Gmail message id and thread id — the
 *  thread id is what the reply sync uses to find the brand's answer.
 *  Throws an Error whose message starts with gmail_401 / gmail_403 /
 *  gmail_error. */
export async function sendGmailMessage(
  accessToken: string,
  msg: GmailMessage,
): Promise<{ messageId: string; threadId: string | null }> {
  const raw = [
    `To: ${msg.to}`,
    `Subject: ${msg.subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    msg.body,
  ].join("\r\n");
  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ raw: toBase64Url(raw) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("gmail_error: Gmail is unavailable right now. Try again.");
  }
  if (!res.ok) throw await gmailError(res, "Gmail send failed");
  const payload = (await res.json()) as { id?: string; threadId?: string };
  if (!payload.id)
    throw new Error("gmail_error: Gmail send returned no message id");
  return { messageId: payload.id, threadId: payload.threadId ?? null };
}

// ------------------------------------------------------------------
// Reading mail (reply tracking). These need the gmail.readonly scope,
// granted separately from gmail.send. They are used by the scheduled
// sync (server-held refresh token) and by a manual sync with the
// creator's session token. Nothing here marks mail read or moves it.
// ------------------------------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageFull {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string | null;
  snippet: string;
  bodyText: string;
}

/** Exchange a Google refresh token for a fresh access token. Throws
 *  gmail_401 when the refresh token is revoked or expired (the
 *  creator must reconnect Gmail); gmail_error on a network failure.
 *  The Google OAuth client id/secret are the same ones Supabase uses
 *  for Google sign-in, so they come from env vars the owner already
 *  set for sign-in (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). When
 *  they are absent the sync cannot refresh and reports it plainly. */
export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<string> {
  if (!clientId || !clientSecret) {
    throw new Error(
      "gmail_error: Google sign-in credentials are not configured on the server, so the reply sync cannot refresh its Gmail access. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to Netlify env vars.",
    );
  }
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("gmail_error: Google is unavailable right now. Try again.");
  }
  if (!res.ok) {
    const detail = await googleDetail(res);
    if (res.status === 400 && /invalid_grant/i.test(detail)) {
      throw new Error(
        "gmail_401: Gmail permission was revoked or expired — the creator needs to reconnect Gmail.",
      );
    }
    throw new Error(`gmail_${res.status}: Google token refresh failed${detail ? ` — ${detail}` : ""}`);
  }
  const payload = (await res.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("gmail_error: Google token refresh returned no access token");
  }
  return payload.access_token;
}

function headerValue(headers: GmailHeader[], name: string): string {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBodyPart(part: {
  mimeType?: string;
  body?: { data?: string };
  parts?: unknown[];
}): string {
  const data = part.body?.data;
  if (data && /text\/plain/i.test(part.mimeType ?? "")) {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts as { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[]) {
      const text = decodeBodyPart(sub);
      if (text) return text;
    }
  }
  return "";
}

/** Fetch one message's headers and plain-text body. */
export async function getGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageFull> {
  let res: Response;
  try {
    res = await fetch(
      `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw new Error("gmail_error: Gmail is unavailable right now. Try again.");
  }
  if (!res.ok) throw await gmailError(res, "Gmail message read failed");
  const payload = (await res.json()) as {
    id?: string;
    threadId?: string;
    snippet?: string;
    payload?: { headers?: GmailHeader[]; body?: { data?: string }; parts?: unknown[]; mimeType?: string };
    internalDate?: string;
  };
  const headers = payload.payload?.headers ?? [];
  let bodyText = "";
  if (payload.payload) {
    bodyText = decodeBodyPart(
      payload.payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] },
    );
    if (!bodyText && payload.payload.body?.data) {
      bodyText = Buffer.from(
        payload.payload.body.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8");
    }
  }
  const ms = payload.internalDate ? Number(payload.internalDate) : NaN;
  return {
    id: payload.id ?? messageId,
    threadId: payload.threadId ?? "",
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject"),
    date: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    snippet: payload.snippet ?? "",
    bodyText: bodyText.trim(),
  };
}

/** List the message ids in one Gmail thread (the pitch and its
 *  replies), oldest first. */
export async function listThreadMessageIds(
  accessToken: string,
  threadId: string,
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(
      `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=minimal`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw new Error("gmail_error: Gmail is unavailable right now. Try again.");
  }
  if (!res.ok) throw await gmailError(res, "Gmail thread read failed");
  const payload = (await res.json()) as { messages?: { id?: string }[] };
  return (payload.messages ?? []).map((m) => m.id ?? "").filter(Boolean);
}

/** Search the inbox for messages matching a Gmail search query
 *  (e.g. `from:brand@example.com`). Returns message ids, newest
 *  first, up to maxResults. */
export async function searchGmailMessageIds(
  accessToken: string,
  query: string,
  maxResults = 20,
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(
      `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw new Error("gmail_error: Gmail is unavailable right now. Try again.");
  }
  if (!res.ok) throw await gmailError(res, "Gmail search failed");
  const payload = (await res.json()) as { messages?: { id?: string }[] };
  return (payload.messages ?? []).map((m) => m.id ?? "").filter(Boolean);
}

/** User-facing message for a Gmail auth failure, naming the actual
 *  cause when Google told us: an API that is not switched on in the
 *  token's Google Cloud project, a token without the gmail.send
 *  scope, or an expired token. Falls back to the re-sign-in line. */
export function gmailAuthMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : "";
  if (/not been used|has not been used|is disabled|API .* not enabled/i.test(text)) {
    return "Gmail API is not switched on for this Google project — enable it in Google Cloud Console (APIs & Services → Library → Gmail API), then try sending again.";
  }
  if (/insufficient authentication scopes|insufficient.*scope/i.test(text)) {
    return "Email permission not granted yet — tap 'Allow Gmail sending' to let DealRate send from your Gmail, then tap Send again.";
  }
  return "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.";
}

/** Map a Gmail auth failure to the send-result status + message. A
 *  missing gmail.send scope gets its own status so the client can
 *  offer the one-tap grant button instead of a generic re-sign-in. */
export function gmailAuthResult(err: unknown): { status: string; message: string } {
  if (isGmailScopeError(err)) {
    return {
      status: "gmail_scope_missing",
      message: "Email permission not granted yet — tap 'Allow Gmail sending' below to let DealRate send from your Gmail, then tap Send again.",
    };
  }
  return { status: "gmail_auth_failed", message: gmailAuthMessage(err) };
}

/** The Google account email the access token belongs to, via the
 *  userinfo endpoint. Used to verify the token matches the signed-in
 *  account before anything is sent with it. Works with the
 *  openid/email scopes every sign-in token has. Throws with the same
 *  gmail_401 / gmail_403 prefixes on failure so callers map it to the
 *  re-sign-in status. */
export async function getGoogleUserinfoEmail(
  accessToken: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(USERINFO_API, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("gmail_error: Google is unavailable right now. Try again.");
  }
  if (!res.ok) throw await gmailError(res, "Google sign-in check failed");
  const payload = (await res.json()) as { email?: string };
  if (!payload.email)
    throw new Error("gmail_error: Google sign-in returned no email address");
  return payload.email;
}
