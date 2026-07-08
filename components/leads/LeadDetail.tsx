"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import { SITE_TYPES, FRESH_OPTIONS } from "@/lib/leads/types";
import { toDateTimeLocal, formatDateTime, formatCurrency } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { DeleteLeadModal } from "./DeleteLeadModal";
import { RecentFollowUps } from "./RecentFollowUps";
import { FieldRow, type SelectOption } from "@/components/detail/FieldRow";

type Agent = { id: string; display_name: string | null };

const YES_NO: SelectOption[] = [
  { value: "", label: "—" },
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

export function LeadDetail({
  lead,
  agents,
  followUps,
}: {
  lead: Lead;
  agents: Agent[];
  followUps: LeadFollowUp[];
}) {
  const { has } = usePermissions();
  const canEdit = has("leads.edit");
  const canDelete = has("leads.delete");
  const canChangeStatus = has("leads.status_change");
  const canWebcraft = has("ai_tools.webcraft");
  const canDeepseek = has("ai_tools.deepseek");
  const canQueue = canWebcraft || canDeepseek;
  const router = useRouter();

  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);

  async function queueForGeneration() {
    setQueuing(true);
    setQueueMsg(null);
    const res = await fetch("/api/ai-tools/wge/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id }),
    });
    setQueuing(false);
    const j = await res.json().catch(() => ({}));
    setQueueMsg(res.ok ? "Queued for generation ✓" : (j.error ?? "Could not queue"));
  }

  /** PATCH a single field; throws so FieldRow surfaces the error and stays in edit. */
  async function patch(partial: Record<string, unknown>) {
    const res = await fetch(`/api/leads/${lead.id}`, {
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
  const lines = (v: string) => v.split("\n").map((t) => t.trim()).filter(Boolean);
  const triBool = (v: string) => (v === "" ? null : v === "Yes");

  const agentName = (lead.agent_id && agents.find((a) => a.id === lead.agent_id)?.display_name) || "Unassigned";
  const agentOptions: SelectOption[] = [
    { value: "", label: "Unassigned" },
    ...agents.map((a) => ({ value: a.id, label: a.display_name ?? a.id })),
  ];
  const linkDisplay = (url: string | null) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="break-all text-accent-ink hover:underline">
        {url}
      </a>
    ) : undefined;

  return (
    <div className="max-w-6xl">
      <Link href="/leads" className="text-xs text-text-muted hover:text-text">← Leads</Link>
      <div className="mt-2 mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-text">{lead.business_name}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusPill status={lead.status} />
            <span className="font-mono text-xs text-text-faint">#{lead.id.slice(0, 8)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => router.refresh()} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:bg-surface-2">
            Refresh
          </button>
          {canChangeStatus && (
            <button onClick={() => setStatusOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-surface-2">
              Change status
            </button>
          )}
          {canWebcraft && (
            <Link href={`/ai-tools/webcraft?lead=${lead.id}`} className="rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-surface-2">
              Generate (WebCraft)
            </Link>
          )}
          {canDeepseek && (
            <Link href={`/ai-tools/deepseek?lead=${lead.id}`} className="rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-surface-2">
              Generate (DeepSeek)
            </Link>
          )}
          {canQueue && (
            <button onClick={queueForGeneration} disabled={queuing} className="rounded-md border border-border px-3 py-2 text-sm text-text hover:bg-surface-2 disabled:opacity-60">
              {queuing ? "Queuing…" : "Queue for generation"}
            </button>
          )}
        </div>
      </div>

      {queueMsg && <div className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-ink">{queueMsg}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Section title="Business info">
            <FieldRow label="Business name" value={lead.business_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_name: v.trim() })} />
            <FieldRow label="Phone" value={lead.business_phone ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_phone: nz(v) })} />
            <FieldRow label="Email" value={lead.business_email ?? ""} type="text" canEdit={canEdit} onSave={(v) => patch({ business_email: nz(v) })} />
            <FieldRow label="Profile link" value={lead.business_profile_link ?? ""} type="url" display={linkDisplay(lead.business_profile_link)} canEdit={canEdit} onSave={(v) => patch({ business_profile_link: nz(v) })} />
            <FieldRow label="Website link" value={lead.website_link ?? ""} type="url" display={linkDisplay(lead.website_link)} canEdit={canEdit} onSave={(v) => patch({ website_link: nz(v) })} />
            <FieldRow label="Logo link" value={lead.logo_link ?? ""} type="url" display={linkDisplay(lead.logo_link)} canEdit={canEdit} onSave={(v) => patch({ logo_link: nz(v) })} />
            <FieldRow label="Map embed link" value={lead.map_embed_link ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ map_embed_link: nz(v) })} />
            <FieldRow label="Reference link" value={lead.reference_link ?? ""} type="url" display={linkDisplay(lead.reference_link)} canEdit={canEdit} onSave={(v) => patch({ reference_link: nz(v) })} />
          </Section>

          <Section title="Lead info">
            <FieldRow label="Agent" value={lead.agent_id ?? ""} type="select" options={agentOptions} display={agentName} canEdit={canEdit} onSave={(v) => patch({ agent_id: v || null })} />
            {/* Status is read-only here — edited via the "Change status" button (respects category permissions). */}
            <FieldRow label="Status" value={lead.status} display={<StatusPill status={lead.status} />} />
            <FieldRow label="Site type" value={lead.site_type ?? ""} type="select" options={[{ value: "", label: "—" }, ...SITE_TYPES.map((s) => ({ value: s, label: s }))]} canEdit={canEdit} onSave={(v) => patch({ site_type: v || null })} />
            <FieldRow label="Platform" value={lead.platform ?? ""} canEdit={canEdit} onSave={(v) => patch({ platform: nz(v) })} />
            <FieldRow label="Price quoted" value={lead.price_quoted?.toString() ?? ""} type="number" display={lead.price_quoted != null ? formatCurrency(lead.price_quoted) : undefined} canEdit={canEdit} onSave={(v) => patch({ price_quoted: num(v) })} />
            <FieldRow label="Rating (1–10)" value={lead.rating?.toString() ?? ""} type="number" display={lead.rating != null ? `${lead.rating}/10` : undefined} canEdit={canEdit} onSave={(v) => patch({ rating: num(v) })} />
            <FieldRow label="Fresh or follow-up" value={lead.fresh_or_followup ?? ""} type="select" options={[{ value: "", label: "—" }, ...FRESH_OPTIONS.map((s) => ({ value: s, label: s }))]} canEdit={canEdit} onSave={(v) => patch({ fresh_or_followup: v || null })} />
          </Section>

          <Section title="Services & scope">
            <FieldRow label="Services" value={(lead.services ?? []).join(", ")} type="text" canEdit={canEdit} onSave={(v) => patch({ services: commas(v) })} />
            <FieldRow label="Service areas" value={(lead.service_areas ?? []).join(", ")} type="text" canEdit={canEdit} onSave={(v) => patch({ service_areas: commas(v) })} />
            <FieldRow label="Has service areas" value={lead.has_service_areas == null ? "" : lead.has_service_areas ? "Yes" : "No"} type="select" options={YES_NO} canEdit={canEdit} onSave={(v) => patch({ has_service_areas: triBool(v) })} />
            <FieldRow label="No. of webpages" value={lead.num_webpages?.toString() ?? ""} type="number" canEdit={canEdit} onSave={(v) => patch({ num_webpages: num(v) })} />
            <FieldRow label="Specify pages" value={(lead.specify_pages ?? []).join(", ")} type="text" canEdit={canEdit} onSave={(v) => patch({ specify_pages: commas(v) })} />
            <FieldRow label="Color scheme" value={lead.color_scheme ?? ""} canEdit={canEdit} onSave={(v) => patch({ color_scheme: nz(v) })} />
            <FieldRow label="Client experience (years)" value={lead.client_experience?.toString() ?? ""} type="number" canEdit={canEdit} onSave={(v) => patch({ client_experience: num(v) })} />
          </Section>

          <Section title="Follow-up & notes">
            <FieldRow label="Follow-up date & time" value={toDateTimeLocal(lead.follow_up_time)} type="datetime" display={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : undefined} copy={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : ""} canEdit={canEdit} onSave={(v) => patch({ follow_up_time: v ? new Date(v).toISOString() : null })} />
            <FieldRow label="Direct line saved" value={lead.direct_line_saved == null ? "" : lead.direct_line_saved ? "Yes" : "No"} type="select" options={YES_NO} canEdit={canEdit} onSave={(v) => patch({ direct_line_saved: triBool(v) })} />
            <FieldRow label="Yearly price" value={lead.yearly_price ?? ""} canEdit={canEdit} onSave={(v) => patch({ yearly_price: nz(v) })} />
            <FieldRow className="sm:col-span-2" label="Comments" value={lead.comments ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ comments: nz(v) })} />
          </Section>

          <Section title="Images">
            <FieldRow className="sm:col-span-2" label="Image links (one per line)" value={(lead.image_links ?? []).join("\n")} type="textarea" copy={(lead.image_links ?? []).join("\n")} canEdit={canEdit} onSave={(v) => patch({ image_links: lines(v) })} />
          </Section>

          {canDelete && (
            <div className="pt-2">
              <button onClick={() => setDeleteOpen(true)} className="rounded-md border border-dropped-fg/40 px-4 py-2 text-sm text-dropped-fg hover:bg-dropped-bg">
                Delete lead
              </button>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          <RecentFollowUps leadId={lead.id} businessName={lead.business_name} leadStatus={lead.status} followUps={followUps} />
        </aside>
      </div>

      <StatusChangeModal leadId={lead.id} current={lead.status} businessName={lead.business_name} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <DeleteLeadModal leadId={lead.id} businessName={lead.business_name} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-faint">{title}</div>
      <div className="grid grid-cols-1 divide-y divide-border-subtle sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
        {children}
      </div>
    </div>
  );
}
