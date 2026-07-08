"use client";

import { useRouter } from "next/navigation";
import { PreLead, LEAD_CATEGORIES, PRELEAD_STATUSES, SERVICE_OFFERED, SERVICE_TYPE } from "@/lib/preleads/types";
import { CategoryPill, PreLeadStatusPill } from "@/components/preleads/CategoryPill";
import { formatCurrency, formatDate, formatDateTime, toDateTimeLocal } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { FieldRow, type SelectOption } from "@/components/detail/FieldRow";

const opt = (values: readonly string[], blank = true): SelectOption[] => [
  ...(blank ? [{ value: "", label: "—" }] : []),
  ...values.map((v) => ({ value: v, label: v })),
];

export function QuickViewModal({
  preLead,
  open,
  onClose,
}: {
  preLead: PreLead;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { has } = usePermissions();
  const canEdit = has("pre_leads.edit");
  const canFollowup = has("pre_leads.followup");

  if (!open) return null;

  async function patch(partial: Record<string, unknown>) {
    const res = await fetch(`/api/pre-leads/${preLead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
    router.refresh();
  }

  const nz = (v: string) => v.trim() || null;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const commas = (v: string) => v.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-[620px] max-w-full overflow-y-auto rounded-lg border border-border bg-surface p-6"
      >
        <h2 className="font-semibold text-text">Pre-lead details</h2>
        <p className="mb-4 mt-1 truncate text-sm text-text-muted">{preLead.business_name}</p>

        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <FieldRow label="Business name" value={preLead.business_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_name: v.trim() })} />
          <FieldRow label="Owner" value={preLead.owner_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ owner_name: nz(v) })} />
          <FieldRow label="Phone" value={preLead.phone_number ?? ""} canEdit={canEdit} onSave={(v) => patch({ phone_number: nz(v) })} />
          <FieldRow label="Email" value={preLead.email ?? ""} canEdit={canEdit} onSave={(v) => patch({ email: nz(v) })} />
          <FieldRow label="Category" value={preLead.lead_category} type="select" options={opt(LEAD_CATEGORIES, false)} display={<CategoryPill category={preLead.lead_category} />} canEdit={canFollowup} onSave={(v) => patch({ lead_category: v })} />
          <FieldRow label="Status" value={preLead.status} type="select" options={opt(PRELEAD_STATUSES, false)} display={<PreLeadStatusPill status={preLead.status} />} canEdit={canFollowup} onSave={(v) => patch({ status: v })} />
          <FieldRow label="Service offered" value={preLead.service_offered ?? ""} type="select" options={opt(SERVICE_OFFERED)} canEdit={canEdit} onSave={(v) => patch({ service_offered: v || null })} />
          <FieldRow label="Service type" value={preLead.service_type ?? ""} type="select" options={opt(SERVICE_TYPE)} canEdit={canEdit} onSave={(v) => patch({ service_type: v || null })} />
          <FieldRow label="Pricing" value={preLead.pricing?.toString() ?? ""} type="number" display={preLead.pricing != null ? formatCurrency(preLead.pricing) : undefined} canEdit={canEdit} onSave={(v) => patch({ pricing: num(v) })} />
          <FieldRow label="Profile link" value={preLead.google_yelp_link ?? ""} type="url" display={preLead.google_yelp_link ? <a href={preLead.google_yelp_link} target="_blank" rel="noreferrer" className="break-all text-accent-ink hover:underline">{preLead.google_yelp_link}</a> : undefined} canEdit={canEdit} onSave={(v) => patch({ google_yelp_link: nz(v) })} />
          <FieldRow label="Areas" value={(preLead.areas ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ areas: commas(v) })} />
          <FieldRow label="Services" value={(preLead.services ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ services: commas(v) })} />
          <FieldRow label="Follow-up time" value={toDateTimeLocal(preLead.follow_up_time)} type="datetime" display={preLead.follow_up_time ? formatDateTime(preLead.follow_up_time) : undefined} copy={preLead.follow_up_time ? formatDateTime(preLead.follow_up_time) : ""} canEdit={canFollowup} onSave={(v) => patch({ follow_up_time: v ? new Date(v).toISOString() : null })} />
          <FieldRow label="Created" value={formatDate(preLead.created_at)} />
          <FieldRow className="sm:col-span-2" label="Comments" value={preLead.comments ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ comments: nz(v) })} />
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:bg-surface-2">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
