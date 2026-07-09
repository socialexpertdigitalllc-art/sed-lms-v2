"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ClipboardList, Wrench, CalendarClock, Image as ImageIcon } from "lucide-react";
import type { Lead } from "@/lib/leads/types";
import type { LeadFollowUp } from "@/lib/leads/followups";
import type { Ticket, TicketPriority } from "@/lib/tickets/types";
import { SITE_TYPES, FRESH_OPTIONS } from "@/lib/leads/types";
import { toDateTimeLocal, formatDateTime, formatCurrency } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { DeleteLeadModal } from "./DeleteLeadModal";
import { RecentFollowUps } from "./RecentFollowUps";
import { TicketsCard } from "@/components/tickets/TicketsCard";
import { SectionCard } from "@/components/forms/formShell";
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
  closedByName,
  tickets,
  sla,
}: {
  lead: Lead;
  agents: Agent[];
  followUps: LeadFollowUp[];
  closedByName: string | null;
  tickets: Ticket[];
  sla: Record<TicketPriority, number>;
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
  const muted = (text: string) => <span className="text-text-faint">{text}</span>;

  const agentName = (lead.agent_id && agents.find((a) => a.id === lead.agent_id)?.display_name) || "Unassigned";
  const agentOptions: SelectOption[] = [
    { value: "", label: "Unassigned" },
    ...agents.map((a) => ({ value: a.id, label: a.display_name ?? a.id })),
  ];
  const designRefs = lead.design_reference_links ?? [];
  const addOns = lead.add_ons ?? [];

  const btn = "rounded-lg border border-border bg-surface/70 px-3 py-2 text-sm text-text hover:bg-surface-2";
  const grid = "grid grid-cols-1 gap-x-8 sm:grid-cols-2";

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header band */}
      <div className="reveal relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="glow-teal absolute -right-16 -top-24 h-64 w-64" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="min-w-0">
            <Link href="/leads" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
              <ArrowLeft size={13} /> Leads
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">Lead</p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-text">{lead.business_name}</h1>
            <div className="mt-1.5 flex items-center gap-2">
              <StatusPill status={lead.status} />
              <span className="font-mono text-xs text-text-faint">#{lead.id.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => router.refresh()} className={btn + " text-text-muted"}>Refresh</button>
            {canChangeStatus && <button onClick={() => setStatusOpen(true)} className={btn}>Change status</button>}
            {canWebcraft && <Link href={`/ai-tools/webcraft?lead=${lead.id}`} className={btn}>Generate (WebCraft)</Link>}
            {canDeepseek && <Link href={`/ai-tools/deepseek?lead=${lead.id}`} className={btn}>Generate (DeepSeek)</Link>}
            {canQueue && (
              <button onClick={queueForGeneration} disabled={queuing} className={btn + " disabled:opacity-60"}>
                {queuing ? "Queuing…" : "Queue for generation"}
              </button>
            )}
          </div>
        </div>
      </div>

      {queueMsg && <div className="mb-4 rounded-lg bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">{queueMsg}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <SectionCard n={1} icon={Building2} title="Business info" subtitle="Contact & links" done={false} delay={0}>
            <div className={grid}>
              <FieldRow label="Business name" value={lead.business_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_name: v.trim() })} />
              <FieldRow label="Phone" value={lead.business_phone ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_phone: nz(v) })} />
              {lead.no_email ? (
                <FieldRow label="Email" value="" display={muted("No email")} />
              ) : (
                <FieldRow label="Email" value={lead.business_email ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_email: nz(v) })} />
              )}
              <FieldRow label="Profile link" value={lead.business_profile_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ business_profile_link: nz(v) })} />
              <FieldRow label="Website link" value={lead.website_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ website_link: nz(v) })} />
              {lead.logo_via_sms ? (
                <FieldRow label="Logo link" value="" display={muted("Sent via SMS")} />
              ) : (
                <FieldRow label="Logo link" value={lead.logo_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ logo_link: nz(v) })} />
              )}
              <FieldRow label="Map embed link" value={lead.map_embed_link ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ map_embed_link: nz(v) })} />
              <FieldRow label="Reference link" value={lead.reference_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ reference_link: nz(v) })} />
              {designRefs.length > 0 ? (
                designRefs.map((link, i) => (
                  <FieldRow key={i} label={`Design reference ${i + 1}`} value={link} type="url" />
                ))
              ) : (
                <FieldRow label="Design reference sites" value="" />
              )}
            </div>
          </SectionCard>

          <SectionCard n={2} icon={ClipboardList} title="Lead info" subtitle="Status, pricing & rating" done={false} delay={60}>
            <div className={grid}>
              <FieldRow label="Agent" value={lead.agent_id ?? ""} type="select" options={agentOptions} display={agentName} canEdit={canEdit} onSave={(v) => patch({ agent_id: v || null })} />
              <FieldRow label="Closed by" value={lead.closed_by ?? ""} display={closedByName} />
              {/* Status is read-only here — edited via the "Change status" button (respects category permissions). */}
              <FieldRow label="Status" value={lead.status} display={<StatusPill status={lead.status} />} />
              <FieldRow label="Site type" value={lead.site_type ?? ""} type="select" options={[{ value: "", label: "—" }, ...SITE_TYPES.map((s) => ({ value: s, label: s }))]} canEdit={canEdit} onSave={(v) => patch({ site_type: v || null })} />
              <FieldRow label="Platform" value={lead.platform ?? ""} canEdit={canEdit} onSave={(v) => patch({ platform: nz(v) })} />
              <FieldRow label="Price quoted" value={lead.price_quoted?.toString() ?? ""} type="number" display={lead.price_quoted != null ? formatCurrency(lead.price_quoted) : undefined} canEdit={canEdit} onSave={(v) => patch({ price_quoted: num(v) })} />
              {addOns.length > 0 ? (
                <FieldRow
                  className="sm:col-span-2"
                  label="Add-ons"
                  value=""
                  display={
                    <ul className="space-y-0.5">
                      {addOns.map((a) => (
                        <li key={a.id}>
                          {a.label}
                          {a.price != null ? ` — ${formatCurrency(a.price)}` : ""}
                        </li>
                      ))}
                    </ul>
                  }
                />
              ) : (
                <FieldRow className="sm:col-span-2" label="Add-ons" value="" />
              )}
              <FieldRow label="Rating (1–10)" value={lead.rating?.toString() ?? ""} type="number" display={lead.rating != null ? `${lead.rating}/10` : undefined} canEdit={canEdit} onSave={(v) => patch({ rating: num(v) })} />
              <FieldRow label="Fresh or follow-up" value={lead.fresh_or_followup ?? ""} type="select" options={[{ value: "", label: "—" }, ...FRESH_OPTIONS.map((s) => ({ value: s, label: s }))]} canEdit={canEdit} onSave={(v) => patch({ fresh_or_followup: v || null })} />
            </div>
          </SectionCard>

          <SectionCard n={3} icon={Wrench} title="Services & scope" subtitle="What we're building" done={false} delay={120}>
            <div className={grid}>
              <FieldRow label="Services" value={(lead.services ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ services: commas(v) })} />
              <FieldRow label="Service areas" value={(lead.service_areas ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ service_areas: commas(v) })} />
              <FieldRow label="Has service areas" value={lead.has_service_areas == null ? "" : lead.has_service_areas ? "Yes" : "No"} type="select" options={YES_NO} canEdit={canEdit} onSave={(v) => patch({ has_service_areas: triBool(v) })} />
              <FieldRow label="No. of webpages" value={lead.num_webpages?.toString() ?? ""} type="number" canEdit={canEdit} onSave={(v) => patch({ num_webpages: num(v) })} />
              <FieldRow label="Specify pages" value={(lead.specify_pages ?? []).join(", ")} canEdit={canEdit} onSave={(v) => patch({ specify_pages: commas(v) })} />
              {lead.color_same_as_logo ? (
                <FieldRow label="Color scheme" value="" display={muted("Same as logo")} />
              ) : (
                <FieldRow label="Color scheme" value={lead.color_scheme ?? ""} canEdit={canEdit} onSave={(v) => patch({ color_scheme: nz(v) })} />
              )}
              <FieldRow label="Client experience (years)" value={lead.client_experience?.toString() ?? ""} type="number" canEdit={canEdit} onSave={(v) => patch({ client_experience: num(v) })} />
            </div>
          </SectionCard>

          <SectionCard n={4} icon={CalendarClock} title="Follow-up & notes" subtitle="Timing & context" done={false} delay={180}>
            <div className={grid}>
              <FieldRow label="Follow-up date & time" value={toDateTimeLocal(lead.follow_up_time)} type="datetime" display={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : undefined} copy={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : ""} canEdit={canEdit} onSave={(v) => patch({ follow_up_time: v ? new Date(v).toISOString() : null })} />
              <FieldRow label="Direct line saved" value={lead.direct_line_saved == null ? "" : lead.direct_line_saved ? "Yes" : "No"} type="select" options={YES_NO} canEdit={canEdit} onSave={(v) => patch({ direct_line_saved: triBool(v) })} />
              <FieldRow label="Yearly price" value={lead.yearly_price ?? ""} canEdit={canEdit} onSave={(v) => patch({ yearly_price: nz(v) })} />
              <FieldRow className="sm:col-span-2" label="Comments" value={lead.comments ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ comments: nz(v) })} />
            </div>
          </SectionCard>

          <SectionCard n={5} icon={ImageIcon} title="Images" subtitle="Reference imagery" done={false} delay={240}>
            <FieldRow label="Image links (one per line)" value={(lead.image_links ?? []).join("\n")} type="textarea" copy={(lead.image_links ?? []).join("\n")} canEdit={canEdit} onSave={(v) => patch({ image_links: lines(v) })} />
          </SectionCard>

          {canDelete && (
            <div className="pt-1">
              <button onClick={() => setDeleteOpen(true)} className="rounded-lg border border-dropped-fg/40 px-4 py-2 text-sm text-dropped-fg hover:bg-dropped-bg">
                Delete lead
              </button>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-6">
            <RecentFollowUps leadId={lead.id} businessName={lead.business_name} leadStatus={lead.status} followUps={followUps} />
            <TicketsCard leadId={lead.id} leadStatus={lead.status} tickets={tickets} sla={sla} />
          </div>
        </aside>
      </div>

      <StatusChangeModal leadId={lead.id} current={lead.status} businessName={lead.business_name} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <DeleteLeadModal leadId={lead.id} businessName={lead.business_name} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}
