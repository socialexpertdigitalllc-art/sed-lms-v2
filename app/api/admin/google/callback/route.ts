import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { exchangeCode, GOOGLE_SCOPES } from "@/lib/google/oauth";
import { saveGoogleConnection } from "@/lib/google/connection";

export const runtime = "nodejs";

const DEST = "/admin/contract-templates";

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
  const origin = url.origin;

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
