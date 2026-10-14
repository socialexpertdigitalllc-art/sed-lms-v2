/**
 * Calling the app's own API endpoints in-process, as the signed-in person —
 * how every action makes its change. SERVER ONLY.
 *
 * An action does not re-implement "create a lead": it calls the same POST
 * handler the New Lead form calls, inside the confirm request. The handler
 * reads the session the way it always does (createClient() → this request's
 * cookies, or the acting session for phone messages and scheduled work), so
 * its permission checks, row-level security, duplicate guard, notifications
 * and activity log all run exactly as they do for the screen. If the
 * endpoint says no, the action fails with the endpoint's own words.
 */

// Route handlers type their own params ({ id }, { id, file }…); any of them may be called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: any) => Promise<Response> | Response;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

export class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface CallOptions {
  /** The path the handler would be served at, for handlers that read req.url. */
  path: string;
  params?: Record<string, string>;
  body?: unknown;
  form?: FormData;
  search?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

const BASE = "http://localhost";

/** The error an endpoint returned, as one sentence a person can act on. */
export function routeErrorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  let msg = pick(b.error) ?? pick(b.message) ?? null;
  // zod's flatten(): { issues: { formErrors, fieldErrors } }
  const issues = (b.issues ?? b.details) as { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined;
  if (issues && typeof issues === "object") {
    const parts = [
      ...(issues.formErrors ?? []),
      ...Object.entries(issues.fieldErrors ?? {}).map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`),
    ].filter(Boolean);
    if (parts.length) msg = `${msg && msg !== "Invalid input" ? `${msg} — ` : ""}${parts.slice(0, 4).join("; ")}`;
  }
  if (msg) return msg;
  if (status === 401) return "You are signed out. Sign in again and retry.";
  if (status === 403) return "Your account is not allowed to do that.";
  if (status === 404) return "That record no longer exists (or you cannot see it).";
  if (status === 409) return "That conflicts with something that already exists.";
  return `The change could not be made (HTTP ${status}).`;
}

/**
 * Call one handler. Returns its JSON on success; throws RouteError (with the
 * endpoint's own message) on any non-2xx.
 */
export async function callRoute<T = Record<string, unknown>>(
  load: () => Promise<RouteModule>,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  opts: CallOptions,
): Promise<T> {
  const mod = await load();
  const handler = mod[method];
  if (!handler) throw new Error(`No ${method} handler for ${opts.path}`);
  const url = new URL(opts.path, BASE);
  for (const [k, v] of Object.entries(opts.search ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { "x-sed-assistant": "1", ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  const req = new Request(url, { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 300) };
  }
  if (!res.ok) throw new RouteError(routeErrorMessage(json, res.status), res.status, json);
  return (json ?? {}) as T;
}
