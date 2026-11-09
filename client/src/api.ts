// Typed RPC client for the standalone website.
//
// The artifact's SDK action client POSTed `{ action, args }` to `./actions`. The standalone API instead exposes one
// HTTP route per action:
//
//   POST {VITE_API_URL (default "" = same origin)}/api/<actionName>
//   body: the action's args as JSON
//   header: `Authorization: Bearer <supabase access token>` when signed in
//   response: the action's JSON
//   error: `{ error: "<message>" }` with a non-2xx status
//
// The call signature is unchanged — `api.<actionName>(args)` returns a
// Promise of the action's response — so no call site in App.tsx changes.
// The access token travels both in the args (every call site already passes
// `accessToken` explicitly) and as the Bearer header: the header token is
// taken from `args.accessToken` when present, falling back to the current
// Supabase session (see getCurrentAccessToken in ./supabase).
//
// `import type { ActionHandlers }` is type-only by design: the client bundle never
// pulls in any server runtime. Vite/esbuild erases type-only imports at
// build time, so this file builds even while server/src/actions.ts does not
// exist yet (the server is being built in parallel).

import type { ActionHandlers } from "../../server/src/actions";
import { getCurrentAccessToken } from "./supabase";

// One method per action. Server handlers are (ctx, args) => Promise<out>,
// so the first case drops the ctx parameter and infers the args/response
// from the handler's own zod schema. When the server's ActionHandlers type
// carries enough shape (a function, or an { input, output } pair) the
// argument/response types are inferred from it; otherwise the method falls
// back to an untyped JSON round-trip so the client keeps working.
type MethodFor<A> = A extends (ctx: any, args: infer I) => Promise<infer O>
  ? (args: I) => Promise<O>
  : A extends (args: infer I) => Promise<infer O>
    ? (args: I) => Promise<O>
    : A extends (args: infer I) => infer O
      ? (args: I) => Promise<Awaited<O>>
      : A extends { input: infer I; output: infer O }
        ? (args: I) => Promise<O>
        : (args: any) => Promise<any>;

export type ActionClient<A> = {
  [K in keyof A]: MethodFor<A[K]>;
};

function apiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  return base.replace(/\/$/, "");
}

async function callAction(actionName: string, args: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const argToken = (args as { accessToken?: unknown } | null)?.accessToken;
  const token =
    typeof argToken === "string" && argToken
      ? argToken
      : await getCurrentAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl()}/api/${actionName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body: fall through to the status check below.
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(
      typeof message === "string" && message
        ? message
        : `Request failed (${res.status})`,
    );
  }
  return data;
}

function createRpcClient(): unknown {
  return new Proxy(
    {},
    {
      get(_target, actionName: string | symbol) {
        if (typeof actionName !== "string") return undefined;
        return (args: unknown) => callAction(actionName, args);
      },
    },
  );
}

export const api = createRpcClient() as ActionClient<ActionHandlers>;

// Helper types, mirroring the SDK's ApiRequest/ApiResponse, so client code
// can keep doing:
//
//     import { api, type ApiResponse } from "./api";
//     type Dash = ApiResponse<typeof api, "getDashboard">;
export type ApiRequest<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Parameters<C[K]>[0];

export type ApiResponse<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Awaited<ReturnType<C[K]>>;
