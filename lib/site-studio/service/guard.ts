import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

/** Auth + permission gate for every Site Studio route. */
export async function guard(): Promise<{ error: 401 | 403 } | { userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) return { error: 403 };
  return { userId: user.id };
}

export function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

/** Headers for serving UNTRUSTED uploaded template content. The LMS session is
 *  same-origin, so an uploaded <script> would otherwise run with the viewing
 *  operator's cookies. CSP `sandbox` (without allow-same-origin) strips script
 *  execution, form submission, and same-origin privileges — THAT is what
 *  neutralizes the content, not frame denial. X-Frame-Options is SAMEORIGIN
 *  (not DENY) because Phase 2b's review drawer deliberately iframes this
 *  /preview route from the LMS origin itself; the sandbox CSP still applies
 *  inside that iframe, so the embedded content stays inert. nosniff stops
 *  content-type confusion attacks. */
export function untrustedContentHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; font-src 'self' data:",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
}
