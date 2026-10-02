"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, Search } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import type { WebsitePortfolioRow } from "@/lib/website-cms/types";
import { Dialog, createRow, updateRow, deleteRow, usePublishToast } from "./shared";

type Draft = {
  client_name: string;
  industry: string;
  state: string;
  live_url: string;
  screenshot: string;
  featured: boolean;
  active: boolean;
  sort_order: number;
};

const EMPTY: Draft = {
  client_name: "",
  industry: "",
  state: "",
  live_url: "",
  screenshot: "",
  featured: false,
  active: true,
  sort_order: 0,
};

function toDraft(row: WebsitePortfolioRow): Draft {
  return {
    client_name: row.client_name,
    industry: row.industry,
    state: row.state,
    live_url: row.live_url,
    screenshot: row.screenshot ?? "",
    featured: row.featured,
    active: row.active,
    sort_order: row.sort_order,
  };
}

export function PortfolioPanel({ rows, canManage }: { rows: WebsitePortfolioRow[]; canManage: boolean }) {
  const router = useRouter();
  const publishToast = usePublishToast();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.client_name, r.industry, r.state, r.live_url].some((v) => v.toLowerCase().includes(needle))
    );
  }, [rows, q]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const payload = { ...editing.draft, screenshot: editing.draft.screenshot || null };
    const outcome = editing.id
      ? await updateRow("portfolio", editing.id, payload)
      : await createRow("portfolio", payload);
    setBusy(false);
    publishToast(outcome, editing.id ? "Portfolio entry saved" : "Portfolio entry added");
    if (outcome.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  async function remove(row: WebsitePortfolioRow) {
    if (!window.confirm(`Remove "${row.client_name}" from the website portfolio?`)) return;
    const outcome = await deleteRow("portfolio", row.id);
    publishToast(outcome, "Portfolio entry deleted");
    if (outcome.ok) router.refresh();
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <Panel
      flush
      title="Portfolio"
      count={rows.length}
      description="The client sites shown on /portfolio. Featured entries surface on the home page."
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              className="w-44 rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-xs text-text outline-none focus:ring-2 focus:ring-accent"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {canManage && (
            <button type="button" className={btnSecondarySm} onClick={() => setEditing({ id: null, draft: EMPTY })}>
              <Plus className="h-3.5 w-3.5" /> Add site
            </button>
          )}
        </div>
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Client</th>
            <th className="px-4 py-2 font-medium">Industry · State</th>
            <th className="px-4 py-2 font-medium">URL</th>
            <th className="px-4 py-2 font-medium">Featured</th>
            <th className="px-4 py-2 font-medium">Visible</th>
            {canManage && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2 font-medium text-text">{row.client_name}</td>
              <td className="px-4 py-2 text-xs text-text-muted">
                {row.industry} · {row.state}
              </td>
              <td className="max-w-[16rem] truncate px-4 py-2 font-mono text-xs text-text-muted">{row.live_url}</td>
              <td className="px-4 py-2">{row.featured ? "★" : ""}</td>
              <td className="px-4 py-2">{row.active ? "Yes" : "Hidden"}</td>
              {canManage && (
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() => setEditing({ id: row.id, draft: toDraft(row) })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button type="button" className={btnGhostSm} onClick={() => remove(row)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">
                {rows.length === 0
                  ? "No portfolio entries — seed from the website snapshot in Settings."
                  : "Nothing matches the search."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && d && (
        <Dialog title={editing.id ? `Edit — ${d.client_name}` : "Add portfolio site"} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client name" required>
                <input className={inputCls} value={d.client_name} onChange={(e) => set({ client_name: e.target.value })} />
              </Field>
              <Field label="Live URL">
                <input className={inputCls} value={d.live_url} onChange={(e) => set({ live_url: e.target.value })} />
              </Field>
              <Field label="Industry">
                <input className={inputCls} value={d.industry} onChange={(e) => set({ industry: e.target.value })} />
              </Field>
              <Field label="State">
                <input className={inputCls} value={d.state} onChange={(e) => set({ state: e.target.value })} />
              </Field>
            </div>
            <Field label="Screenshot URL" hint="Optional — cards render a typographic mock when absent">
              <input className={inputCls} value={d.screenshot} onChange={(e) => set({ screenshot: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Featured (home page)">
                <Select
                  className={inputCls}
                  value={d.featured ? "yes" : "no"}
                  onChange={(e) => set({ featured: e.target.value === "yes" })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </Select>
              </Field>
              <Field label="Visible on the website?">
                <Select
                  className={inputCls}
                  value={d.active ? "yes" : "no"}
                  onChange={(e) => set({ active: e.target.value === "yes" })}
                >
                  <option value="yes">Yes</option>
                  <option value="no">Hidden</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
              <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save & publish"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
