"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, Tags } from "lucide-react";
import type { Lead, LeadTag } from "@/lib/leads/types";
import { toCsv, LEAD_CSV_COLUMNS, leadCsvRow } from "@/lib/leads/csv";
import { toggleTag } from "@/lib/leads/tagFilter";
import { tagColor } from "@/lib/leads/tagColors";
import { Select } from "@/components/common/Select";
import { useToast } from "@/components/common/Toast";

type BulkAction = "status" | "assign" | "archive" | "tag";

export function BulkActionBar({
  selectedIds,
  selectedLeads,
  statuses,
  agentNameById,
  salesAgents,
  tags,
  can,
  onClear,
}: {
  selectedIds: string[];
  selectedLeads: Lead[];
  statuses: string[];
  agentNameById: Record<string, string>;
  salesAgents: { id: string; name: string }[];
  tags: LeadTag[];
  can: { status: boolean; assign: boolean; archive: boolean; export: boolean; tag: boolean };
  onClear: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [checkedTags, setCheckedTags] = useState<string[]>([]);
  const tagRef = useRef<HTMLDivElement>(null);
  const count = selectedIds.length;

  // Outside-click closes the Tag popover (same ref+mousedown pattern as TagFilter).
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function applyTags() {
    if (!checkedTags.length || busy) return;
    await run("tag", checkedTags.join(","));
    setCheckedTags([]);
    setTagOpen(false);
  }

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
        const text = j.error ?? "Bulk action failed";
        setErr(text);
        toast({ kind: "error", title: "Bulk action failed", body: text });
        return;
      }
      onClear();
      router.refresh();
      toast({ kind: "success", title: `Updated ${selectedIds.length} lead(s)` });
    } catch {
      setErr("Network error");
      toast({ kind: "error", title: "Bulk action failed", body: "Network error" });
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
        <Select className={selectCls} disabled={busy} defaultValue=""
          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void run("status", v); }}>
          <option value="" disabled>Set status…</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      )}

      {can.assign && (
        <Select className={selectCls} disabled={busy} defaultValue=""
          onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) void run("assign", v === "__unassign__" ? "" : v); }}>
          <option value="" disabled>Assign to…</option>
          <option value="__unassign__">Unassigned</option>
          {salesAgents.length === 0
            ? <option value="" disabled>No Sales members</option>
            : salesAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}

      {can.tag && tags.length > 0 && (
        <div ref={tagRef} className="relative">
          <button
            type="button"
            className={btnCls + " inline-flex items-center gap-1.5"}
            onClick={() => setTagOpen((o) => !o)}
            disabled={busy}
            aria-expanded={tagOpen}
          >
            <Tags className="w-4 h-4" /> Tag
          </button>
          {tagOpen && (
            <div className="absolute bottom-full mb-1 left-0 w-56 max-h-72 overflow-auto bg-surface border border-border rounded-md shadow-xl p-1">
              {tags.map((t) => {
                const col = tagColor(t.color);
                return (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={checkedTags.includes(t.id)}
                      onChange={() => setCheckedTags((prev) => toggleTag(prev, t.id))}
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.hex }} />
                    <span className="flex-1 text-text truncate">{t.name}</span>
                  </label>
                );
              })}
              <div className="border-t border-border-subtle mt-1 pt-1 px-1 pb-0.5">
                <button
                  type="button"
                  onClick={applyTags}
                  disabled={busy || checkedTags.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-ink disabled:opacity-50"
                >
                  Apply{checkedTags.length ? ` (${checkedTags.length})` : ""}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {can.export && (
        <button type="button" className={btnCls} onClick={exportSelected} disabled={busy}>Export</button>
      )}

      {can.archive && (
        <button type="button" className={btnCls} disabled={busy}
          onClick={() => { if (confirm(`Delete ${count} lead(s)? This removes them from the pipeline (recoverable by an admin).`)) void run("archive"); }}>
          Delete
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
