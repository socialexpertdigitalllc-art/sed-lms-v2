"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Globe, Link2, Loader2, RefreshCw, RotateCw, Search, ShoppingCart, Unlink } from "lucide-react";
import { EmptyPanel, PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import {
  AutoRenewLabel,
  DomainStatusPill,
  ExpiryLabel,
  HealthDot,
  RegistrationPill,
  daysLeft,
  isWorking,
  money,
} from "@/components/domains/DomainBits";
import { BuyDomainDialog } from "@/components/domains/BuyDomainDialog";
import { PickLeadDialog } from "@/components/domains/PickDialogs";
import type { ClientDomainRow, DomainHealth } from "@/lib/domains/types";

type Row = ClientDomainRow & { leads?: { business_name: string } | null };

const EXPIRING_DAYS = 30;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "expired", label: "Expired" },
  { id: "expiring", label: "Expiring soon" },
  { id: "renew", label: "Auto-renew off" },
  { id: "down", label: "Site down" },
  { id: "free", label: "Unlinked" },
  { id: "working", label: "In progress" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

/** Still registered, but expires within EXPIRING_DAYS and isn't set to renew. */
function expiringSoon(r: Row, now: number): boolean {
  const d = daysLeft(r.expires_at, now);
  return r.registrar_status !== "expired" && r.registrar_status !== "missing" && d !== null && d >= 0 && d <= EXPIRING_DAYS && r.auto_renew !== true && r.status !== "failed";
}
const siteDown = (r: Row) =>
  (r.health_state === "down" || r.health_state === "ssl_error") &&
  ["live", "connected", "waiting_for_site"].includes(r.status) &&
  r.registrar_status !== "expired";

/**
 * Every client domain we own — on Cloudflare (default) or Hostinger — with its
 * lead, setup state, site health, expiry and auto-renew. Sync brings the
 * registrars' changes in (it also runs by itself every six hours); a domain's
 * own page manages everything else.
 */
export function DomainsBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [now, setNow] = useState(0);
  const [meta, setMeta] = useState({ canManage: false, canPurchase: false, sandbox: false, cloudflareConfigured: true, hostingerConfigured: true });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<Row | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/domains");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: j.error ?? "Could not load domains" });
      setRows([]);
      return;
    }
    setRows(j.domains as Row[]);
    setNow(Date.now());
    setMeta({
      canManage: j.canManage,
      canPurchase: j.canPurchase,
      sandbox: j.sandbox,
      cloudflareConfigured: j.cloudflareConfigured,
      hostingerConfigured: j.hostingerConfigured,
    });
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // keep in-progress rows fresh
  useEffect(() => {
    if (!rows?.some((r) => isWorking(r.status))) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [rows, load]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      expired: all.filter((r) => r.registrar_status === "expired").length,
      expiring: all.filter((r) => expiringSoon(r, now)).length,
      renewOff: all.filter((r) => r.auto_renew === false && r.registrar_status === "active" && r.status !== "failed").length,
      down: all.filter(siteDown).length,
      attention: all.filter((r) => r.status === "needs_attention" || r.status === "failed").length,
    };
  }, [rows, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows ?? []).filter((r) => {
      if (q && !r.domain.includes(q) && !(r.leads?.business_name ?? "").toLowerCase().includes(q)) return false;
      switch (filter) {
        case "attention":
          return r.status === "needs_attention" || r.status === "failed" || siteDown(r);
        case "expired":
          return r.registrar_status === "expired";
        case "expiring":
          return expiringSoon(r, now);
        case "renew":
          return r.auto_renew === false && r.registrar_status === "active" && r.status !== "failed";
        case "down":
          return siteDown(r);
        case "free":
          return !r.lead_id && r.status !== "failed" && r.registrar_status !== "missing";
        case "working":
          return isWorking(r.status) || r.status === "waiting_for_site";
        default:
          return true;
      }
    });
    // renewal views read best soonest-first
    if (filter === "expired" || filter === "expiring" || filter === "renew") {
      list.sort((a, b) => Date.parse(a.expires_at ?? "9999") - Date.parse(b.expires_at ?? "9999"));
    }
    return list;
  }, [rows, filter, query, now]);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/domains/sync", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Sync failed" });
      else {
        type Part = { added?: number; error?: string } | null;
        const parts: [string, Part][] = [["Hostinger", j.hostinger], ["Cloudflare", j.cloudflare]];
        const failed = parts.flatMap(([name, p]) => (p?.error ? [`${name}: ${p.error}`] : []));
        toast({
          kind: failed.length ? "error" : "success",
          title: j.added ? `Synced — ${j.added} new domain${j.added === 1 ? "" : "s"}` : "Synced with the registrars",
          body:
            `${j.refreshed} updated` +
            (j.added ? `, ${j.connected} already set up by hand, ${j.unassigned} not in use, ${j.linked} linked to their lead` : "") +
            (j.missing ? `, ${j.missing} no longer in the account` : "") +
            "." +
            (failed.length ? ` ${failed.join(" ")}` : ""),
        });
        await load();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function act(row: Row, path: string, init: RequestInit, okTitle: string) {
    setBusy(row.id);
    try {
      const res = await fetch(path, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Failed" });
      else {
        toast({ kind: "success", title: okTitle });
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: unknown): RequestInit => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const banners = [
    counts.expired ? { key: "expired" as Filter, tone: "dropped", text: `${counts.expired} domain${counts.expired === 1 ? " has" : "s have"} expired.` } : null,
    counts.expiring
      ? { key: "expiring" as Filter, tone: "notready", text: `${counts.expiring} domain${counts.expiring === 1 ? " expires" : "s expire"} within ${EXPIRING_DAYS} days and ${counts.expiring === 1 ? "isn't" : "aren't"} set to renew.` }
      : null,
    counts.down ? { key: "down" as Filter, tone: "dropped", text: `${counts.down} client site${counts.down === 1 ? " is" : "s are"} down or ${counts.down === 1 ? "has" : "have"} an SSL problem.` } : null,
  ].filter((b): b is { key: Filter; tone: string; text: string } => b !== null);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Domains"
        description="Every client domain on Hostinger and Cloudflare — kept in sync with the registrars and checked for site health automatically. Open a domain to renew it, change its DNS or registrar settings, or hand it over."
        action={
          <div className="flex gap-2">
            {meta.canManage ? (
              <button
                type="button"
                className={btnSecondary}
                onClick={syncNow}
                disabled={syncing || !meta.hostingerConfigured}
                title="Read the latest from Hostinger and Cloudflare now (runs by itself every six hours)"
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now
              </button>
            ) : null}
            {meta.canPurchase ? (
              <button type="button" className={btnPrimary} onClick={() => setBuyOpen(true)}>
                <ShoppingCart className="h-4 w-4" /> Buy a domain
              </button>
            ) : null}
          </div>
        }
      />

      {!meta.cloudflareConfigured ? (
        <p className="rounded-md border border-notready-fg/30 bg-notready-bg p-3 text-sm text-notready-fg">
          Cloudflare is not configured on this server (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).
        </p>
      ) : null}
      {banners.map((b) => (
        <p
          key={b.key}
          className={cn(
            "flex items-center gap-2 rounded-md border p-3 text-sm",
            b.tone === "dropped" ? "border-dropped-fg/30 bg-dropped-bg text-dropped-fg" : "border-notready-fg/30 bg-notready-bg text-notready-fg",
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {b.text}
          <button type="button" className="underline" onClick={() => setFilter(b.key)}>
            Show
          </button>
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = f.id === "expired" ? counts.expired : f.id === "expiring" ? counts.expiring : f.id === "renew" ? counts.renewOff : f.id === "down" ? counts.down : null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                filter === f.id ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-text-muted hover:bg-surface-2",
              )}
            >
              {f.label}
              {n ? <span className="ml-1 font-mono">{n}</span> : null}
            </button>
          );
        })}
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input className={cn(inputCls, "pl-8")} placeholder="Domain or lead…" aria-label="Search domains" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {rows === null ? (
        <div className="grid place-items-center p-12 text-text-faint">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyPanel
          icon={Globe}
          title={rows.length === 0 ? "No domains yet" : "Nothing matches"}
          hint={rows.length === 0 ? (meta.canManage ? "Sync to bring in the domains on Hostinger and Cloudflare, or buy a new one." : "An admin can sync or buy domains.") : "Try another filter."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Registrar</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Auto-renew</th>
                <th className="px-3 py-2">Renews at</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const rowBusy = busy === r.id;
                const health = r.health_state ? (r.health as DomainHealth) : null;
                return (
                  <tr key={r.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <Link href={`/domains/${r.id}`} className="font-medium text-accent-ink hover:underline">
                          {r.domain}
                        </Link>
                        <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" title="Open the site" aria-label={`Open ${r.domain}`} className="text-text-faint hover:text-text">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.lead_id ? (
                        <Link href={`/leads/${r.lead_id}`} className="text-text hover:underline">
                          {r.leads?.business_name ?? "Lead"}
                        </Link>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <DomainStatusPill status={r.status} />
                        <RegistrationPill status={r.registrar_status} />
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <HealthDot state={r.health_state} summary={health?.summary} />
                    </td>
                    <td className="px-3 py-2 text-text-muted">{r.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                      <ExpiryLabel row={r} now={now} />
                    </td>
                    <td className="px-3 py-2">
                      <AutoRenewLabel value={r.registrar_status === "expired" ? null : r.auto_renew} />
                    </td>
                    <td className="px-3 py-2 text-text-muted">{r.renewal_cost_cents ? `${money(r.renewal_cost_cents, r.currency ?? "USD")}/yr` : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1">
                        {rowBusy ? <Loader2 className="h-4 w-4 animate-spin text-text-faint" /> : null}
                        {meta.canManage && !r.lead_id && (r.status === "unassigned" || r.status === "connected") && r.registrar_status !== "missing" ? (
                          <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => setLinkFor(r)}>
                            <Link2 className="h-3.5 w-3.5" /> Link lead
                          </button>
                        ) : null}
                        {meta.canManage && (r.status === "needs_attention" || r.status === "waiting_for_site") ? (
                          <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => void act(r, `/api/domains/${r.id}/retry`, { method: "POST" }, `Retrying ${r.domain}`)}>
                            <RotateCw className="h-3.5 w-3.5" /> {r.status === "waiting_for_site" ? "Check" : "Retry"}
                          </button>
                        ) : null}
                        {meta.canManage && r.auto_renew === false && r.registrar_status === "active" && r.status !== "failed" ? (
                          <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => void act(r, `/api/domains/${r.id}`, patch({ autoRenew: true }), `Auto-renew on for ${r.domain}`)}>
                            Turn on auto-renew
                          </button>
                        ) : null}
                        {meta.canManage && r.lead_id && r.status !== "purchasing" ? (
                          <button
                            type="button"
                            className={btnGhostSm}
                            disabled={rowBusy}
                            title="Unlink from the lead"
                            aria-label={`Unlink ${r.domain} from its lead`}
                            onClick={() => void act(r, `/api/domains/${r.id}`, patch({ leadId: null }), `${r.domain} unlinked`)}
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <Link href={`/domains/${r.id}`} className={btnGhostSm}>
                          Manage
                        </Link>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {buyOpen ? (
        <BuyDomainDialog leadId={null} leadName={null} initialQuery="" sandbox={meta.sandbox} onClose={() => setBuyOpen(false)} onBought={() => void load()} />
      ) : null}
      {linkFor ? <PickLeadDialog domain={linkFor} onClose={() => setLinkFor(null)} onLinked={() => void load()} /> : null}
    </div>
  );
}
