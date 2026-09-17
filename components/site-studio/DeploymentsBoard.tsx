"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Globe,
  History,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Upload,
} from "lucide-react";
import { DownloadSiteFilesButton } from "@/components/common/DownloadSiteFilesButton";
import { EmptyPanel, PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";
import { iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { TransferDeploymentModal } from "@/components/site-studio/TransferDeploymentModal";
import { UploadModal, type UploadResult } from "@/components/site-studio/board/UploadModal";
import { LinkLeadModal } from "@/components/site-studio/board/LinkLeadModal";
import { SnapshotsModal } from "@/components/site-studio/board/SnapshotsModal";
import { cn } from "@/lib/utils";

export interface BoardRow {
  id: string | null;
  subdomain: string | null;
  url: string;
  status: "live" | "taken_down" | "failed" | "untracked";
  origin: string | null;
  category: "ready" | "manual" | "live" | "other";
  leadId: string | null;
  leadName: string | null;
  leadStatus: string | null;
  deployedAt: string | null;
  isCustomDomain: boolean;
  /** Company infrastructure (PROTECTED_DOMAINS) — destructive actions hidden. */
  protected?: boolean;
}

type View = "all" | "ready" | "manual" | "other" | "live";

const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "manual", label: "Manual" },
  { id: "other", label: "Others" },
  { id: "live", label: "Live Websites" },
];

const STATUS_TONE: Record<BoardRow["status"], PillTone> = {
  live: "ready",
  taken_down: "neutral",
  failed: "dropped",
  untracked: "neutral",
};

type Counts = Partial<Record<View, number>>;

/**
 * The unified deployments board — every staging subdomain and custom domain on
 * the hosting, tracked or not, categorized Ready / Manual / Others / Live.
 * Actions: upload (new / override / new version), shuffle to a fresh
 * subdomain, link to a lead, transfer to a custom domain, bulk delete.
 */
export function DeploymentsBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [daDomain, setDaDomain] = useState("dmviral.com");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [syncing, setSyncing] = useState(false);

  const [uploadOpen, setUploadOpen] = useState<{ target?: string | null } | null>(null);
  const [linkFor, setLinkFor] = useState<{ deploymentId: string | null; subdomain: string | null; url: string; optional?: boolean } | null>(null);
  const [transferRow, setTransferRow] = useState<{ id: string; name: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmShuffle, setConfirmShuffle] = useState<BoardRow | null>(null);
  const [confirmTakedown, setConfirmTakedown] = useState<BoardRow | null>(null);
  const [confirmRecord, setConfirmRecord] = useState<BoardRow | null>(null);
  const [confirmBulk, setConfirmBulk] = useState<string[] | null>(null);
  const overrideInput = useRef<HTMLInputElement>(null);
  const overrideRowRef = useRef<BoardRow | null>(null);

  const fetchBoard = useCallback(async (v: View, fast: boolean) => {
    const res = await fetch(`/api/site-studio/deployments?view=${v}${fast ? "&fast=1" : ""}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Could not load deployments");
    return body as {
      rows?: BoardRow[];
      counts?: Counts;
      daDomain?: string;
      hostingWarning?: string | null;
    };
  }, []);

  /**
   * Two-phase load: tracked DB rows paint immediately (fast=1 skips the
   * hosting round-trips), then the hosting-merged truth replaces them. The
   * server caches the hosting inventory for 60s, so only a cold load pays
   * the slow DirectAdmin listing.
   */
  const load = useCallback(
    async (opts?: { view?: View; skipFastPhase?: boolean }) => {
      const v = opts?.view ?? view;
      setLoading(true);
      try {
        if (!opts?.skipFastPhase) {
          const quick = await fetchBoard(v, true);
          setRows((quick.rows ?? []) as BoardRow[]);
          if (quick.daDomain) setDaDomain(quick.daDomain);
          setLoading(false);
          setSyncing(true);
        }
        const full = await fetchBoard(v, false);
        setRows((full.rows ?? []) as BoardRow[]);
        setCounts((full.counts ?? {}) as Counts);
        if (full.daDomain) setDaDomain(full.daDomain);
        if (full.hostingWarning) toast({ kind: "info", title: full.hostingWarning });
        setSelected(new Set());
      } catch (e) {
        toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load deployments" });
      } finally {
        setLoading(false);
        setSyncing(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [toast, view, fetchBoard],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeView(next: View) {
    setView(next);
    setPage(0);
    void load({ view: next });
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.subdomain ?? "").includes(needle) ||
        r.url.toLowerCase().includes(needle) ||
        (r.leadName ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  // Selection spans the whole filtered view (all pages), so "select all" +
  // bulk delete works as a cleanup tool on hundreds of stale subdomains.
  const selectable = useMemo(() => visible.filter((r) => r.subdomain && !r.isCustomDomain), [visible]);

  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => visible.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [visible, safePage, pageSize],
  );

  function toggleSelect(sub: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sub)) next.delete(sub);
      else next.add(sub);
      return next;
    });
  }

  async function api(path: string, init: RequestInit, okTitle: string): Promise<boolean> {
    try {
      const res = await fetch(path, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Action failed" });
        return false;
      }
      toast({ kind: "success", title: okTitle });
      await load();
      return true;
    } catch {
      toast({ kind: "error", title: "Network error — try again" });
      return false;
    }
  }

  async function shuffle(row: BoardRow) {
    setConfirmShuffle(null);
    if (!row.id) return;
    setBusyKey(row.id);
    try {
      const res = await fetch(`/api/site-studio/deployments/${row.id}/shuffle`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: body.error ?? "Shuffle failed" });
      else
        toast({
          kind: "success",
          title: `Now live at ${String(body.url ?? "").replace(/^https?:\/\//, "")}`,
          body: body.oldDeleted ? "Old subdomain removed and the lead's link updated." : "Old subdomain could not be removed — check manually.",
        });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function takedown(row: BoardRow) {
    setConfirmTakedown(null);
    if (!row.id) return;
    setBusyKey(row.id);
    await api(`/api/site-studio/deployments/${row.id}`, { method: "DELETE" }, `${row.leadName ?? row.subdomain ?? "Site"} was taken down`);
    setBusyKey(null);
  }

  async function deleteRecord(row: BoardRow) {
    setConfirmRecord(null);
    if (!row.id) return;
    setBusyKey(row.id);
    await api(`/api/site-studio/deployments/${row.id}?mode=record`, { method: "DELETE" }, "Deployment record deleted");
    setBusyKey(null);
  }

  async function bulkDelete(subs: string[]) {
    setConfirmBulk(null);
    setBusyKey("bulk");
    try {
      // The route caps a batch at 50 — chunk sequentially so a full-view
      // cleanup of hundreds of stale subdomains works in one click.
      const failed: string[] = [];
      let deleted = 0;
      for (let i = 0; i < subs.length; i += 50) {
        const chunk = subs.slice(i, i + 50);
        const res = await fetch("/api/site-studio/deployments/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomains: chunk }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ kind: "error", title: body.error ?? "Delete failed", body: `${deleted} deleted before the error.` });
          await load();
          return;
        }
        for (const r of (body.results ?? []) as { ok: boolean; subdomain: string }[]) {
          if (r.ok) deleted++;
          else failed.push(r.subdomain);
        }
      }
      toast(
        failed.length
          ? { kind: "error", title: `${deleted} deleted, ${failed.length} failed`, body: failed.slice(0, 10).join(", ") + (failed.length > 10 ? ` +${failed.length - 10} more` : "") }
          : { kind: "success", title: `${deleted} subdomain${deleted === 1 ? "" : "s"} deleted` },
      );
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  async function transfer(row: BoardRow) {
    // transfer is id-keyed — adopt untracked subdomains first
    if (row.id) {
      setTransferRow({ id: row.id, name: row.leadName ?? row.subdomain ?? row.url });
      return;
    }
    if (!row.subdomain) return;
    setBusyKey(row.subdomain);
    try {
      const res = await fetch("/api/site-studio/deployments/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: row.subdomain }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: body.error ?? "Could not track this subdomain" });
      else setTransferRow({ id: body.deploymentId, name: row.subdomain });
    } finally {
      setBusyKey(null);
    }
  }

  /** Track an untracked custom domain so id-keyed actions can run on it. */
  async function adoptDomainRow(row: BoardRow): Promise<BoardRow | null> {
    const domain = row.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    setBusyKey(row.url);
    try {
      const res = await fetch("/api/site-studio/deployments/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not track this domain" });
        return null;
      }
      return { ...row, id: body.deploymentId as string, status: "live" };
    } catch {
      toast({ kind: "error", title: "Network error — try again" });
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  async function overrideCustom(row: BoardRow) {
    let target = row;
    if (!target.id && target.isCustomDomain) {
      const adopted = await adoptDomainRow(target);
      if (!adopted) return;
      target = adopted;
    }
    overrideRowRef.current = target;
    overrideInput.current?.click();
  }

  async function takedownCustom(row: BoardRow) {
    let target = row;
    if (!target.id && target.isCustomDomain) {
      const adopted = await adoptDomainRow(target);
      if (!adopted) return;
      target = adopted;
    }
    setConfirmTakedown(target);
  }

  async function onOverrideFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const row = overrideRowRef.current;
    if (!file || !row?.id) return;
    setBusyKey(row.id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/site-studio/deployments/${row.id}/upload`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: body.error ?? "Override failed" });
      else toast({ kind: "success", title: `${row.url.replace(/^https?:\/\//, "")} updated` });
      await load();
    } finally {
      setBusyKey(null);
    }
  }

  function onUploaded(result: UploadResult) {
    void load();
    if (result.deploymentId && !result.leadId) {
      setLinkFor({ deploymentId: result.deploymentId, subdomain: result.subdomain, url: result.url, optional: true });
    }
  }

  const empty = !loading && visible.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Every site on the hosting — generated, manual and custom-domain — in one board."
        action={
          <button
            type="button"
            onClick={() => setUploadOpen({})}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-ink"
          >
            <Upload className="h-4 w-4" /> Upload site
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => changeView(v.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                view === v.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {v.label}
              {typeof counts[v.id] === "number" ? ` (${counts[v.id]})` : ""}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "pl-8")}
            placeholder="Search subdomain or business…"
            aria-label="Search deployments"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
        </div>
        <button type="button" className={iconBtn} title="Refresh" aria-label="Refresh" onClick={() => void load({ skipFastPhase: true })}>
          <RefreshCw className={cn("h-4 w-4", (loading || syncing) && "animate-spin")} />
        </button>
        {syncing ? <span className="text-xs text-text-faint">Syncing hosting…</span> : null}
      </div>

      {selected.size > 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-text">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => setConfirmBulk(Array.from(selected))}
            disabled={busyKey !== null}
            className="inline-flex items-center gap-1 rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busyKey === "bulk" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete selected
          </button>
          <button type="button" className="text-xs text-text-muted hover:text-text" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading deployments…
        </div>
      ) : empty ? (
        <EmptyPanel icon={Globe} title="No sites in this view" hint="Deploy a run or upload a site zip to see it here." />
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    aria-label="Select all subdomains"
                    checked={selectable.length > 0 && selectable.every((r) => selected.has(r.subdomain as string))}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(selectable.map((r) => r.subdomain as string)) : new Set())
                    }
                  />
                </th>
                <th className="px-3 py-2">Business / site</th>
                <th className="px-3 py-2">URL</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Deployed</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const key = row.id ?? row.subdomain ?? row.url;
                const busy = busyKey !== null;
                // Guard against null === null: untracked custom-domain rows
                // have neither id nor subdomain, and must not read as busy
                // whenever the board is idle.
                const rowBusy = busyKey !== null && busyKey === key;
                const canSelect = Boolean(row.subdomain) && !row.isCustomDomain;
                const liveStaging = !row.isCustomDomain && (row.status === "live" || row.status === "untracked");
                return (
                  <tr key={key} data-testid="ss-deployment-row" className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          className="accent-accent"
                          aria-label={`Select ${row.subdomain}`}
                          checked={selected.has(row.subdomain as string)}
                          onChange={() => toggleSelect(row.subdomain as string)}
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-text">
                      {row.leadName ?? (row.subdomain ? <span className="font-mono text-xs">{row.subdomain}</span> : "—")}
                      {row.leadStatus ? <span className="ml-2 text-xs text-text-faint">{row.leadStatus}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                        {row.url.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={STATUS_TONE[row.status]}>{row.status.replace("_", " ")}</Pill>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={row.category === "ready" ? "ready" : row.category === "live" ? "accent" : "neutral"}>
                        {row.origin === "v2_import" ? "v2 import" : row.origin ?? "untracked"}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{row.deployedAt ? <RelativeTime iso={row.deployedAt} /> : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1">
                        {rowBusy ? <Loader2 className="h-4 w-4 animate-spin text-text-faint" /> : null}
                        {liveStaging ? (
                          <>
                            <DownloadSiteFilesButton site={row.url} disabled={busy} />
                            <button type="button" className={iconBtn} title="File history / restore"
                              aria-label={`File history of ${row.subdomain}`} disabled={busy}
                              onClick={() => setHistoryFor(row.url)}>
                              <History className="h-4 w-4" />
                            </button>
                            {row.id && row.status === "live" ? (
                              <button type="button" className={iconBtn} title="Shuffle to a new subdomain"
                                aria-label={`Shuffle ${row.subdomain}`} disabled={busy} onClick={() => setConfirmShuffle(row)}>
                                <Shuffle className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button type="button" className={iconBtn} title="Upload new files (override or new version)"
                              aria-label={`Upload to ${row.subdomain}`} disabled={busy}
                              onClick={() => setUploadOpen({ target: row.subdomain })}>
                              <Upload className="h-4 w-4" />
                            </button>
                            <button type="button" className={iconBtn} title="Transfer to custom domain"
                              aria-label={`Transfer ${row.subdomain} to a custom domain`} disabled={busy}
                              onClick={() => void transfer(row)}>
                              <Globe className="h-4 w-4" />
                            </button>
                            {!row.leadId ? (
                              <button type="button" className={iconBtn} title="Link to a lead"
                                aria-label={`Link ${row.subdomain} to a lead`} disabled={busy}
                                onClick={() => setLinkFor({ deploymentId: row.id, subdomain: row.subdomain, url: row.url })}>
                                <Link2 className="h-4 w-4" />
                              </button>
                            ) : null}
                            {row.id && row.status === "live" ? (
                              <button type="button" className={iconBtnDanger} title="Take down"
                                aria-label={`Take down ${row.subdomain}`} disabled={busy} onClick={() => setConfirmTakedown(row)}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <button type="button" className={iconBtnDanger} title="Delete subdomain"
                                aria-label={`Delete ${row.subdomain}`} disabled={busy}
                                onClick={() => setConfirmBulk([row.subdomain as string])}>
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        ) : row.isCustomDomain && row.protected ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-text-faint"
                            title="Protected company domain — destructive actions are disabled (PROTECTED_DOMAINS)"
                          >
                            <Lock className="h-3.5 w-3.5" /> Protected
                          </span>
                        ) : row.isCustomDomain && (row.status === "live" || row.status === "untracked") ? (
                          <>
                            <DownloadSiteFilesButton site={row.url} disabled={busy} />
                            <button type="button" className={iconBtn} title="File history / restore"
                              aria-label={`File history of ${row.url}`} disabled={busy}
                              onClick={() => setHistoryFor(row.url)}>
                              <History className="h-4 w-4" />
                            </button>
                            <button type="button" className={iconBtn} title="Override with a zip upload"
                              aria-label={`Upload new files to ${row.url}`} disabled={busy} onClick={() => void overrideCustom(row)}>
                              <Upload className="h-4 w-4" />
                            </button>
                            {row.id && !row.leadId ? (
                              <button type="button" className={iconBtn} title="Link to a lead"
                                aria-label={`Link ${row.url} to a lead`} disabled={busy}
                                onClick={() => setLinkFor({ deploymentId: row.id, subdomain: null, url: row.url })}>
                                <Link2 className="h-4 w-4" />
                              </button>
                            ) : null}
                            <button type="button" className={iconBtnDanger} title="Take down"
                              aria-label={`Take down ${row.url}`} disabled={busy} onClick={() => void takedownCustom(row)}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : row.id ? (
                          <button type="button" className={iconBtnDanger} title="Delete record"
                            aria-label={`Delete ${row.leadName ?? row.subdomain ?? "site"} deployment record`} disabled={busy}
                            onClick={() => setConfirmRecord(row)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && visible.length > pageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <label className="flex items-center gap-2 text-text-muted">
            Rows per page
            <select
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:ring-2 focus:ring-accent"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {[25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Page {safePage + 1} of {pageCount} · {visible.length} sites</span>
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40">
              Prev
            </button>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      ) : null}

      <input ref={overrideInput} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void onOverrideFile(e)} />

      {historyFor ? (
        <SnapshotsModal
          site={historyFor}
          onClose={() => setHistoryFor(null)}
          onRestored={() => void load({ skipFastPhase: true })}
        />
      ) : null}

      {uploadOpen ? (
        <UploadModal
          subdomains={rows.filter((r) => r.subdomain && !r.isCustomDomain).map((r) => r.subdomain as string)}
          daDomain={daDomain}
          initialTarget={uploadOpen.target}
          onClose={() => setUploadOpen(null)}
          onDone={onUploaded}
        />
      ) : null}

      {linkFor ? (
        <LinkLeadModal
          deploymentId={linkFor.deploymentId}
          subdomain={linkFor.subdomain}
          siteUrl={linkFor.url}
          optional={linkFor.optional}
          onClose={() => setLinkFor(null)}
          onDone={() => void load()}
        />
      ) : null}

      {transferRow ? (
        <TransferDeploymentModal
          deploymentId={transferRow.id}
          businessName={transferRow.name}
          onClose={() => setTransferRow(null)}
          onDone={() => void load()}
        />
      ) : null}

      {confirmShuffle ? (
        <ConfirmDialog
          title={`Shuffle ${confirmShuffle.leadName ?? confirmShuffle.subdomain}'s site to a new subdomain?`}
          body={`The current files move to a fresh versioned subdomain, ${confirmShuffle.subdomain}.${daDomain} is deleted, and the lead's website link is updated (the agent is notified).`}
          confirmLabel="Shuffle"
          onCancel={() => setConfirmShuffle(null)}
          onConfirm={() => void shuffle(confirmShuffle)}
        />
      ) : null}

      {confirmTakedown ? (
        <ConfirmDialog
          title={`Take down ${confirmTakedown.leadName ?? confirmTakedown.subdomain ?? confirmTakedown.url}?`}
          body={`${confirmTakedown.url.replace(/^https?:\/\//, "")} goes offline immediately${confirmTakedown.isCustomDomain ? "." : " and the subdomain is removed."}`}
          confirmLabel="Take down"
          danger
          onCancel={() => setConfirmTakedown(null)}
          onConfirm={() => void takedown(confirmTakedown)}
        />
      ) : null}

      {confirmRecord ? (
        <ConfirmDialog
          title={`Delete ${confirmRecord.leadName ?? confirmRecord.subdomain ?? "this site"}'s deployment record?`}
          body="The row disappears from this board. Nothing on the server changes."
          confirmLabel="Delete record"
          danger
          onCancel={() => setConfirmRecord(null)}
          onConfirm={() => void deleteRecord(confirmRecord)}
        />
      ) : null}

      {confirmBulk ? (
        <ConfirmDialog
          title={`Delete ${confirmBulk.length} subdomain${confirmBulk.length > 1 ? "s" : ""}?`}
          body={`${confirmBulk.slice(0, 10).map((s) => `${s}.${daDomain}`).join(", ")}${confirmBulk.length > 10 ? ` +${confirmBulk.length - 10} more` : ""} — the sites go offline and their files are removed. Linked leads' website links are cleared.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmBulk(null)}
          onConfirm={() => void bulkDelete(confirmBulk)}
        />
      ) : null}
    </div>
  );
}

/** Confirm dialog — closes only via its own buttons (house rule). */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="mt-2 text-sm text-text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className={cn("rounded-md px-4 py-2 text-sm font-semibold text-white hover:opacity-90",
              danger ? "bg-danger" : "bg-accent")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
