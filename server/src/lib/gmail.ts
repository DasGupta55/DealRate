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

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessage {
  to: string;
  subject: string;
  body: string;
}

/** True when an error came from the Gmail API with a 401/403 — the
 *  token is expired, invalid, or missing the gmail.send scope. Callers
 *  map these to a "sign in again" status instead of a generic error. */
export function isGmailAuthError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.startsWith("gmail_401") ||
      err.message.startsWith("gmail_403"))
  );
}

function gmailError(res: Response, fallback: string): Error {
  if (res.status === 401)
    return new Error("gmail_401: Gmail token expired or invalid");
  if (res.status === 403)
    return new Error(
      "gmail_403: Gmail permission not granted (gmail.send scope missing)",
    );
  return new Error(`gmail_error: ${fallback} (HTTP ${res.status})`);
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
  if (!res.ok) throw gmailError(res, "Gmail send failed");
  const payload = (await res.json()) as { id?: string };
  if (!payload.id)
    throw new Error("gmail_error: Gmail send returned no message id");
  return { messageId: payload.id };
}

/** The Gmail address the access token belongs to. Used to verify the
 *  token matches the signed-in account before anything is sent with
 *  it. Throws with the same gmail_ prefixes on failure. */
export async function getGmailProfileEmail(
  accessToken: string,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("gmail_error: Gmail is unavailable right now. Try again.");
  }
  if (!res.ok) throw gmailError(res, "Gmail profile lookup failed");
  const payload = (await res.json()) as { emailAddress?: string };
  if (!payload.emailAddress)
    throw new Error("gmail_error: Gmail profile returned no email address");
  return payload.emailAddress;
}
