"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import { toCsv, LEAD_CSV_COLUMNS, leadCsvRow } from "@/lib/leads/csv";

type BulkAction = "status" | "assign" | "archive";

export function BulkActionBar({
  selectedIds,
  selectedLeads,
  statuses,
  agentNameById,
  can,
  onClear,
}: {
  selectedIds: string[];
  selectedLeads: Lead[];
  statuses: string[];
  agentNameById: Record<string, string>;
  can: { status: boolean; assign: boolean; archive: boolean; export: boolean };
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const count = selectedIds.length;

  async function run(action: BulkAction, value?: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action, value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Bulk action failed");
        return;
      }
      onClear();
      router.refresh();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  function exportSelected() {
    const rows = selectedLeads.map((l) => leadCsvRow(l, agentNameById));
    const blob = new Blob([toCsv(rows, LEAD_CSV_COLUMNS)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_selected_${selectedIds.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectCls =
    "px-2.5 py-1.5 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent disabled:opacity-50";
  const btnCls =
    "px-3 py-1.5 rounded-md border border-border bg-surface text-sm text-text-muted hover:bg-surface-2 disabled:opacity-50 whitespace-nowrap";

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 bg-surface border border-border rounded-lg shadow-xl px-4 py-2.5 max-w-[95vw]">
      <span className="text-sm font-semibold text-text whitespace-nowrap">{count} selected</span>
      <div className="w-px h-5 bg-border" />

      {can.status && (
        <select className={selectCls} disabled={busy} defaultValue=""
          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void run("status", v); }}>
          <option value="" disabled>Set status…</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {can.assign && (
        <select className={selectCls} disabled={busy} defaultValue=""
          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void run("assign", v === "__unassign__" ? "" : v); }}>
          <option value="" disabled>Assign to…</option>
          <option value="__unassign__">Unassigned</option>
          {Object.entries(agentNameById).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      )}

      {can.export && (
        <button type="button" className={btnCls} onClick={exportSelected} disabled={busy}>Export</button>
      )}

      {can.archive && (
        <button type="button" className={btnCls} disabled={busy}
          onClick={() => { if (confirm(`Archive ${count} lead(s)? This can be undone by an admin.`)) void run("archive"); }}>
          Archive
        </button>
      )}

      {busy && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
      {err && <span className="text-xs text-dropped-fg max-w-[220px] truncate" title={err}>{err}</span>}

      <button type="button" onClick={onClear} className="p-1 rounded hover:bg-surface-2 text-text-muted" aria-label="Clear selection" disabled={busy}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
