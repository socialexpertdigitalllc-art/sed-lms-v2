"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads/types";
import { LEAD_STATUSES, SITE_TYPES, FRESH_OPTIONS } from "@/lib/leads/types";
import { toDateTimeLocal } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { DeleteLeadModal } from "./DeleteLeadModal";

type Agent = { id: string; display_name: string | null };

const nz = (s: string) => (s.trim() === "" ? null : s.trim());
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const triBool = (s: string) => (s === "" ? null : s === "Yes");
const lines = (s: string) => s.split("\n").map((t) => t.trim()).filter(Boolean);
const commas = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);

function initialForm(lead: Lead) {
  return {
    business_name: lead.business_name ?? "",
    business_phone: lead.business_phone ?? "",
    business_email: lead.business_email ?? "",
    business_profile_link: lead.business_profile_link ?? "",
    website_link: lead.website_link ?? "",
    logo_link: lead.logo_link ?? "",
    map_embed_link: lead.map_embed_link ?? "",
    reference_link: lead.reference_link ?? "",
    image_links: (lead.image_links ?? []).join("\n"),
    agent_id: lead.agent_id ?? "",
    status: lead.status,
    site_type: lead.site_type ?? "",
    platform: lead.platform ?? "",
    price_quoted: lead.price_quoted?.toString() ?? "",
    rating: lead.rating?.toString() ?? "",
    fresh_or_followup: lead.fresh_or_followup ?? "",
    services: (lead.services ?? []).join(", "),
    service_areas: (lead.service_areas ?? []).join(", "),
    has_service_areas: lead.has_service_areas == null ? "" : lead.has_service_areas ? "Yes" : "No",
    num_webpages: lead.num_webpages?.toString() ?? "",
    specify_pages: (lead.specify_pages ?? []).join(", "),
    color_scheme: lead.color_scheme ?? "",
    client_experience: lead.client_experience?.toString() ?? "",
    follow_up_time: toDateTimeLocal(lead.follow_up_time),
    direct_line_saved: lead.direct_line_saved == null ? "" : lead.direct_line_saved ? "Yes" : "No",
    yearly_price: lead.yearly_price ?? "",
    comments: lead.comments ?? "",
  };
}

export function LeadDetail({ lead, agents }: { lead: Lead; agents: Agent[] }) {
  const { has } = usePermissions();
  const canEdit = has("leads.edit");
  const canDelete = has("leads.delete");
  const canChangeStatus = has("leads.status_change");
  const canWebcraft = has("ai_tools.webcraft");
  const canDeepseek = has("ai_tools.deepseek");
  const canQueue = canWebcraft || canDeepseek;
  const router = useRouter();

  const [f, setF] = useState(() => initialForm(lead));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);
  async function queueForGeneration() {
    setQueuing(true); setQueueMsg(null);
    const res = await fetch("/api/ai-tools/wge/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) });
    setQueuing(false);
    const j = await res.json().catch(() => ({}));
    setQueueMsg(res.ok ? "Queued for generation ✓" : (j.error ?? "Could not queue"));
  }
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload = {
      business_name: f.business_name.trim(),
      business_phone: nz(f.business_phone),
      business_email: nz(f.business_email),
      business_profile_link: nz(f.business_profile_link),
      website_link: nz(f.website_link),
      logo_link: nz(f.logo_link),
      map_embed_link: nz(f.map_embed_link),
      reference_link: nz(f.reference_link),
      image_links: lines(f.image_links),
      agent_id: f.agent_id || null,
      status: f.status,
      site_type: f.site_type || null,
      platform: nz(f.platform),
      price_quoted: numOrNull(f.price_quoted),
      rating: numOrNull(f.rating),
      fresh_or_followup: f.fresh_or_followup || null,
      services: commas(f.services),
      service_areas: commas(f.service_areas),
      has_service_areas: triBool(f.has_service_areas),
      num_webpages: numOrNull(f.num_webpages),
      specify_pages: commas(f.specify_pages),
      color_scheme: nz(f.color_scheme),
      client_experience: numOrNull(f.client_experience),
      follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
      direct_line_saved: triBool(f.direct_line_saved),
      yearly_price: nz(f.yearly_price),
      comments: nz(f.comments),
    };
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Save failed" });
      return;
    }
    setMsg({ ok: true, text: "Saved" });
    router.refresh();
  }

  const ro = !canEdit;

  return (
    <div className="max-w-4xl">
      <Link href="/leads" className="text-xs text-text-muted hover:text-text">← Leads</Link>
      <div className="flex items-start justify-between mt-2 mb-5 gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text truncate">{lead.business_name}</h1>
          <div className="flex items-center gap-2 mt-1.5">
            <StatusPill status={lead.status} />
            <span className="text-xs text-text-faint font-mono">#{lead.id.slice(0, 8)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => router.refresh()} className="text-sm px-3 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">
            Refresh
          </button>
          {canChangeStatus && (
            <button onClick={() => setStatusOpen(true)} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2">
              Change status
            </button>
          )}
          {canWebcraft && (
            <Link href={`/ai-tools/webcraft?lead=${lead.id}`} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2">
              Generate (WebCraft)
            </Link>
          )}
          {canDeepseek && (
            <Link href={`/ai-tools/deepseek?lead=${lead.id}`} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2">
              Generate (DeepSeek)
            </Link>
          )}
          {canQueue && (
            <button onClick={queueForGeneration} disabled={queuing} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2 disabled:opacity-60">
              {queuing ? "Queuing…" : "Queue for generation"}
            </button>
          )}
          {canEdit && (
            <button onClick={save} disabled={busy} className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
          {msg.text}
        </div>
      )}
      {queueMsg && <div className="mb-4 text-sm rounded-md px-3 py-2 bg-accent-soft text-accent-ink">{queueMsg}</div>}

      <div className="space-y-5">
        <Section title="Business info">
          <Field label="Business name"><input disabled={ro} value={f.business_name} onChange={set("business_name")} className={inputCls(ro)} /></Field>
          <Field label="Phone"><input disabled={ro} value={f.business_phone} onChange={set("business_phone")} className={inputCls(ro)} /></Field>
          <Field label="Email"><input disabled={ro} value={f.business_email} onChange={set("business_email")} className={inputCls(ro)} /></Field>
          <Field label="Profile link"><input disabled={ro} value={f.business_profile_link} onChange={set("business_profile_link")} className={inputCls(ro)} /></Field>
          <Field label="Website link"><input disabled={ro} value={f.website_link} onChange={set("website_link")} className={inputCls(ro)} /></Field>
          <Field label="Logo link"><input disabled={ro} value={f.logo_link} onChange={set("logo_link")} className={inputCls(ro)} /></Field>
          <Field label="Map embed link"><input disabled={ro} value={f.map_embed_link} onChange={set("map_embed_link")} className={inputCls(ro)} /></Field>
          <Field label="Reference link"><input disabled={ro} value={f.reference_link} onChange={set("reference_link")} className={inputCls(ro)} /></Field>
        </Section>

        <Section title="Lead info">
          <Field label="Agent">
            <select disabled={ro} value={f.agent_id} onChange={set("agent_id")} className={inputCls(ro)}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select disabled={ro} value={f.status} onChange={set("status")} className={inputCls(ro)}>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Site type">
            <select disabled={ro} value={f.site_type} onChange={set("site_type")} className={inputCls(ro)}>
              <option value="">—</option>
              {SITE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Platform"><input disabled={ro} value={f.platform} onChange={set("platform")} className={inputCls(ro)} /></Field>
          <Field label="Price quoted ($)"><input disabled={ro} type="number" value={f.price_quoted} onChange={set("price_quoted")} className={inputCls(ro)} /></Field>
          <Field label="Rating (1–10)"><input disabled={ro} type="number" min={1} max={10} value={f.rating} onChange={set("rating")} className={inputCls(ro)} /></Field>
          <Field label="Fresh or follow-up">
            <select disabled={ro} value={f.fresh_or_followup} onChange={set("fresh_or_followup")} className={inputCls(ro)}>
              <option value="">—</option>
              {FRESH_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Services & scope">
          <Field label="Services (comma-separated)"><input disabled={ro} value={f.services} onChange={set("services")} className={inputCls(ro)} /></Field>
          <Field label="Service areas (comma-separated)"><input disabled={ro} value={f.service_areas} onChange={set("service_areas")} className={inputCls(ro)} /></Field>
          <Field label="Has service areas">
            <select disabled={ro} value={f.has_service_areas} onChange={set("has_service_areas")} className={inputCls(ro)}>
              <option value="">—</option><option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="No. of webpages"><input disabled={ro} type="number" value={f.num_webpages} onChange={set("num_webpages")} className={inputCls(ro)} /></Field>
          <Field label="Specify pages (comma-separated)"><input disabled={ro} value={f.specify_pages} onChange={set("specify_pages")} className={inputCls(ro)} /></Field>
          <Field label="Color scheme"><input disabled={ro} value={f.color_scheme} onChange={set("color_scheme")} className={inputCls(ro)} /></Field>
          <Field label="Client experience (years)"><input disabled={ro} value={f.client_experience} onChange={set("client_experience")} className={inputCls(ro)} /></Field>
        </Section>

        <Section title="Follow-up & notes">
          <Field label="Follow-up date & time"><input disabled={ro} type="datetime-local" value={f.follow_up_time} onChange={set("follow_up_time")} className={inputCls(ro)} /></Field>
          <Field label="Direct line saved">
            <select disabled={ro} value={f.direct_line_saved} onChange={set("direct_line_saved")} className={inputCls(ro)}>
              <option value="">—</option><option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Yearly price"><input disabled={ro} value={f.yearly_price} onChange={set("yearly_price")} className={inputCls(ro)} /></Field>
          <Field label="Comments" full><textarea disabled={ro} value={f.comments} onChange={set("comments")} rows={3} className={inputCls(ro)} /></Field>
        </Section>

        <Section title="Images">
          <Field label="Image links (one per line)" full><textarea disabled={ro} value={f.image_links} onChange={set("image_links")} rows={3} className={inputCls(ro) + " font-mono text-xs"} /></Field>
        </Section>

        {canDelete && (
          <div className="pt-2">
            <button onClick={() => setDeleteOpen(true)} className="text-sm px-4 py-2 rounded-md border border-dropped-fg/40 text-dropped-fg hover:bg-dropped-bg">
              Delete lead
            </button>
          </div>
        )}
      </div>

      <StatusChangeModal leadId={lead.id} current={lead.status} businessName={lead.business_name} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <DeleteLeadModal leadId={lead.id} businessName={lead.business_name} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
      {children}
    </div>
  );
}

function inputCls(ro: boolean) {
  return (
    "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent " +
    (ro ? "opacity-70 cursor-not-allowed" : "")
  );
}
