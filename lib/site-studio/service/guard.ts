import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

export type GuardResult = { error: 401 | 403 } | { userId: string };

/**
 * Auth gate that passes a user holding ANY of the given permissions.
 *
 * Exists for the handful of READS the lead form shows to people who will
 * never manage the studio: a salesperson picking a template with a client
 * on the phone needs the in-service catalogue, its covers and its previews,
 * and holds `leads.create`, not `studio.manage`. Every route that changes
 * anything keeps using `guard()` below.
 */
export async function guardAny(permissions: readonly string[]): Promise<GuardResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!permissions.some((p) => perms.has(p))) return { error: 403 };
  return { userId: user.id };
}

/** Auth + permission gate for every Site Studio route. */
export async function guard(): Promise<GuardResult> {
  return guardAny(["studio.manage"]);
}

export function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export interface UntrustedContentOptions {
  /** CROSS-REFERENCE — read together with `RunPreview.tsx`'s own note on its
   *  iframe `sandbox` attribute before touching either side. Bare CSP
   *  `sandbox` (the default here) and an iframe's `sandbox` ATTRIBUTE combine
   *  RESTRICTIVELY: whichever side omits a token wins, so a bare `sandbox`
   *  response forces an opaque origin even when the consuming iframe carries
   *  `sandbox="allow-same-origin"`. That is exactly what made Gate 2's
   *  click-to-edit dead in every real browser (`frame.contentDocument` was
   *  `null`, confirmed in real Chromium) — a bug FIX 1 (Phase 4a review)
   *  corrects by adding this opt-in. Pass `allowSameOrigin: true` ONLY for a
   *  route whose consuming iframe ALSO carries `sandbox="allow-same-origin"`
   *  (today: only `RunPreview`'s `?page=` response, via
   *  `app/api/site-studio/runs/[id]/preview/route.ts`). Every other
   *  directive is untouched either way — `allow-scripts` is never granted,
   *  so an uploaded/generated `<script>` still never executes; only the
   *  framed document's ORIGIN (not its script privileges) is affected. The
   *  Phase 2a template preview/original routes deliberately do NOT set this:
   *  their consuming iframe (`ReviewDrawer.tsx`) uses a plain empty
   *  `sandbox=""` with no `allow-same-origin` of its own, no code there ever
   *  needs `contentDocument` access, and those routes serve completely raw,
   *  unmodified third-party markup (not even Site Studio's own rendering) —
   *  loosening their origin isolation would buy nothing and would remove a
   *  defense-in-depth layer that protects a different feature than the one
   *  that needed the loosening. */
  allowSameOrigin?: boolean;
}

/** Headers for serving UNTRUSTED uploaded template content. The LMS session is
 *  same-origin, so an uploaded <script> would otherwise run with the viewing
 *  operator's cookies. CSP `sandbox` (without allow-same-origin) strips script
 *  execution, form submission, and same-origin privileges — THAT is what
 *  neutralizes the content, not frame denial. X-Frame-Options is SAMEORIGIN
 *  (not DENY) because Phase 2b's review drawer deliberately iframes this
 *  /preview route from the LMS origin itself; the sandbox CSP still applies
 *  inside that iframe, so the embedded content stays inert. nosniff stops
 *  content-type confusion attacks.
 *
 *  See `UntrustedContentOptions.allowSameOrigin` for when/why a caller opts
 *  into `sandbox allow-same-origin` instead of the strict bare `sandbox`
 *  default — script execution stays blocked either way (verified in real
 *  Chromium: an inline `<script>` in the framed document does not run under
 *  `sandbox allow-same-origin`), only the framed document's origin changes. */
export function untrustedContentHeaders(contentType: string, opts: UntrustedContentOptions = {}): HeadersInit {
  const sandbox = opts.allowSameOrigin ? "sandbox allow-same-origin" : "sandbox";
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": `${sandbox}; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; font-src 'self' data:`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
}
