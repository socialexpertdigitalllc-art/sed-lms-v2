import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

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
  let inflight: ReturnType<typeof verifyUser> | null = null;
  client.auth.getUser = ((jwt?: string) => {
    if (jwt) return verifyUser(jwt);
    inflight ??= verifyUser();
    return inflight;
  }) as typeof client.auth.getUser;

  return client;
});

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
