import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDescriptor, hasCompleteCredentials } from "@/lib/email-verify/registry";
import { getProviderConfigs } from "@/lib/email-verify/config";
import { fetchProviderBalance } from "@/lib/email-verify/balance";

export const runtime = "nodejs";

/**
 * Validate a provider's stored credentials WITHOUT burning verification quota.
 *
 * Both supported vendors expose a balance endpoint that costs nothing, so the
 * test is a balance lookup. If a future provider has no such endpoint we say so
 * (`tested: false`) rather than quietly spending one of the user's credits on a
 * throwaway verification.
 */

async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function POST(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const { key } = await params;
  const descriptor = getDescriptor(key);
  if (!descriptor) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const config = (await getProviderConfigs().catch(() => [])).find((c) => c.key === key);
  if (!hasCompleteCredentials(descriptor, config?.credentials)) {
    return NextResponse.json({ ok: false, tested: true, error: "No credentials are stored for this provider" });
  }

  if (!descriptor.supportsBalance) {
    return NextResponse.json({
      ok: null,
      tested: false,
      error: `${descriptor.label} publishes no free credential-check endpoint. Testing it would spend a verification credit, so we did not.`,
    });
  }

  const lookup = await fetchProviderBalance(key, config?.credentials);
  if (!lookup) {
    return NextResponse.json({ ok: null, tested: false, error: "No balance endpoint for this provider" });
  }
  if (!lookup.ok) {
    return NextResponse.json({ ok: false, tested: true, error: lookup.error });
  }

  // Report the number we just fetched directly — calling getProviderQuota here
  // would either serve a stale cache or spend a second needless round-trip.
  return NextResponse.json({
    ok: true,
    tested: true,
    remaining: lookup.remaining,
    limit: descriptor.freeLimit,
    period: descriptor.period,
    checkedAt: new Date().toISOString(),
  });
}
