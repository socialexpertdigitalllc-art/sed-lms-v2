"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import type { WebsiteOfferRow } from "@/lib/website-cms/types";
import { Dialog, createRow, updateRow, deleteRow, usePublishToast } from "./shared";

type Draft = {
  title: string;
  banner_text: string;
  service_slug: string;
  active: boolean;
  sort_order: number;
};

const EMPTY: Draft = { title: "", banner_text: "", service_slug: "", active: false, sort_order: 0 };

export function OffersPanel({
  rows,
  serviceSlugs,
  canManage,
}: {
  rows: WebsiteOfferRow[];
  serviceSlugs: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const publishToast = usePublishToast();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const payload = { ...editing.draft, service_slug: editing.draft.service_slug || null };
    const outcome = editing.id
      ? await updateRow("offers", editing.id, payload)
      : await createRow("offers", payload);
    setBusy(false);
    publishToast(outcome, editing.id ? "Offer saved" : "Offer created");
    if (outcome.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  async function remove(row: WebsiteOfferRow) {
    if (!window.confirm(`Delete offer "${row.title}"?`)) return;
    const outcome = await deleteRow("offers", row.id);
    publishToast(outcome, "Offer deleted");
    if (outcome.ok) router.refresh();
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <Panel
      flush
      title="Offers & banner"
      count={rows.length}
      description="The active offer shows as the site-wide banner. Multiple can be active; the first by sort order wins."
      action={
        canManage ? (
          <button type="button" className={btnSecondarySm} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            <Plus className="h-3.5 w-3.5" /> New offer
          </button>
        ) : undefined
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Offer</th>
            <th className="px-4 py-2 font-medium">Banner text</th>
            <th className="px-4 py-2 font-medium">Links to</th>
            <th className="px-4 py-2 font-medium">Active</th>
            {canManage && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2.5 font-medium text-text">{row.title}</td>
              <td className="px-4 py-2.5 text-text-muted">{row.banner_text}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                {row.service_slug ? `/services/${row.service_slug}` : "/pricing"}
              </td>
              <td className="px-4 py-2.5">
                {row.active ? <span className="font-medium text-accent-ink">Live</span> : "Off"}
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
                          title: row.title,
                          banner_text: row.banner_text,
                          service_slug: row.service_slug ?? "",
                          active: row.active,
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
                No offers. The website shows no banner.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && d && (
        <Dialog title={editing.id ? "Edit offer" : "New offer"} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <Field label="Title (internal)" required>
              <input className={inputCls} value={d.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Banner text (shown on the site)">
              <input className={inputCls} value={d.banner_text} onChange={(e) => set({ banner_text: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Links to" hint="Sitewide goes to /pricing">
                <Select
                  className={inputCls}
                  value={d.service_slug}
                  onChange={(e) => set({ service_slug: e.target.value })}
                >
                  <option value="">Sitewide (/pricing)</option>
                  {serviceSlugs.map((s) => (
                    <option key={s} value={s}>
                      /services/{s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Active">
                <Select
                  className={inputCls}
                  value={d.active ? "yes" : "no"}
                  onChange={(e) => set({ active: e.target.value === "yes" })}
                >
                  <option value="no">Off</option>
                  <option value="yes">Live on the site</option>
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
