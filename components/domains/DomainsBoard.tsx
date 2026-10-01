"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, DownloadCloud, ExternalLink, Globe, Link2, Loader2, RotateCw, Search, ShoppingCart, Unlink } from "lucide-react";
import { EmptyPanel, PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { DomainStatusPill, DomainSteps, isWorking, money } from "@/components/domains/DomainBits";
import { BuyDomainDialog } from "@/components/domains/BuyDomainDialog";
import { PickLeadDialog } from "@/components/domains/PickDialogs";
import type { ClientDomainRow } from "@/lib/domains/types";

type Row = ClientDomainRow & { leads?: { business_name: string } | null };

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "working", label: "In progress" },
  { id: "free", label: "Unlinked" },
  { id: "renew", label: "Auto-renew off" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

/**
 * Every client domain we own — on Cloudflare (default) or Hostinger — with its
 * lead, setup state, expiry and auto-renew. Import pulls the Cloudflare
 * account's domains in; Buy finds and purchases a new one.
 */
export function DomainsBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState({ canManage: false, canPurchase: false, sandbox: false, cloudflareConfigured: true });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [linkFor, setLinkFor] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
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
    setMeta({ canManage: j.canManage, canPurchase: j.canPurchase, sandbox: j.sandbox, cloudflareConfigured: j.cloudflareConfigured });
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (q && !r.domain.includes(q) && !(r.leads?.business_name ?? "").toLowerCase().includes(q)) return false;
      switch (filter) {
        case "attention":
          return r.status === "needs_attention" || r.status === "failed";
        case "working":
          return isWorking(r.status) || r.status === "waiting_for_site";
        case "free":
          return !r.lead_id && r.status !== "failed";
        case "renew":
          return r.auto_renew === false;
        default:
          return true;
      }
    });
  }, [rows, filter, query]);

  const renewOff = (rows ?? []).filter((r) => r.auto_renew === false && r.status !== "failed").length;

  async function importNow() {
    setImporting(true);
    try {
      const res = await fetch("/api/domains/import", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Import failed" });
      else {
        toast({
          kind: "success",
          title: `Imported ${j.added} new domain${j.added === 1 ? "" : "s"} from Cloudflare`,
          body:
            `${j.connected} already set up by hand (left as they are), ${j.unassigned} not hosted yet, ${j.linked} linked to their lead.` +
            (j.refreshed ? ` ${j.refreshed} existing refreshed.` : ""),
        });
        await load();
      }
    } finally {
      setImporting(false);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Domains"
        description="Client domains on Cloudflare (default) and Hostinger. Link one to a lead and the dashboard connects DNS, hosting and SSL, then puts the lead's site live on it."
        action={
          <div className="flex gap-2">
            {meta.canManage ? (
              <button type="button" className={btnSecondary} onClick={importNow} disabled={importing || !meta.cloudflareConfigured}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />} Import from Cloudflare
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
      {renewOff > 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-notready-fg/30 bg-notready-bg p-3 text-sm text-notready-fg">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {renewOff} domain{renewOff === 1 ? " has" : "s have"} auto-renew turned off and will expire unless renewed.
          <button type="button" className="underline" onClick={() => setFilter("renew")}>Show</button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn("rounded-full border px-3 py-1 text-xs", filter === f.id ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-text-muted hover:bg-surface-2")}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input className={cn(inputCls, "pl-8")} placeholder="Domain or lead…" aria-label="Search domains" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {rows === null ? (
        <div className="grid place-items-center p-12 text-text-faint"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <EmptyPanel
          icon={Globe}
          title={rows.length === 0 ? "No domains yet" : "Nothing matches"}
          hint={rows.length === 0 ? (meta.canManage ? "Import your Cloudflare domains, or buy a new one." : "An admin can import or buy domains.") : "Try another filter."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-text-muted">
              <tr>
                <th className="w-6 px-3 py-2" />
                <th className="px-3 py-2">Domain</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Registrar</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Renews at</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const expanded = open === r.id;
                const rowBusy = busy === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                      <td className="px-3 py-2">
                        <button type="button" aria-label={expanded ? "Hide steps" : "Show steps"} onClick={() => setOpen(expanded ? null : r.id)} className="text-text-faint hover:text-text">
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline">
                          {r.domain} <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        {r.lead_id ? (
                          <Link href={`/leads/${r.lead_id}`} className="text-text hover:underline">{r.leads?.business_name ?? "Lead"}</Link>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><DomainStatusPill status={r.status} /></td>
                      <td className="px-3 py-2 text-text-muted">{r.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}</td>
                      <td className="px-3 py-2 text-text-muted">
                        {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}
                        {r.auto_renew === false ? <span className="ml-1 text-xs font-semibold text-notready-fg">auto-renew off</span> : null}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{r.renewal_cost_cents ? `${money(r.renewal_cost_cents, r.currency ?? "USD")}/yr` : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center gap-1">
                          {rowBusy ? <Loader2 className="h-4 w-4 animate-spin text-text-faint" /> : null}
                          {meta.canManage && !r.lead_id && (r.status === "unassigned" || r.status === "connected") ? (
                            <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => setLinkFor(r)}>
                              <Link2 className="h-3.5 w-3.5" /> Link lead
                            </button>
                          ) : null}
                          {meta.canManage && (r.status === "needs_attention" || r.status === "waiting_for_site") ? (
                            <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => void act(r, `/api/domains/${r.id}/retry`, { method: "POST" }, `Retrying ${r.domain}`)}>
                              <RotateCw className="h-3.5 w-3.5" /> {r.status === "waiting_for_site" ? "Check" : "Retry"}
                            </button>
                          ) : null}
                          {meta.canManage && r.auto_renew === false && r.status !== "failed" ? (
                            <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => void act(r, `/api/domains/${r.id}`, patch({ autoRenew: true }), `Auto-renew on for ${r.domain}`)}>
                              Turn on auto-renew
                            </button>
                          ) : null}
                          {meta.canManage && r.lead_id && r.status !== "purchasing" ? (
                            <button type="button" className={btnGhostSm} disabled={rowBusy} onClick={() => void act(r, `/api/domains/${r.id}`, patch({ leadId: null }), `${r.domain} unlinked`)}>
                              <Unlink className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-border-subtle bg-surface-2/40">
                        <td />
                        <td colSpan={7} className="px-3 py-3">
                          {r.status === "connected" ? (
                            <p className="text-xs text-text-muted">Set up by hand before the dashboard managed domains — hosting {r.hosting_username ?? "on Hostinger"}; nothing for the dashboard to do.</p>
                          ) : r.status === "unassigned" ? (
                            <p className="text-xs text-text-muted">Not linked to a lead. Linking it starts the automatic setup.</p>
                          ) : (
                            <DomainSteps row={r} />
                          )}
                          {r.last_error && (r.status === "needs_attention" || r.status === "failed") ? (
                            <p className="mt-2 rounded-md bg-dropped-bg p-2 text-xs text-dropped-fg">{r.last_error}</p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
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
