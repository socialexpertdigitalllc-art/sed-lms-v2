import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { importAllDomains, type ImportResult, type ImportSummary } from "@/lib/domains/import";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/domains/import — pull the domains we already own into the
 * dashboard: the Hostinger portfolio, plus the Cloudflare account when it is
 * configured. Ones whose site is already up come in as `connected` (set up by
 * hand — never touched again); ones pointing nowhere are `unassigned`.
 * Re-running only refreshes expiry / auto-renew.
 */
export async function POST() {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  // both imports read Hostinger's website list to know what is hosted already
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const r = await importAllDomains(auth.admin, auth.userId, { cloudflare: cloudflareConfigured() });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  const ran = [r.hostinger, r.cloudflare].filter((x): x is ImportResult => x !== null);
  const done = ran.flatMap((x) => (x.ok ? [x.summary] : []));
  if (done.length === 0) {
    return NextResponse.json({ error: ran.map((x) => (x.ok ? "" : x.error)).join("; ") }, { status: 502 });
  }
  const sum = (k: Exclude<keyof ImportSummary, "autoRenewOff">) => done.reduce((n, s) => n + s[k], 0);
  const report = (x: ImportResult | null) => (x === null ? null : x.ok ? x.summary : { error: x.error });
  return NextResponse.json({
    hostinger: report(r.hostinger),
    cloudflare: report(r.cloudflare),
    added: sum("added"),
    connected: sum("connected"),
    unassigned: sum("unassigned"),
    linked: sum("linked"),
    refreshed: sum("refreshed"),
    skipped: sum("skipped"),
  });
}
