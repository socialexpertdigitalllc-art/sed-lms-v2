import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { UserResponse } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { ttlCached } from "@/lib/cache/ttl";

/**
 * A person's session to act in INSTEAD of the request's cookies — for work
 * done on someone's behalf outside their browser (a message to SED AI on
 * Telegram, a rule the scheduler runs). While set, every createClient() in
 * that async scope is that person's own RLS client, so the app's endpoints,
 * permission checks and row-level security treat the work exactly as if they
 * had done it themselves. Set ONLY by lib/auth/actAs.ts.
 */
export const actingSession = new AsyncLocalStorage<{ accessToken: string; userId: string }>();

// Request-scoped. The app has ~180 `supabase.auth.getUser()` call sites, and a
// single page view touches a dozen of them (layout + page + every API route it
// fans out to). Each one is a network round-trip to GoTrue that costs two DB
// queries, so an un-deduped render multiplied one page view into a dozen hits
// on the auth server. That amplification is what saturated the database and
// turned a slow query into a site-wide 504. `cache()` makes every caller within
// one request share a single client — and, below, a single getUser() result.
const cookieClient = cache(async () => {
  const cookieStore = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component — safe to ignore when middleware refreshes sessions
          }
        },
      },
    }
  );

  // Collapse the many getUser() calls made while serving one request into a
  // single in-flight round-trip. Calls that pass an explicit JWT are left alone
  // — they are asking about a *different* token than the request's own session.
  const verifyUser = client.auth.getUser.bind(client.auth);
  let inflight: Promise<UserResponse> | null = null;
  client.auth.getUser = ((jwt?: string) => {
    if (jwt) return verifyUser(jwt);
    inflight ??= verifyUserCached(() => client.auth.getSession(), verifyUser);
    return inflight;
  }) as typeof client.auth.getUser;

  return client;
});

/**
 * How long a verified user is trusted without asking GoTrue again. A token is
 * valid for an hour anyway; what this bounds is how late a ban / deletion
 * takes effect on an instance (at most this long).
 */
const AUTH_USER_TTL_MS = 60_000;

/**
 * Verified-user lookup shared ACROSS requests, keyed by the token it verifies.
 *
 * The per-request dedup above still left one GoTrue round-trip per request —
 * and every page view fans out into 5–6 API calls (badges, bells, mail), so
 * prod measured ~16,000 /auth/v1/user calls a day at ~300 ms each, with
 * 30 s stalls under load. The token is read from the cookie (no network);
 * the first request in each window verifies it for real and the rest reuse
 * that answer. A failed verification is never cached, so a transient auth
 * outage retries on the next call and a bad token stays bad every time.
 */
export async function verifyUserCached(
  getSession: () => Promise<{ data: { session: { access_token: string } | null } }>,
  verifyUser: () => Promise<UserResponse>,
  now: () => number = Date.now,
): Promise<UserResponse> {
  const { data } = await getSession();
  const token = data.session?.access_token;
  if (!token) return verifyUser();
  const key = createHash("sha256").update(token).digest("hex");
  try {
    return await ttlCached(
      "auth-user",
      key,
      AUTH_USER_TTL_MS,
      async () => {
        const result = await verifyUser();
        // Only a verified user is worth remembering; surface anything else
        // to the caller untouched (and uncached) via the throw below.
        if (result.error || !result.data.user) throw new Uncached(result);
        return result;
      },
      now,
    );
  } catch (e) {
    if (e instanceof Uncached) return e.result;
    throw e;
  }
}

class Uncached {
  constructor(readonly result: UserResponse) {}
}

/** An RLS client signed in with an access token rather than cookies. */
function sessionClient(accessToken: string) {
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [], setAll: () => {} },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const verifyUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = ((jwt?: string) => verifyUser(jwt ?? accessToken)) as typeof client.auth.getUser;
  return client;
}

/** The signed-in person's own (RLS) client: their cookies, or — inside
 *  actingSession — the session work is being done in on their behalf. */
export async function createClient() {
  const acting = actingSession.getStore();
  if (acting) return sessionClient(acting.accessToken);
  return cookieClient();
}
