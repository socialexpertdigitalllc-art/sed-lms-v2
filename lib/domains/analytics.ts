// lib/domains/analytics.ts — the numbers behind the Domains analytics page.
// Pure: rows + uptime aggregates in, KPIs / chart series / action lists out.
// Tested.
import { STATUS_LABELS, renewalBucket, type ClientDomainRow, type DomainHealth, type HealthState } from "./types";

const DAY_MS = 86_400_000;

export type AnalyticsRow = ClientDomainRow & { leads?: { business_name: string | null } | null };

export interface UptimeAgg {
  domain_id: string;
  checks: number;
  up: number;
  counted: number;
  avg_ms: number | null;
  last_down_at: string | null;
}

export interface UptimeDay {
  day: string;
  up: number;
  counted: number;
  avg_ms: number | null;
}

export type ActionKind = "expired" | "expiring" | "down" | "ssl" | "attention" | "missing";

export interface ActionItem {
  id: string;
  domain: string;
  lead: string | null;
  kind: ActionKind;
  detail: string;
  /** 3 = act today, 2 = this week, 1 = when convenient */
  severity: 1 | 2 | 3;
  /** sort key within a severity: sooner first */
  when: number;
}

export interface DomainAnalytics {
  generatedAt: string;
  totals: {
    domains: number;
    cloudflare: number;
    hostinger: number;
    active: number;
    expired: number;
    missing: number;
    pending: number;
    linked: number;
    unlinked: number;
    live: number;
    connected: number;
    unassigned: number;
    inProgress: number;
    needsAttention: number;
    autoRenewOn: number;
    autoRenewOff: number;
    autoRenewUnknown: number;
    expiring7: number;
    expiring30: number;
    atRisk30: number;
    sitesUp: number;
    sitesDown: number;
    sslIssues: number;
    parked: number;
    noDns: number;
    unchecked: number;
  };
  money: {
    currency: string;
    /** a year of renewals for the registrations set to renew */
    annualRenewalCents: number;
    /** what it would cost to keep every active registration */
    annualAllCents: number;
    next30Cents: number;
    next90Cents: number;
    /** paid for domains bought through the dashboard */
    spentCents: number;
    avgRenewalCents: number | null;
    pricedDomains: number;
    savings: { domains: number; cents: number };
  };
  kpis: {
    uptime30: number | null;
    avgResponseMs: number | null;
    healthyRate: number | null;
    autoRenewRate: number | null;
    linkRate: number | null;
    setupSuccessRate: number | null;
    medianSetupHours: number | null;
  };
  charts: {
    statusMix: { key: string; name: string; value: number }[];
    healthMix: { key: HealthState | "unchecked"; name: string; value: number }[];
    registrarMix: { name: string; value: number }[];
    tldMix: { name: string; value: number }[];
    renewalCalendar: { month: string; label: string; renewing: number; notRenewing: number; unknown: number; cents: number }[];
    growth: { month: string; label: string; added: number; total: number }[];
    uptimeDaily: { day: string; uptime: number | null; avgMs: number | null }[];
  };
  lists: {
    actionItems: ActionItem[];
    worstUptime: { id: string; domain: string; uptime: number; downChecks: number; lastDownAt: string | null }[];
    slowest: { id: string; domain: string; avgMs: number }[];
    sslExpiring: { id: string; domain: string; validTo: string; days: number }[];
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string, withYear: boolean) => {
  const [y, m] = key.split("-");
  return withYear ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : MONTHS[Number(m) - 1];
};
const tldOf = (domain: string) => `.${domain.split(".").slice(1).join(".")}`;
const daysUntil = (iso: string | null, now: Date) => (iso ? (Date.parse(iso) - now.getTime()) / DAY_MS : NaN);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Owned = bought or imported and still ours: not a failed purchase, not gone from the account. */
const owned = (r: AnalyticsRow) => r.status !== "failed" && r.registrar_status !== "missing";
const registered = (r: AnalyticsRow) => owned(r) && r.registrar_status !== "expired";
/** A site is expected to answer on this domain. */
const expectsSite = (r: AnalyticsRow) => registered(r) && ["live", "connected", "waiting_for_site"].includes(r.status);

export function computeDomainAnalytics(rows: AnalyticsRow[], uptime: UptimeAgg[], daily: UptimeDay[], now: Date): DomainAnalytics {
  const mine = rows.filter(owned);
  const active = mine.filter((r) => r.registrar_status === "active" || r.registrar_status === null);
  const health = (r: AnalyticsRow): HealthState | null => (r.health_state as HealthState | null) ?? null;

  const totals: DomainAnalytics["totals"] = {
    domains: mine.length,
    cloudflare: mine.filter((r) => r.registrar === "cloudflare").length,
    hostinger: mine.filter((r) => r.registrar === "hostinger").length,
    active: active.length,
    expired: mine.filter((r) => r.registrar_status === "expired").length,
    missing: rows.filter((r) => r.registrar_status === "missing").length,
    pending: mine.filter((r) => r.registrar_status === "pending").length,
    linked: mine.filter((r) => r.lead_id).length,
    unlinked: mine.filter((r) => !r.lead_id).length,
    live: mine.filter((r) => r.status === "live").length,
    connected: mine.filter((r) => r.status === "connected").length,
    unassigned: mine.filter((r) => r.status === "unassigned").length,
    inProgress: mine.filter((r) => ["purchasing", "setting_up", "waiting_for_site"].includes(r.status)).length,
    needsAttention: mine.filter((r) => r.status === "needs_attention").length,
    autoRenewOn: active.filter((r) => r.auto_renew === true).length,
    autoRenewOff: active.filter((r) => r.auto_renew === false).length,
    autoRenewUnknown: active.filter((r) => r.auto_renew === null).length,
    expiring7: active.filter((r) => daysUntil(r.expires_at, now) >= 0 && daysUntil(r.expires_at, now) <= 7).length,
    expiring30: active.filter((r) => daysUntil(r.expires_at, now) >= 0 && daysUntil(r.expires_at, now) <= 30).length,
    atRisk30: active.filter((r) => r.auto_renew !== true && renewalBucket(r.expires_at, now) !== null).length,
    sitesUp: mine.filter((r) => health(r) === "up").length,
    sitesDown: mine.filter((r) => expectsSite(r) && health(r) === "down").length,
    sslIssues: mine.filter((r) => expectsSite(r) && health(r) === "ssl_error").length,
    parked: mine.filter((r) => health(r) === "parked").length,
    noDns: mine.filter((r) => health(r) === "no_dns").length,
    unchecked: mine.filter((r) => health(r) === null).length,
  };

  // ---- money (USD; the registrars bill these accounts in USD)
  const priced = active.filter((r) => typeof r.renewal_cost_cents === "number");
  const renewing = priced.filter((r) => r.auto_renew === true);
  const charges = (days: number) =>
    renewing
      .filter((r) => {
        const d = daysUntil(r.next_billing_at ?? r.expires_at, now);
        return d >= 0 && d <= days;
      })
      .reduce((n, r) => n + (r.renewal_cost_cents ?? 0), 0);
  // Cloudflare's at-cost price per extension, read off our Cloudflare rows
  const cfPrice = new Map<string, number>();
  for (const [tld, prices] of Object.entries(
    mine
      .filter((r) => r.registrar === "cloudflare" && typeof r.renewal_cost_cents === "number")
      .reduce<Record<string, number[]>>((acc, r) => ((acc[tldOf(r.domain)] ??= []).push(r.renewal_cost_cents!), acc), {}),
  )) {
    const m = median(prices);
    if (m !== null) cfPrice.set(tld, m);
  }
  const saving = renewing
    .filter((r) => r.registrar === "hostinger")
    .map((r) => (cfPrice.has(tldOf(r.domain)) ? (r.renewal_cost_cents ?? 0) - cfPrice.get(tldOf(r.domain))! : 0))
    .filter((d) => d > 0);
  const money: DomainAnalytics["money"] = {
    currency: "USD",
    annualRenewalCents: renewing.reduce((n, r) => n + (r.renewal_cost_cents ?? 0), 0),
    annualAllCents: priced.reduce((n, r) => n + (r.renewal_cost_cents ?? 0), 0),
    next30Cents: charges(30),
    next90Cents: charges(90),
    spentCents: rows.filter((r) => r.origin === "purchased" && r.status !== "failed").reduce((n, r) => n + (r.registration_cost_cents ?? 0), 0),
    avgRenewalCents: priced.length ? Math.round(priced.reduce((n, r) => n + (r.renewal_cost_cents ?? 0), 0) / priced.length) : null,
    pricedDomains: priced.length,
    savings: { domains: saving.length, cents: saving.reduce((a, b) => a + b, 0) },
  };

  // ---- KPIs
  const counted = uptime.reduce((n, u) => n + Number(u.counted), 0);
  const ups = uptime.reduce((n, u) => n + Number(u.up), 0);
  const msWeighted = uptime.filter((u) => u.avg_ms !== null && Number(u.up) > 0);
  const msTotal = msWeighted.reduce((n, u) => n + Number(u.up), 0);
  const purchased = rows.filter((r) => r.origin === "purchased");
  const setupDone = purchased.filter((r) => r.status === "live").length;
  // a failed PURCHASE bought nothing — it isn't a setup that failed
  const setupFailed = purchased.filter((r) => r.status === "needs_attention").length;
  const setupHours = purchased
    .filter((r) => r.status === "live" && r.purchased_at && r.steps?.site?.at)
    .map((r) => (Date.parse(r.steps.site!.at) - Date.parse(r.purchased_at!)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const checkedSites = mine.filter((r) => expectsSite(r) && health(r) !== null);
  const kpis: DomainAnalytics["kpis"] = {
    uptime30: pct(ups, counted),
    avgResponseMs: msTotal ? Math.round(msWeighted.reduce((n, u) => n + Number(u.avg_ms) * Number(u.up), 0) / msTotal) : null,
    healthyRate: pct(checkedSites.filter((r) => health(r) === "up").length, checkedSites.length),
    autoRenewRate: pct(totals.autoRenewOn, totals.autoRenewOn + totals.autoRenewOff),
    linkRate: pct(totals.linked, totals.domains),
    setupSuccessRate: pct(setupDone, setupDone + setupFailed),
    medianSetupHours: setupHours.length ? Math.round(median(setupHours)! * 10) / 10 : null,
  };

  // ---- charts
  const statusMix = [
    { key: "live", name: STATUS_LABELS.live, value: totals.live },
    { key: "connected", name: STATUS_LABELS.connected, value: totals.connected },
    { key: "unassigned", name: STATUS_LABELS.unassigned, value: totals.unassigned },
    { key: "in_progress", name: "In progress", value: totals.inProgress },
    { key: "needs_attention", name: STATUS_LABELS.needs_attention, value: totals.needsAttention },
  ].filter((s) => s.value > 0);
  const healthMix = (
    [
      { key: "up", name: "Site up", value: totals.sitesUp },
      { key: "down", name: "Site down", value: mine.filter((r) => health(r) === "down").length },
      { key: "ssl_error", name: "SSL problem", value: mine.filter((r) => health(r) === "ssl_error").length },
      { key: "parked", name: "Parked", value: totals.parked },
      { key: "no_dns", name: "No DNS", value: totals.noDns },
      { key: "unchecked", name: "Not checked yet", value: totals.unchecked },
    ] as DomainAnalytics["charts"]["healthMix"]
  ).filter((s) => s.value > 0);
  const registrarMix = [
    { name: "Hostinger", value: totals.hostinger },
    { name: "Cloudflare", value: totals.cloudflare },
  ].filter((s) => s.value > 0);
  const tldCounts = mine.reduce<Record<string, number>>((acc, r) => ((acc[tldOf(r.domain)] = (acc[tldOf(r.domain)] ?? 0) + 1), acc), {});
  const tldMix = Object.entries(tldCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // renewals due per month, the next 12 months (this month first)
  const months: string[] = [];
  for (let i = 0; i < 12; i++) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))));
  const cal = new Map(months.map((m) => [m, { month: m, label: monthLabel(m, false), renewing: 0, notRenewing: 0, unknown: 0, cents: 0 }]));
  for (const r of active) {
    if (!r.expires_at) continue;
    const slot = cal.get(monthKey(new Date(r.expires_at)));
    if (!slot || daysUntil(r.expires_at, now) < 0) continue;
    if (r.auto_renew === true) {
      slot.renewing++;
      slot.cents += r.renewal_cost_cents ?? 0;
    } else if (r.auto_renew === false) slot.notRenewing++;
    else slot.unknown++;
  }
  const renewalCalendar = months.map((m) => cal.get(m)!);

  // registrations per month, the last 24 months, with the running total
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 23, 1));
  const growthMonths: string[] = [];
  for (let i = 0; i < 24; i++) growthMonths.push(monthKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))));
  const added = new Map(growthMonths.map((m) => [m, 0]));
  let base = 0;
  for (const r of mine) {
    const at = r.registered_at ?? r.purchased_at ?? r.created_at;
    if (!at) continue;
    const t = Date.parse(at);
    if (t < start.getTime()) base++;
    else {
      const k = monthKey(new Date(t));
      if (added.has(k)) added.set(k, added.get(k)! + 1);
    }
  }
  let running = base;
  const growth = growthMonths.map((m) => {
    running += added.get(m)!;
    return { month: m, label: monthLabel(m, true), added: added.get(m)!, total: running };
  });

  const uptimeDaily = daily.map((d) => ({
    day: d.day,
    uptime: Number(d.counted) > 0 ? Math.round((Number(d.up) / Number(d.counted)) * 1000) / 10 : null,
    avgMs: d.avg_ms === null ? null : Number(d.avg_ms),
  }));

  // ---- lists
  const leadName = (r: AnalyticsRow) => r.leads?.business_name ?? null;
  const items: ActionItem[] = [];
  for (const r of rows) {
    if (r.status === "failed") continue;
    const base = { id: r.id, domain: r.domain, lead: leadName(r) };
    const days = daysUntil(r.expires_at, now);
    if (r.registrar_status === "missing") {
      items.push({ ...base, kind: "missing", detail: "No longer in the registrar account (moved, transferred out or deleted)", severity: 1, when: 0 });
      continue;
    }
    if (r.registrar_status === "expired") {
      const ago = Number.isNaN(days) ? null : Math.floor(-days);
      items.push({
        ...base,
        kind: "expired",
        detail: ago === null ? "Expired" : `Expired ${ago} day${ago === 1 ? "" : "s"} ago`,
        severity: r.lead_id || r.status === "live" || r.status === "connected" ? 3 : 2,
        when: Number.isNaN(days) ? 0 : days,
      });
      continue;
    }
    if (r.auto_renew !== true && days >= 0 && days <= 30) {
      const d = Math.max(0, Math.ceil(days));
      items.push({
        ...base,
        kind: "expiring",
        detail: `Expires in ${d} day${d === 1 ? "" : "s"} — auto-renew ${r.auto_renew === false ? "is off" : "isn't confirmed"}`,
        severity: d <= 7 ? 3 : 2,
        when: days,
      });
    }
    const h = health(r);
    if (expectsSite(r) && (h === "down" || h === "ssl_error")) {
      const since = (r.health as DomainHealth)?.since ?? r.health_checked_at;
      items.push({
        ...base,
        kind: h === "down" ? "down" : "ssl",
        detail: (r.health as DomainHealth)?.summary ?? (h === "down" ? "Site down" : "SSL problem"),
        severity: 3,
        when: since ? Date.parse(since) / DAY_MS : 0,
      });
    }
    if (r.status === "needs_attention") {
      items.push({ ...base, kind: "attention", detail: r.last_error ?? "Setup stopped — retry from the domain page", severity: 2, when: 0 });
    }
  }
  items.sort((a, b) => b.severity - a.severity || a.when - b.when || a.domain.localeCompare(b.domain));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const worstUptime = uptime
    .filter((u) => Number(u.counted) >= 2 && Number(u.up) < Number(u.counted) && byId.has(u.domain_id))
    .map((u) => ({
      id: u.domain_id,
      domain: byId.get(u.domain_id)!.domain,
      uptime: Math.round((Number(u.up) / Number(u.counted)) * 1000) / 10,
      downChecks: Number(u.counted) - Number(u.up),
      lastDownAt: u.last_down_at,
    }))
    .sort((a, b) => a.uptime - b.uptime)
    .slice(0, 8);
  const slowest = uptime
    .filter((u) => u.avg_ms !== null && byId.has(u.domain_id))
    .map((u) => ({ id: u.domain_id, domain: byId.get(u.domain_id)!.domain, avgMs: Number(u.avg_ms) }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 8);
  const sslExpiring = mine
    .map((r) => ({ r, validTo: (r.health as DomainHealth)?.ssl?.valid_to ?? null }))
    .filter((x): x is { r: AnalyticsRow; validTo: string } => Boolean(x.validTo) && daysUntil(x.validTo, now) <= 14)
    .map(({ r, validTo }) => ({ id: r.id, domain: r.domain, validTo, days: Math.floor(daysUntil(validTo, now)) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, 8);

  return {
    generatedAt: now.toISOString(),
    totals,
    money,
    kpis,
    charts: { statusMix, healthMix, registrarMix, tldMix, renewalCalendar, growth, uptimeDaily },
    lists: { actionItems: items.slice(0, 40), worstUptime, slowest, sslExpiring },
  };
}
