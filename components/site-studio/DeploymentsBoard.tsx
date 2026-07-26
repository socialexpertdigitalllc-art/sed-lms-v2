"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, Loader2, Trash2 } from "lucide-react";
import { EmptyPanel, PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";
import { iconBtnDanger } from "@/components/common/buttons";
import { cn } from "@/lib/utils";

export type DeploymentStatus = "live" | "taken_down" | "failed";
export type DeploymentOrigin = "studio" | "v2_import";

export interface DeploymentRow {
  id: string;
  lead_id: string | null;
  run_id: string | null;
  subdomain: string;
  docroot: string;
  url: string;
  status: DeploymentStatus;
  origin: DeploymentOrigin;
  deployed_at: string;
  taken_down_at: string | null;
  deployed_by: string | null;
  created_at: string;
  updated_at: string;
  leads: { business_name: string } | null;
}

type FilterId = "live" | "taken_down" | "failed" | "all";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "taken_down", label: "Taken down" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const STATUS_TONE: Record<DeploymentStatus, PillTone> = {
  live: "ready",
  taken_down: "neutral",
  failed: "dropped",
};

/**
 * The deployments board (Phase 4a Task 10) — moved here from
 * `template-engine/deployments` so Phase 4b's cutover can delete that whole
 * namespace without carving out an exception. It must display and support
 * takedown for `origin:'v2_import'` rows too (seeded at cutover), even
 * though nothing writes them yet — nothing below special-cases `origin`
 * beyond the badge, on purpose.
 */
export function DeploymentsBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<DeploymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("live");
  const [confirming, setConfirming] = useState<DeploymentRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { filter?: FilterId }) => {
      setLoading(true);
      try {
        const f = opts?.filter ?? filter;
        const params = new URLSearchParams();
        if (f !== "all") params.set("status", f);
        const res = await fetch(`/api/site-studio/deployments?${params.toString()}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load deployments");
        setRows((body.deployments ?? []) as DeploymentRow[]);
      } catch (e) {
        toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load deployments" });
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function changeFilter(next: FilterId) {
    setFilter(next);
    void load({ filter: next });
  }

  async function takedown(row: DeploymentRow) {
    setConfirming(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/site-studio/deployments/${row.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409/error responses toast the server message verbatim.
        toast({ kind: "error", title: body.error ?? "Take-down failed" });
        return;
      }
      toast({
        kind: body.warning ? "info" : "success",
        title: body.warning ?? `${row.leads?.business_name ?? "Site"} was taken down`,
      });
      await load();
    } catch {
      toast({ kind: "error", title: "Network error — try again" });
    } finally {
      setBusyId(null);
    }
  }

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description="Every live and formerly-live client site — Site Studio and legacy v2 sites alike."
      />

      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => changeFilter(f.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              filter === f.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading deployments…
        </div>
      ) : empty ? (
        <EmptyPanel icon={Globe} title="No deployments" hint="Deploy a ready run from Site Studio to see it here." />
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">URL</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Origin</th>
                <th className="px-3 py-2">Deployed</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="ss-deployment-row"
                  className="border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-3 py-2 text-text">{row.leads?.business_name ?? "(deleted lead)"}</td>
                  <td className="px-3 py-2">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent-ink hover:underline"
                    >
                      {row.url.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    <Pill tone={STATUS_TONE[row.status]}>{row.status.replace("_", " ")}</Pill>
                  </td>
                  <td className="px-3 py-2">
                    <Pill tone={row.origin === "v2_import" ? "neutral" : "accent"}>
                      {row.origin === "v2_import" ? "v2 import" : "studio"}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    <RelativeTime iso={row.deployed_at} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.status === "live" ? (
                      <button
                        type="button"
                        className={iconBtnDanger}
                        title="Take down"
                        aria-label={`Take down ${row.leads?.business_name ?? "site"}`}
                        disabled={busyId !== null}
                        onClick={() => setConfirming(row)}
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Take-down confirm — closes only via its own buttons (house rule) */}
      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Take down this site?"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">
              Take down {confirming.leads?.business_name ?? "this site"}&apos;s site?
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              {confirming.url.replace(/^https?:\/\//, "")} goes offline immediately and the subdomain is removed.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => takedown(confirming)}
                className="rounded-md bg-dropped-fg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Take down
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
