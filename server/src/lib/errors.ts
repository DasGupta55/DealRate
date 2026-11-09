// HTTP-aware errors. Handlers throw these so the router can map them to
// the right status code; anything else becomes a 500. Messages are the
// user-facing strings from the source — never stack traces.

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Unverified / missing sign-in (source message, verbatim). */
export function unauthorized(
  message = "Your sign-in session could not be verified. Sign in again and try again.",
): HttpError {
  return new HttpError(401, message);
}

/** Pro-gate / owner-gate failures. */
export function forbidden(message: string): HttpError {
  return new HttpError(403, message);
}
