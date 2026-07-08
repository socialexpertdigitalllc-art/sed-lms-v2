"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ClipboardList, CalendarClock } from "lucide-react";
import {
  PreLead,
  LEAD_CATEGORIES,
  PRELEAD_STATUSES,
  SERVICE_OFFERED,
  SERVICE_TYPE,
} from "@/lib/preleads/types";
import { CategoryPill, PreLeadStatusPill } from "@/components/preleads/CategoryPill";
import { formatCurrency, formatDateTime, toDateTimeLocal } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { SectionCard } from "@/components/forms/formShell";
import { FieldRow, type SelectOption } from "@/components/detail/FieldRow";

const opt = (values: readonly string[], blank = true): SelectOption[] => [
  ...(blank ? [{ value: "", label: "—" }] : []),
  ...values.map((v) => ({ value: v, label: v })),
];

export function PreLeadDetail({ preLead }: { preLead: PreLead }) {
  const router = useRouter();
  const { has } = usePermissions();
  const canEdit = has("pre_leads.edit");
  const canFollowup = has("pre_leads.followup");

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
  const grid = "grid grid-cols-1 gap-x-8 sm:grid-cols-2";

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header band */}
      <div className="reveal relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="glow-teal absolute -right-16 -top-24 h-64 w-64" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="min-w-0">
            <Link href="/pre-leads/all" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
              <ArrowLeft size={13} /> Pre-Leads
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">Pre-Lead</p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-text">{preLead.business_name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CategoryPill category={preLead.lead_category} />
              <PreLeadStatusPill status={preLead.status} />
              <span className="font-mono text-xs text-text-faint">#{preLead.id.slice(0, 8)}</span>
            </div>
          </div>
          <button onClick={() => router.refresh()} className="rounded-lg border border-border bg-surface/70 px-3 py-2 text-sm text-text-muted hover:bg-surface-2">
            Refresh
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <SectionCard n={1} icon={Building2} title="Business info" subtitle="Who to reach" done={false} delay={0}>
          <div className={grid}>
            <FieldRow label="Business name" value={preLead.business_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_name: v.trim() })} />
            <FieldRow label="Owner" value={preLead.owner_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ owner_name: nz(v) })} />
            <FieldRow label="Phone" value={preLead.phone_number ?? ""} canEdit={canEdit} onSave={(v) => patch({ phone_number: nz(v) })} />
            <FieldRow label="Email" value={preLead.email ?? ""} canEdit={canEdit} onSave={(v) => patch({ email: nz(v) })} />
            <FieldRow label="Profile link" value={preLead.google_yelp_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ google_yelp_link: nz(v) })} />
            <FieldRow label="Areas" value={(preLead.areas ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ areas: commas(v) })} />
          </div>
        </SectionCard>

        <SectionCard n={2} icon={ClipboardList} title="Lead info" subtitle="Category, service & value" done={false} delay={60}>
          <div className={grid}>
            <FieldRow label="Category" value={preLead.lead_category} type="select" options={opt(LEAD_CATEGORIES, false)} display={<CategoryPill category={preLead.lead_category} />} canEdit={canFollowup} onSave={(v) => patch({ lead_category: v })} />
            <FieldRow label="Status" value={preLead.status} type="select" options={opt(PRELEAD_STATUSES, false)} display={<PreLeadStatusPill status={preLead.status} />} canEdit={canFollowup} onSave={(v) => patch({ status: v })} />
            <FieldRow label="Service offered" value={preLead.service_offered ?? ""} type="select" options={opt(SERVICE_OFFERED)} canEdit={canEdit} onSave={(v) => patch({ service_offered: v || null })} />
            <FieldRow label="Service type" value={preLead.service_type ?? ""} type="select" options={opt(SERVICE_TYPE)} canEdit={canEdit} onSave={(v) => patch({ service_type: v || null })} />
            <FieldRow label="Pricing" value={preLead.pricing?.toString() ?? ""} type="number" display={preLead.pricing != null ? formatCurrency(preLead.pricing) : undefined} canEdit={canEdit} onSave={(v) => patch({ pricing: num(v) })} />
            <FieldRow label="Services" value={(preLead.services ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ services: commas(v) })} />
          </div>
        </SectionCard>

        <SectionCard n={3} icon={CalendarClock} title="Follow-up & notes" subtitle="Timing & context" done={false} delay={120}>
          <div className={grid}>
            <FieldRow label="Follow-up time" value={toDateTimeLocal(preLead.follow_up_time)} type="datetime" display={preLead.follow_up_time ? formatDateTime(preLead.follow_up_time) : undefined} copy={preLead.follow_up_time ? formatDateTime(preLead.follow_up_time) : ""} canEdit={canFollowup} onSave={(v) => patch({ follow_up_time: v ? new Date(v).toISOString() : null })} />
            <FieldRow label="Created" value={formatDateTime(preLead.created_at)} copy={formatDateTime(preLead.created_at)} />
            <FieldRow className="sm:col-span-2" label="Comments" value={preLead.comments ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ comments: nz(v) })} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
