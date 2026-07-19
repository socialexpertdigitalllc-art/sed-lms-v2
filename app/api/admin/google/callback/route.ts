import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { exchangeCode, GOOGLE_SCOPES } from "@/lib/google/oauth";
import { saveGoogleConnection } from "@/lib/google/connection";

export const runtime = "nodejs";

const DEST = "/admin/contract-templates";

/**
 * The app's PUBLIC origin. Behind the host's proxy, `new URL(req.url).origin`
 * is the internal bind address (e.g. https://0.0.0.0:3000), which would send the
 * operator to a dead URL after consent. GOOGLE_OAUTH_REDIRECT_URI is by
 * definition the correct public URL (Google requires an exact match), so it is
 * the most reliable source; forwarded headers are the fallback.
 */
function appOrigin(req: Request): string {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* malformed env — fall through to headers */
    }
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  return new URL(req.url).origin;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  const origin = appOrigin(req);

  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${origin}${DEST}?google_error=${encodeURIComponent(reason)}`);
    r.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  };

  if (err) return fail(err);
  if (!code) return fail("missing_code");
  if (!state || !expected || state !== expected) return fail("state_mismatch");

  try {
    const { refreshToken, email } = await exchangeCode(code);
    await saveGoogleConnection({ refreshToken, email, scope: GOOGLE_SCOPES, userId: user.id });
    await createAdminClient().from("activity_log").insert({
      user_id: user.id, action: "google.connected", entity_type: "google_connection",
      new_value: { account_email: email },
    });
  } catch (e) {
    return fail((e as Error).message);
  }

  const ok = NextResponse.redirect(`${origin}${DEST}?google_connected=1`);
  ok.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
  return ok;
}
