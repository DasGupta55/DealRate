// Gmail API send — one-click sending from the creator's own Gmail.
//
// The creator signs in with Google via Supabase and grants the
// gmail.send scope, so the Supabase session carries a Google access
// token (provider_token). The client passes that token to the server on
// send; the server calls the Gmail API with it. No new env vars, no
// stored tokens: the token is only ever used to send the exact email
// the signed-in creator requested, to the brand on their own
// deal/invoice.
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
 *  belongs to. Returns the Gmail message id. Throws an Error whose
 *  message starts with gmail_401 / gmail_403 / gmail_error. */
export async function sendGmailMessage(
  accessToken: string,
  msg: GmailMessage,
): Promise<{ messageId: string }> {
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
  const payload = (await res.json()) as { id?: string };
  if (!payload.id)
    throw new Error("gmail_error: Gmail send returned no message id");
  return { messageId: payload.id };
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
    return "Gmail send permission was not granted — sign out and sign in again with Google, making sure to tap Continue on the permission screen, then try sending.";
  }
  return "Gmail permission expired or not granted — sign out and sign in again with Google, then try sending.";
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
