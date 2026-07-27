"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Rocket, Trash2 } from "lucide-react";
import { EmptyPanel, PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { btnPrimary, iconBtnDanger } from "@/components/common/buttons";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";

type BuilderRunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";

interface RunListRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  status: BuilderRunStatus;
  created_at: string;
  updated_at: string;
  leads: { business_name: string } | null;
}

const STATUS_PILL: Record<BuilderRunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  generating: { tone: "accent", label: "Generating" },
  review: { tone: "notready", label: "Awaiting review" },
  approved: { tone: "accent", label: "Approved" },
  deployed: { tone: "ready", label: "Deployed" },
  failed: { tone: "dropped", label: "Failed" },
};

/** Every Site Builder run, newest first — how the operator gets back to a
 *  run they navigated away from mid-generation, or one already deployed.
 *  Each row deletes individually (run + its packaged zip); deleting a
 *  deployed run never touches the live site — that's the Deployments board. */
export function RunsList() {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<RunListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<RunListRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/site-builder/runs");
      const body = await res.json().catch(() => ({}));
      setRows((body.runs ?? []) as RunListRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function deleteRun(row: RunListRow) {
    setConfirming(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/site-builder/runs/${row.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not delete this run" });
        return;
      }
      toast({ kind: "success", title: `${row.leads?.business_name ?? "Run"} deleted` });
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
        title="Site Builder runs"
        description="Every site generated from a template, from first draft to deployed."
        action={
          <Link href="/ai-tools/site-builder/new" className={btnPrimary}>
            <Plus className="h-4 w-4" /> New site
          </Link>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
        </div>
      ) : empty ? (
        <EmptyPanel icon={Rocket} title="No runs yet" hint="Start a new site to generate your first run." />
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pill = STATUS_PILL[r.status];
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    onClick={() => router.push(`/ai-tools/site-builder/runs/${r.id}`)}
                  >
                    <td className="px-3 py-2 text-text">{r.leads?.business_name ?? "—"}</td>
                    <td className="px-3 py-2"><Pill tone={pill.tone}>{pill.label}</Pill></td>
                    <td className="px-3 py-2 text-text-muted"><RelativeTime iso={r.created_at} /></td>
                    <td className="px-3 py-2 text-text-muted"><RelativeTime iso={r.updated_at} /></td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className={iconBtnDanger}
                        title="Delete run"
                        aria-label={`Delete ${r.leads?.business_name ?? "run"}`}
                        disabled={busyId !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirming(r);
                        }}
                      >
                        {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirm — closes only via its own buttons (house rule) */}
      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delete this run?"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">
              Delete {confirming.leads?.business_name ?? "this"} run?
            </h3>
            <p className="mt-2 text-sm text-text-muted">
              The run and its packaged zip are removed. {confirming.status === "deployed"
                ? "The deployed site stays live — take it down from the Deployments board."
                : "This cannot be undone."}
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
                onClick={() => void deleteRun(confirming)}
                className="rounded-md bg-dropped-fg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
