import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { importAllDomains, type ImportResult, type ImportSummary } from "@/lib/domains/import";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/domains/import (also /api/domains/sync) — bring the dashboard in
 * step with the registrars now: new domains on the Hostinger portfolio and the
 * Cloudflare account (when configured) come in — expired ones too; known ones
 * get their expiry, status, auto-renew and price refreshed; ones the registrar
 * no longer lists are marked missing. The background sweep does the same every
 * six hours.
 */
export async function POST() {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  // both registrars are read against Hostinger's website list
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
    expired: sum("expired"),
    missing: sum("missing"),
    alerts: r.alerts,
  });
}
