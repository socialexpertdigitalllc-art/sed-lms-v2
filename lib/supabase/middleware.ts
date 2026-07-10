import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Public routes — the marketing site + docs + login are reachable without auth.
  // The WGE processor authenticates itself via the x-wge-secret header (it's
  // called server-to-server by the enqueue kick + the instrumentation poller,
  // which have no user session), so it must bypass the auth redirect.
  const isPublic =
    path === "/" ||
    path === "/login" ||
    path.startsWith("/docs") ||
    path === "/api/ai-tools/wge/process" ||
    path === "/api/template-engine/process" ||
    path === "/api/notifications/generate" ||
    path === "/api/tickets/maintenance";

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Signed-in users skip the login form, but may still browse the marketing site.
  if (user && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
