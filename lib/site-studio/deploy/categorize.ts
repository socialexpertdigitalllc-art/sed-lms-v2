/**
 * Merge DB truth (studio_deployments) with hosting truth (DirectAdmin
 * subdomains + Hostinger domains) into one categorized board list.
 *
 * Categories:
 *   ready  — tracked, live, linked to a lead, on a staging subdomain
 *   manual — tracked, manually uploaded (origin 'manual'), unlinked
 *   live   — custom domains (tracked transfers + every hosting domain)
 *   other  — everything else on the hosting (untracked subdomains,
 *            tracked-but-unlinked non-manual rows, taken_down/failed history)
 */

export type BoardCategory = "ready" | "manual" | "live" | "other";

export interface TrackedRow {
  id: string;
  lead_id: string | null;
  run_id: string | null;
  subdomain: string;
  url: string;
  status: "live" | "taken_down" | "failed";
  origin: string;
  deployed_at: string | null;
  leads: { business_name: string; status?: string } | null;
}

export interface BoardRow {
  id: string | null; // null = untracked (exists on hosting only)
  subdomain: string | null; // null = custom-domain row
  url: string;
  status: "live" | "taken_down" | "failed" | "untracked";
  origin: string | null;
  category: BoardCategory;
  leadId: string | null;
  leadName: string | null;
  leadStatus: string | null;
  deployedAt: string | null;
  isCustomDomain: boolean;
  /** Hostinger's detected type for a custom-domain site ("other" = static
   *  files, "wordpress", "nodejs", ...); null for staging rows or unknown. */
  siteType: string | null;
}

/** A website on the Hostinger plan; a bare string means "type unknown". */
export type HostedSite = { domain: string; siteType: string | null };

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isCustomDomainUrl(url: string, daDomain: string): boolean {
  const h = hostnameOf(url);
  if (!h) return false;
  const da = daDomain.toLowerCase();
  return h !== da && !h.endsWith(`.${da}`);
}

export function categorizeTracked(row: TrackedRow, daDomain: string): BoardCategory {
  if (isCustomDomainUrl(row.url, daDomain)) return "live";
  if (row.status === "live" && row.lead_id) return "ready";
  if (row.origin === "manual") return "manual";
  return "other";
}

export function buildBoard(
  tracked: TrackedRow[],
  hostingSubdomains: string[] | null,
  hostingerSites: (string | HostedSite)[] | null,
  daDomain: string,
): BoardRow[] {
  const sites: HostedSite[] = (hostingerSites ?? []).map((s) =>
    typeof s === "string" ? { domain: s, siteType: null } : s,
  );
  const typeOf = new Map(sites.map((s) => [s.domain.toLowerCase(), s.siteType]));
  const rows: BoardRow[] = tracked.map((t) => {
    const custom = isCustomDomainUrl(t.url, daDomain);
    const host = custom ? hostnameOf(t.url) : null;
    return {
      id: t.id,
      subdomain: custom ? null : t.subdomain,
      url: t.url,
      status: t.status,
      origin: t.origin,
      category: categorizeTracked(t, daDomain),
      leadId: t.lead_id,
      leadName: t.leads?.business_name ?? null,
      leadStatus: t.leads?.status ?? null,
      deployedAt: t.deployed_at,
      isCustomDomain: custom,
      siteType: host ? (typeOf.get(host) ?? typeOf.get(host.replace(/^www\./, "")) ?? null) : null,
    };
  });

  // Untracked staging subdomains → "other". A tracked row of ANY status claims
  // its label (a taken_down row whose subdomain re-appears on hosting stays
  // attached to its history row rather than duplicating).
  const claimed = new Set(
    tracked.filter((t) => !isCustomDomainUrl(t.url, daDomain)).map((t) => t.subdomain),
  );
  for (const sub of hostingSubdomains ?? []) {
    if (claimed.has(sub)) continue;
    rows.push({
      id: null,
      subdomain: sub,
      url: `https://${sub}.${daDomain}`,
      status: "untracked",
      origin: null,
      category: "other",
      leadId: null,
      leadName: null,
      leadStatus: null,
      deployedAt: null,
      isCustomDomain: false,
      siteType: null,
    });
  }

  // Hosted websites → "live". The staging apex itself is infrastructure, not
  // a client site — never list it (deleting it would take down everything).
  const claimedDomains = new Set(
    rows.filter((r) => r.isCustomDomain).map((r) => hostnameOf(r.url)).filter(Boolean),
  );
  for (const site of sites) {
    const d = site.domain.toLowerCase();
    if (d === daDomain.toLowerCase()) continue;
    if (claimedDomains.has(d)) continue;
    claimedDomains.add(d);
    rows.push({
      id: null,
      subdomain: null,
      url: `https://${d}`,
      status: "untracked",
      origin: null,
      category: "live",
      leadId: null,
      leadName: null,
      leadStatus: null,
      deployedAt: null,
      isCustomDomain: true,
      siteType: site.siteType,
    });
  }

  return rows;
}

export function filterByView(rows: BoardRow[], view: string | null): BoardRow[] {
  switch (view) {
    case "ready":
    case "manual":
    case "other":
      return rows.filter((r) => r.category === view);
    case "live":
      return rows.filter((r) => r.category === "live");
    case "all":
    default:
      // "All" is the subdomain universe — custom domains live in their own tab.
      return view === "all" ? rows.filter((r) => !r.isCustomDomain) : rows;
  }
}
