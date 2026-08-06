import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

// Request-scoped. The app has ~180 `supabase.auth.getUser()` call sites, and a
// single page view touches a dozen of them (layout + page + every API route it
// fans out to). Each one is a network round-trip to GoTrue that costs two DB
// queries, so an un-deduped render multiplied one page view into a dozen hits
// on the auth server. That amplification is what saturated the database and
// turned a slow query into a site-wide 504. `cache()` makes every caller within
// one request share a single client — and, below, a single getUser() result.
export const createClient = cache(async () => {
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
