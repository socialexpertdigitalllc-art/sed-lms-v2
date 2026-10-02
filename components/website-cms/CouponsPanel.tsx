"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import MultiSelect from "@/components/common/MultiSelect";
import { DatePicker } from "@/components/common/DateTimeField";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import type { WebsiteCouponRow } from "@/lib/website-cms/types";
import { Dialog, createRow, updateRow, deleteRow, usePublishToast } from "./shared";

type Draft = {
  code: string;
  label: string;
  discount_type: "percent" | "fixed";
  amount: number;
  service_slugs: string[];
  active: boolean;
  /** YYYY-MM-DD or "" (valid through end of that day) */
  expires: string;
};

const EMPTY: Draft = {
  code: "",
  label: "",
  discount_type: "percent",
  amount: 10,
  service_slugs: [],
  active: true,
  expires: "",
};

function toDraft(row: WebsiteCouponRow): Draft {
  return {
    code: row.code,
    label: row.label,
    discount_type: row.discount_type,
    amount: row.amount,
    service_slugs: row.service_slugs ?? [],
    active: row.active,
    expires: row.expires_at ? row.expires_at.slice(0, 10) : "",
  };
}

export function CouponsPanel({
  rows,
  serviceSlugs,
  canManage,
}: {
  rows: WebsiteCouponRow[];
  serviceSlugs: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const publishToast = usePublishToast();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFieldErrors({});
    const d = editing.draft;
    const payload = {
      code: d.code,
      label: d.label,
      discount_type: d.discount_type,
      amount: Number(d.amount) || 0,
      service_slugs: d.service_slugs,
      active: d.active,
      expires_at: d.expires ? new Date(`${d.expires}T23:59:59`).toISOString() : null,
    };
    const outcome = editing.id
      ? await updateRow("coupons", editing.id, payload)
      : await createRow("coupons", payload);
    setBusy(false);
    publishToast(outcome, editing.id ? "Coupon saved" : "Coupon created");
    if (outcome.ok) {
      setEditing(null);
      router.refresh();
    } else if (outcome.fieldErrors) {
      setFieldErrors(outcome.fieldErrors);
    }
  }

  async function remove(row: WebsiteCouponRow) {
    if (!window.confirm(`Delete coupon ${row.code}?`)) return;
    const outcome = await deleteRow("coupons", row.id);
    publishToast(outcome, "Coupon deleted");
    if (outcome.ok) router.refresh();
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <Panel
      flush
      title="Coupons"
      count={rows.length}
      description="Validated live by the website's lead form. A coupon rides along with the lead so you see it in the pipeline."
      action={
        canManage ? (
          <button type="button" className={btnSecondarySm} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            <Plus className="h-3.5 w-3.5" /> New coupon
          </button>
        ) : undefined
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Discount</th>
            <th className="px-4 py-2 font-medium">Services</th>
            <th className="px-4 py-2 font-medium">Expires</th>
            <th className="px-4 py-2 font-medium">Active</th>
            {canManage && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-text">{row.code}</td>
              <td className="px-4 py-2.5 text-text-muted">
                {row.discount_type === "percent" ? `${row.amount}%` : `$${row.amount}`}
                {row.label ? ` — ${row.label}` : ""}
              </td>
              <td className="px-4 py-2.5 text-xs text-text-muted">
                {row.service_slugs.length > 0 ? row.service_slugs.join(", ") : "All"}
              </td>
              <td className="px-4 py-2.5 text-xs text-text-muted">
                {row.expires_at ? row.expires_at.slice(0, 10) : "Never"}
              </td>
              <td className="px-4 py-2.5">{row.active ? "Yes" : "Off"}</td>
              {canManage && (
                <td className="px-4 py-2.5 text-right">
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
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">
                No coupons yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && d && (
        <Dialog title={editing.id ? `Edit — ${d.code}` : "New coupon"} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" required hint="Visitors type this on the website" error={fieldErrors.code?.[0]}>
                <input
                  className={`${inputCls} font-mono uppercase`}
                  value={d.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label="Label" hint='Shown on validation, e.g. "20% off any website"'>
                <input className={inputCls} value={d.label} onChange={(e) => set({ label: e.target.value })} />
              </Field>
              <Field label="Type">
                <Select
                  className={inputCls}
                  value={d.discount_type}
                  onChange={(e) => set({ discount_type: e.target.value as Draft["discount_type"] })}
                >
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed $ off</option>
                </Select>
              </Field>
              <Field label={d.discount_type === "percent" ? "Percent" : "Amount (USD)"} error={fieldErrors.amount?.[0]}>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={d.amount}
                  onChange={(e) => set({ amount: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Limited to services" hint="Empty = valid for everything">
              <MultiSelect
                label="Services"
                options={serviceSlugs.map((s) => ({ value: s, label: s }))}
                selected={d.service_slugs}
                onChange={(v) => set({ service_slugs: v })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expires" hint="Valid through the end of that day">
                <DatePicker className={inputCls} value={d.expires} onChange={(v) => set({ expires: v })} />
              </Field>
              <Field label="Active">
                <Select
                  className={inputCls}
                  value={d.active ? "yes" : "no"}
                  onChange={(e) => set({ active: e.target.value === "yes" })}
                >
                  <option value="yes">Yes</option>
                  <option value="no">Off</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
              <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
