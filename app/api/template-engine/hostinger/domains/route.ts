import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  hostingerConfigured,
  isStaticWebsite,
  listDomains,
  listWebsites,
  websiteTypeLabel,
} from "@/lib/hostinger/client";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TransferCandidate = {
  domain: string;
  expires_at: string | null;
  /** Already a website on the hosting (otherwise the transfer creates it). */
  hosted: boolean;
  siteType: string | null;
  /** False for WordPress/Node/Builder sites — a static deploy would erase them. */
  transferable: boolean;
  note: string;
};

/**
 * GET /api/template-engine/hostinger/domains — transfer targets for the
 * "transfer to custom domain" picker: every active domain registered on the
 * Hostinger account plus every domain already hosted there (a client-owned
 * domain registered elsewhere but pointed at our hosting counts). Each entry
 * says what a transfer would do. Company and staging domains never appear.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hostingerConfigured()) return NextResponse.json({ domains: [], configured: false });

  const [registered, websites] = await Promise.all([listDomains(), listWebsites()]);
  if (registered === null && websites === null) {
    return NextResponse.json({ error: "Could not reach Hostinger to list domains — try again." }, { status: 502 });
  }

  const daDomain = (process.env.DA_DOMAIN ?? "").toLowerCase();
  const eligible = (d: string) =>
    !isProtectedDomain(d) &&
    !(daDomain && (d === daDomain || d.endsWith(`.${daDomain}`))) &&
    // Hostinger's temporary preview addresses are not client domains
    !d.endsWith(".hostingersite.com");

  const byDomain = new Map<string, TransferCandidate>();
  for (const w of websites ?? []) {
    const d = (w.domain ?? "").toLowerCase();
    if (!d || !eligible(d)) continue;
    const transferable = isStaticWebsite(w);
    byDomain.set(d, {
      domain: d,
      expires_at: null,
      hosted: true,
      siteType: w.website_type ?? null,
      transferable,
      note: transferable
        ? "Hosted — its current files are replaced (a snapshot is kept)"
        : `${websiteTypeLabel(w.website_type)} site — can't receive a transfer`,
    });
  }
  for (const r of registered ?? []) {
    const d = r.domain.toLowerCase();
    if ((r.status ?? "").toLowerCase() !== "active" || !eligible(d)) continue;
    const hosted = byDomain.get(d);
    if (hosted) hosted.expires_at = r.expires_at;
    else {
      byDomain.set(d, {
        domain: d,
        expires_at: r.expires_at,
        hosted: false,
        siteType: null,
        transferable: true,
        note: "Not hosted yet — hosting is set up during the transfer",
      });
    }
  }

  const domains = [...byDomain.values()].sort(
    (a, b) => Number(b.transferable) - Number(a.transferable) || a.domain.localeCompare(b.domain),
  );
  const warning =
    registered === null
      ? "Could not read the registered domains — only hosted ones are listed."
      : websites === null
        ? "Could not read the hosted websites — only registered domains are listed."
        : null;
  return NextResponse.json({ domains, configured: true, warning });
}
