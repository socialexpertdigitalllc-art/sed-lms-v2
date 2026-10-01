"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Network, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { btnGhostSm, btnSecondarySm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { useDomainCall } from "@/components/domains/DomainControls";
import type { DnsInput, DnsListing, DnsRow } from "@/lib/domains/manage";
import type { HostingerDnsSnapshot } from "@/lib/hostinger/client";
import type { DomainRegistrar } from "@/lib/domains/types";

const TYPES_HOSTINGER = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "CAA"];
const TYPES_CLOUDFLARE = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA"];
const TTLS_HOSTINGER = [300, 3600, 14400, 86400];
const TTLS_CLOUDFLARE = [1, 300, 3600, 14400, 86400];
const ttlLabel = (t: number) => (t === 1 ? "Auto" : t < 3600 ? `${t / 60} min` : t < 86400 ? `${t / 3600} h` : `${t / 86400} d`);

type Draft = DnsInput & { original: DnsRow | null };

const blank = (registrar: DomainRegistrar): Draft => ({
  original: null,
  type: "A",
  name: "@",
  content: "",
  ttl: registrar === "cloudflare" ? 1 : 14400,
  priority: 10,
  proxied: false,
});

/** The records that carry the site itself — editing them can take it offline. */
const carriesSite = (d: { name: string; type: string }) => ["@", "www"].includes(d.name) && ["A", "AAAA", "CNAME", "ALIAS"].includes(d.type);

/**
 * The domain's DNS records, live from its registrar — add, change and delete,
 * plus (Hostinger) back to defaults and restore an earlier version.
 */
export function DomainDnsPanel({ domainId, domain, registrar, canManage }: { domainId: string; domain: string; registrar: DomainRegistrar; canManage: boolean }) {
  const { call, busy } = useDomainCall();
  const [dns, setDns] = useState<DnsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<HostingerDnsSnapshot[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch(`/api/domains/${domainId}/dns`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error ?? "Could not read the DNS records");
    else setDns(j.dns as DnsListing);
  }, [domainId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function save() {
    if (!draft) return;
    const { original, ...next } = draft;
    if (carriesSite(next) || (original && carriesSite(original))) {
      if (!confirm(`This record carries ${domain}'s website. A wrong value takes the site offline. Save it?`)) return;
    }
    const r = await call("save", `/api/domains/${domainId}/dns`, { method: "POST", body: { original, next } }, { title: original ? "Record updated" : "Record added" });
    if (r.ok) {
      setDraft(null);
      await load();
    }
  }

  async function remove(row: DnsRow) {
    if (!confirm(`Delete the ${row.type} record ${row.name} → ${row.content}?${carriesSite(row) ? " It carries the website — the site may go offline." : ""}`)) return;
    const r = await call(`del:${row.id}`, `/api/domains/${domainId}/dns`, { method: "POST", body: { original: row, next: null } }, { title: "Record deleted" });
    if (r.ok) await load();
  }

  async function reset() {
    if (!confirm(`Put ${domain}'s DNS back to Hostinger's defaults? Custom records are replaced; email (MX/TXT) records are kept.`)) return;
    const r = await call("reset", `/api/domains/${domainId}/dns/reset`, { method: "POST" }, { title: "DNS reset to Hostinger's defaults" });
    if (r.ok) await load();
  }

  async function openHistory() {
    setHistoryOpen((o) => !o);
    if (history) return;
    const r = await call<{ snapshots: HostingerDnsSnapshot[] }>("history", `/api/domains/${domainId}/dns/snapshots`, { method: "GET" });
    if (r.ok) setHistory(r.data.snapshots);
  }

  async function restore(s: HostingerDnsSnapshot) {
    if (!confirm(`Put the DNS back as it was on ${new Date(s.created_at).toLocaleString()}? Today's records are replaced.`)) return;
    const r = await call(`restore:${s.id}`, `/api/domains/${domainId}/dns/snapshots`, { method: "POST", body: { snapshotId: s.id } }, { title: "DNS restored" });
    if (r.ok) await load();
  }

  const types = registrar === "cloudflare" ? TYPES_CLOUDFLARE : TYPES_HOSTINGER;
  const ttls = registrar === "cloudflare" ? TTLS_CLOUDFLARE : TTLS_HOSTINGER;
  const rows = [...(dns?.rows ?? [])].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  return (
    <Panel
      icon={Network}
      title="DNS records"
      description={`Live from ${registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}. Changes take effect within minutes.`}
      count={dns ? dns.rows.length : undefined}
      flush
      action={
        canManage && dns ? (
          <>
            {dns.supportsSnapshots ? (
              <button type="button" className={btnGhostSm} onClick={() => void openHistory()}>
                <History className="h-3.5 w-3.5" /> History
              </button>
            ) : null}
            {dns.supportsReset ? (
              <button type="button" className={btnGhostSm} onClick={() => void reset()} disabled={busy === "reset"}>
                <RotateCcw className="h-3.5 w-3.5" /> Defaults
              </button>
            ) : null}
            <button type="button" className={btnSecondarySm} onClick={() => setDraft(blank(registrar))}>
              <Plus className="h-3.5 w-3.5" /> Add record
            </button>
          </>
        ) : null
      }
    >
      {error ? (
        <p className="p-4 text-sm text-dropped-fg">{error}</p>
      ) : !dns ? (
        <div className="grid place-items-center p-8 text-text-faint">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {historyOpen ? (
            <div className="border-b border-border-subtle bg-surface-2/50 p-4">
              <p className="mb-2 text-xs font-semibold text-text">Earlier versions (Hostinger keeps them)</p>
              {!history ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-faint" />
              ) : history.length === 0 ? (
                <p className="text-xs text-text-muted">No earlier versions.</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {history.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-text-muted">
                        {new Date(s.created_at).toLocaleString()} — {s.reason}
                      </span>
                      <button type="button" className={btnGhostSm} disabled={busy === `restore:${s.id}`} onClick={() => void restore(s)}>
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {draft ? (
            <div className="space-y-3 border-b border-border-subtle bg-accent-soft/30 p-4">
              <p className="text-xs font-semibold text-text">{draft.original ? "Edit record" : "New record"}</p>
              <div className="grid gap-2 sm:grid-cols-[110px_1fr_2fr_110px]">
                <select className={inputCls} aria-label="Type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <input className={inputCls} aria-label="Name" placeholder="@ or www" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <input
                  className={inputCls}
                  aria-label="Content"
                  placeholder={draft.type === "A" ? "IPv4 address" : draft.type === "TXT" ? "Text value" : "Target host"}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
                <select className={inputCls} aria-label="TTL" value={draft.ttl} onChange={(e) => setDraft({ ...draft, ttl: Number(e.target.value) })}>
                  {ttls.map((t) => (
                    <option key={t} value={t}>
                      {ttlLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
                {draft.type === "MX" ? (
                  <label className="inline-flex items-center gap-2">
                    Priority
                    <input
                      type="number"
                      min={0}
                      max={65535}
                      className={cn(inputCls, "w-24")}
                      value={draft.priority ?? 10}
                      onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                    />
                  </label>
                ) : null}
                {registrar === "cloudflare" && ["A", "AAAA", "CNAME"].includes(draft.type) ? (
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(draft.proxied)} onChange={(e) => setDraft({ ...draft, proxied: e.target.checked })} />
                    Proxied through Cloudflare (keep off for sites on Hostinger — SSL needs it off)
                  </label>
                ) : null}
                {carriesSite(draft) ? <span className="font-medium text-notready-fg">This record carries the website.</span> : null}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className={btnGhostSm} onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button type="button" className={btnSecondarySm} onClick={() => void save()} disabled={busy === "save" || !draft.content.trim()}>
                  {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
                </button>
              </div>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">No records.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-text-muted">
                  <tr>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Content</th>
                    <th className="px-4 py-2">TTL</th>
                    {dns.supportsProxy ? <th className="px-4 py-2">Proxy</th> : null}
                    {canManage ? <th className="px-4 py-2 text-right">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{r.type}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.name}</td>
                      <td className="max-w-md px-4 py-2 font-mono text-xs">
                        <span className="break-all">
                          {r.priority !== null ? <span className="text-text-faint">{r.priority} </span> : null}
                          {r.content}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-text-muted">{ttlLabel(r.ttl)}</td>
                      {dns.supportsProxy ? <td className="px-4 py-2 text-xs text-text-muted">{r.proxied === null ? "—" : r.proxied ? "On" : "Off"}</td> : null}
                      {canManage ? (
                        <td className="px-4 py-2 text-right">
                          {r.editable ? (
                            <span className="inline-flex gap-1">
                              <button
                                type="button"
                                className={iconBtn}
                                title="Edit"
                                aria-label={`Edit ${r.type} ${r.name}`}
                                onClick={() => setDraft({ original: r, type: r.type, name: r.name, content: r.content, ttl: r.ttl, priority: r.priority, proxied: r.proxied })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className={iconBtnDanger}
                                title="Delete"
                                aria-label={`Delete ${r.type} ${r.name}`}
                                disabled={busy === `del:${r.id}`}
                                onClick={() => void remove(r)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ) : (
                            <span className="text-xs text-text-faint">managed by {registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
