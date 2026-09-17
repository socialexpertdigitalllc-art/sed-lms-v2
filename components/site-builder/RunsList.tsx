"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Layers, Loader2, Plus, Rocket, Search, Trash2 } from "lucide-react";
import { EmptyPanel, PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { BuilderTemplateRow } from "@/components/site-builder/TemplatesBoard";

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
  const [bulkOpen, setBulkOpen] = useState(false);

  // `loading` starts true and is only ever CLEARED here — reloads after a
  // delete or a bulk queue refresh the rows in place, no loading flash (and no
  // synchronous setState on the effect path, which the purity lint forbids).
  const load = useCallback(async () => {
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
          <div className="flex items-center gap-2">
            {/* Bulk lands its queued runs RIGHT HERE: this list is the bulk
                board — every row already shows its live status (queued →
                generating → review) as the background processor drains the
                batch — so there is no separate bulk screen to build. */}
            <button type="button" className={btnSecondarySm} onClick={() => setBulkOpen(true)}>
              <Layers className="h-3.5 w-3.5" /> Bulk generate
            </button>
            <Link href="/ai-tools/site-builder/new" className={btnPrimary}>
              <Plus className="h-4 w-4" /> New site
            </Link>
          </div>
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

      {bulkOpen ? (
        <BulkGeneratePanel
          onClose={() => setBulkOpen(false)}
          onQueued={({ created, skipped }) => {
            setBulkOpen(false);
            toast({ kind: "success", title: `${created} queued, ${skipped} skipped` });
            void load();
          }}
        />
      ) : null}

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
                className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
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

/** Only what the bulk picker reads off a lead row — the same restraint (and
 *  the same source, `GET /api/leads` filtered to "Not Ready" and not deleted)
 *  as `NewSiteFlow`'s lead step. */
interface BulkLeadOption {
  id: string;
  business_name: string;
  status: string;
  deleted_at: string | null;
}

/** Mirrors the bulk route's cap: one shared provider budget, drained one run
 *  at a time — a bigger batch is a longer parked queue, not faster output. */
const BULK_MAX_LEADS = 50;

/**
 * The bulk launcher: pick a template, tick leads, queue the lot. It only
 * POSTs `/api/site-builder/runs/bulk` — every queued run is picked up by the
 * background processor, and the runs list behind this panel is where the
 * batch is watched. Leads already carrying an active run are skipped by the
 * route (reported in the toast's "skipped" count), so re-submitting is safe.
 */
function BulkGeneratePanel({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: (summary: { created: number; skipped: number }) => void;
}) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<BuilderTemplateRow[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [leads, setLeads] = useState<BulkLeadOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tRes, lRes] = await Promise.all([fetch("/api/site-builder/templates"), fetch("/api/leads")]);
        const tBody = await tRes.json().catch(() => ({}));
        const lBody = await lRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!tRes.ok) throw new Error(tBody.error ?? "Could not load templates");
        if (!lRes.ok) throw new Error(lBody.error ?? "Could not load leads");
        setTemplates((tBody.templates ?? []) as BuilderTemplateRow[]);
        setLeads((lBody.leads ?? []) as BulkLeadOption[]);
      } catch (e) {
        if (cancelled) return;
        toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the bulk picker" });
        setTemplates([]);
        setLeads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Same eligibility rule as NewSiteFlow: only "Not Ready", undeleted leads
  // are generation candidates.
  const eligible = useMemo(() => (leads ?? []).filter((l) => l.status === "Not Ready" && !l.deleted_at), [leads]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((l) => l.business_name.toLowerCase().includes(q));
  }, [eligible, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= BULK_MAX_LEADS) {
        toast({ kind: "error", title: `At most ${BULK_MAX_LEADS} leads per batch — deselect one first` });
        return prev;
      }
      next.add(id);
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/site-builder/runs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_ids: [...selected], template_id: templateId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not queue the batch" });
        return;
      }
      onQueued({ created: body.created ?? 0, skipped: body.skipped ?? 0 });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not queue the batch" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk generate sites"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-semibold text-text">Bulk generate</h3>
          <p className="mt-1 text-xs text-text-muted">
            One queued run per lead — the processor generates them one at a time, and this board shows each run&rsquo;s
            live status. Leads that already have a run queued or generating are skipped.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="bulk-template">
              Template
            </label>
            {templates === null ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
              </p>
            ) : (
              <select id="bulk-template" className={inputCls} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.page_files.length} page{t.page_files.length === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-text-muted">
              Leads (Not Ready) — {selected.size} selected, max {BULK_MAX_LEADS}
            </p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input
                className={cn(inputCls, "pl-8")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search leads by business name"
                aria-label="Search leads"
              />
            </div>
            {leads === null ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
              </p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-text-muted">No &ldquo;Not Ready&rdquo; leads match.</p>
            ) : (
              <ul className="max-h-64 divide-y divide-border overflow-auto rounded-md border border-border">
                {shown.map((l) => (
                  <li key={l.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                      />
                      {l.business_name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void submit()}
            disabled={submitting || !templateId || selected.size === 0}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Queue {selected.size || ""} run{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
