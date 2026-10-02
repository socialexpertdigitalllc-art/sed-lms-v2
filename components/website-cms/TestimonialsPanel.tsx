"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import type { WebsiteTestimonialRow } from "@/lib/website-cms/types";
import { Dialog, createRow, updateRow, deleteRow, usePublishToast } from "./shared";

type Draft = {
  client_name: string;
  business: string;
  quote: string;
  rating: number;
  approved: boolean;
  sort_order: number;
};

const EMPTY: Draft = { client_name: "", business: "", quote: "", rating: 5, approved: false, sort_order: 0 };

export function TestimonialsPanel({ rows, canManage }: { rows: WebsiteTestimonialRow[]; canManage: boolean }) {
  const router = useRouter();
  const publishToast = usePublishToast();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const outcome = editing.id
      ? await updateRow("testimonials", editing.id, editing.draft)
      : await createRow("testimonials", editing.draft);
    setBusy(false);
    publishToast(outcome, editing.id ? "Testimonial saved" : "Testimonial added");
    if (outcome.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  async function remove(row: WebsiteTestimonialRow) {
    if (!window.confirm(`Delete the testimonial from ${row.client_name}?`)) return;
    const outcome = await deleteRow("testimonials", row.id);
    publishToast(outcome, "Testimonial deleted");
    if (outcome.ok) router.refresh();
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <Panel
      flush
      title="Testimonials"
      count={rows.length}
      description="Only approved testimonials appear on the website. Use real client quotes only (FTC rules)."
      action={
        canManage ? (
          <button type="button" className={btnSecondarySm} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            <Plus className="h-3.5 w-3.5" /> New testimonial
          </button>
        ) : undefined
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Client</th>
            <th className="px-4 py-2 font-medium">Quote</th>
            <th className="px-4 py-2 font-medium">Rating</th>
            <th className="px-4 py-2 font-medium">On the site</th>
            {canManage && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2.5">
                <div className="font-medium text-text">{row.client_name}</div>
                <div className="text-xs text-text-muted">{row.business}</div>
              </td>
              <td className="max-w-md px-4 py-2.5 text-text-muted">
                <span className="line-clamp-2">{row.quote}</span>
              </td>
              <td className="px-4 py-2.5">{row.rating}/5</td>
              <td className="px-4 py-2.5">
                {row.approved ? <span className="font-medium text-accent-ink">Live</span> : "Pending"}
              </td>
              {canManage && (
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() =>
                      setEditing({
                        id: row.id,
                        draft: {
                          client_name: row.client_name,
                          business: row.business,
                          quote: row.quote,
                          rating: row.rating,
                          approved: row.approved,
                          sort_order: row.sort_order,
                        },
                      })
                    }
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
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-muted">
                No testimonials yet. The website shows its verifiable-proof section instead.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && d && (
        <Dialog title={editing.id ? "Edit testimonial" : "New testimonial"} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client name" required>
                <input className={inputCls} value={d.client_name} onChange={(e) => set({ client_name: e.target.value })} />
              </Field>
              <Field label="Business">
                <input className={inputCls} value={d.business} onChange={(e) => set({ business: e.target.value })} />
              </Field>
            </div>
            <Field label="Quote" required>
              <textarea className={inputCls} rows={4} value={d.quote} onChange={(e) => set({ quote: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rating">
                <Select className={inputCls} value={d.rating} onChange={(e) => set({ rating: Number(e.target.value) })}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Approved for the website?">
                <Select
                  className={inputCls}
                  value={d.approved ? "yes" : "no"}
                  onChange={(e) => set({ approved: e.target.value === "yes" })}
                >
                  <option value="no">Not yet</option>
                  <option value="yes">Yes — show it</option>
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
