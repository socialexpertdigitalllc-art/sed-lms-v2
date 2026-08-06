import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Reject rather than let a stalled auth call hold the request open forever. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("auth verification timed out")), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Gate on locally-verified JWT claims rather than getUser(). getUser() is a
  // network round-trip to GoTrue (two DB queries) on EVERY request that reaches
  // this matcher — prefetches, RSC payloads and API calls included. Under load
  // that round-trip was taking 10-50s, and because middleware blocks the whole
  // request, the gateway hit its ~60s ceiling and returned 504 for the entire
  // site. getClaims() verifies the ES256 signature against the project's cached
  // JWKS with no network call at all, so a struggling database can no longer
  // stall page delivery. It still calls getSession() internally, so expired
  // tokens are refreshed and the rotated cookies are written through setAll().
  //
  // This is a gate, not the authorisation itself: routes and pages still call
  // getUser() (now deduped per request) for anything that acts on the user.
  let claims: unknown = null;
  try {
    const { data } = await withTimeout(supabase.auth.getClaims(), 5_000);
    claims = data?.claims ?? null;
  } catch {
    // Verification unavailable (auth server unreachable or too slow). Fail
    // closed: treat as signed out rather than hanging the request open.
    claims = null;
  }
  const user = claims;

  const path = request.nextUrl.pathname;

  // Public routes — the marketing site + docs + login are reachable without auth.
  // The WGE processor authenticates itself via the x-wge-secret header (it's
  // called server-to-server by the enqueue kick + the instrumentation poller,
  // which have no user session), so it must bypass the auth redirect.
  const isPublic =
    path === "/" ||
    path === "/login" ||
    path.startsWith("/docs") ||
    // PWA plumbing for the /verify mini-app. Both are static, contain nothing
    // user-specific, and must resolve as JS / JSON rather than an HTML redirect
    // or Chrome will neither register the worker nor offer "Install".
    path === "/sw.js" ||
    path === "/manifest.webmanifest" ||
    path === "/api/ai-tools/wge/process" ||
    path === "/api/template-engine/process" ||
    path === "/api/notifications/generate" ||
    path === "/api/tickets/maintenance" ||
    // Same contract as the WGE processor above: secret-header auth, called by
    // the instrumentation poller with no user session. Discovered missing in
    // LIVE deploy verification — a 307-to-login here silently kills the
    // background processor, and no route test can catch it (they import the
    // handler directly, bypassing middleware entirely).
    path === "/api/site-builder/process";

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Signed-in users skip the login form, but may still browse the marketing site.
  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
