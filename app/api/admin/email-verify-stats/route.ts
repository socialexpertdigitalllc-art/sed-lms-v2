import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildScorecard, buildUsageStats, type VerificationRow } from "@/lib/email-verify/scorecard";
import { listSendOutcomes } from "@/lib/email-verify/outcomes";
import { getAllProviderQuotas } from "@/lib/email-verify/balance";

export const runtime = "nodejs";

/** Hard cap on rows pulled for the dashboard — this is a summary, not an export. */
const MAX_ROWS = 5000;
const DEFAULT_DAYS = 90;

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

/**
 * Usage over time, per-provider counts, verdict distribution, cache-hit rate,
 * live quota, and the provider accuracy scorecard. Read-only.
 */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(365, Math.floor(daysParam)) : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const admin = createAdminClient();
  const { data } = await admin
    .from("email_verifications")
    .select("normalized_email, provider, provider_status, verdict, verified_at")
    .gte("verified_at", since)
    .order("verified_at", { ascending: false })
    .limit(MAX_ROWS);

  const verifications: VerificationRow[] = (data ?? []).map((r) => ({
    normalizedEmail: r.normalized_email as string,
    provider: (r.provider as string | null) ?? null,
    providerStatus: (r.provider_status as string | null) ?? null,
    verdict: r.verdict as VerificationRow["verdict"],
    verifiedAt: r.verified_at as string,
  }));

  const [outcomes, quotas] = await Promise.all([listSendOutcomes(MAX_ROWS), getAllProviderQuotas()]);

  return NextResponse.json({
    days,
    usage: buildUsageStats(verifications),
    scorecard: buildScorecard(verifications, outcomes),
    quotas,
    outcomes: {
      hardBounces: outcomes.filter((o) => o.outcome === "hard_bounce").length,
      softBounces: outcomes.filter((o) => o.outcome === "soft_bounce").length,
    },
  });
}
