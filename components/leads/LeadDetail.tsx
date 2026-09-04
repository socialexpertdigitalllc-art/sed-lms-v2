"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, ClipboardList, Wrench, CalendarClock, Image as ImageIcon, LayoutTemplate, Tags, X, Plus, Lock } from "lucide-react";
import type { Lead, LeadTag } from "@/lib/leads/types";
import { tagColor } from "@/lib/leads/tagColors";
import { toggleTag, ownTags } from "@/lib/leads/tagFilter";
import { Select } from "@/components/common/Select";
import type { LeadFollowUp } from "@/lib/leads/followups";
import type { Ticket, TicketPriority } from "@/lib/tickets/types";
import { SITE_TYPES, FRESH_OPTIONS } from "@/lib/leads/types";
import { toDateTimeLocal, formatDateTime, formatCurrency } from "@/lib/leads/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/common/Toast";
import { StatusPill } from "./StatusPill";
import { StatusChangeModal } from "./StatusChangeModal";
import { DeleteLeadModal } from "./DeleteLeadModal";
import { RecentFollowUps } from "./RecentFollowUps";
import { TicketsCard } from "@/components/tickets/TicketsCard";
import { AgentRunPanel } from "@/components/tickets/AgentRunPanel";
import { SectionCard } from "@/components/forms/formShell";
import { DownloadSiteFilesButton } from "@/components/common/DownloadSiteFilesButton";
import { UploadSiteFilesButton } from "@/components/common/UploadSiteFilesButton";
import { ShuffleSiteButton } from "@/components/common/ShuffleSiteButton";
import { FieldRow, type SelectOption } from "@/components/detail/FieldRow";
import { RatingStars } from "@/components/common/RatingStars";
import { LeadContractsCard } from "@/components/contracts/LeadContractsCard";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import { EmailFieldVerify } from "@/components/email-verify/EmailFieldVerify";
import { ColorSchemeAdvice } from "@/components/leads/ColorSchemeField";
import { RecommendedTemplateField } from "@/components/leads/RecommendedTemplateField";
import { LeadPhotoPicker } from "@/components/leads/LeadPhotoPicker";
import type { ContractRow } from "@/lib/contracts/types";

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
  closingUsers,
  canEditClosedBy,
  isAdmin,
  tickets,
  sla,
  allTags,
  leadTagIds,
  canViewTags,
  canManageTags,
  currentUserId,
  canViewContracts,
  canSendContracts,
  contracts,
  hasContractSent,
  verifiedMailboxes,
}: {
  lead: Lead;
  agents: Agent[];
  followUps: LeadFollowUp[];
  closedByName: string | null;
  closingUsers: { id: string; display_name: string }[];
  canEditClosedBy: boolean;
  /** Member of the Admin department — gates Agent / Closed by / Rating. */
  isAdmin: boolean;
  tickets: Ticket[];
  sla: Record<TicketPriority, number>;
  allTags: LeadTag[];
  leadTagIds: string[];
  canViewTags: boolean;
  canManageTags: boolean;
  currentUserId: string;
  canViewContracts: boolean;
  canSendContracts: boolean;
  contracts: ContractRow[];
  hasContractSent: boolean;
  verifiedMailboxes: { id: string; email_address: string; display_name: string }[];
}) {
  const { has } = usePermissions();
  const canEdit = has("leads.edit");
  const canAssign = has("leads.assign");
  const canDelete = has("leads.delete");
  const canChangeStatus = has("leads.status_change");
  const canWebcraft = has("ai_tools.webcraft");
  const canDeepseek = has("ai_tools.deepseek");
  const canQueue = canWebcraft || canDeepseek;
  const canTemplateGen = has("studio.manage");
  /** Site-file upload + the AI developer share one gate — the same perms the
   *  agent-run routes 403 everyone else on. */
  const canSiteAgent = has("tickets.resolve") || has("studio.manage");
  const router = useRouter();
  const { toast } = useToast();

  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);

  // Tags are user-scoped. The editor only ever touches the caller's OWN tags;
  // tags owned by other users (visible via view_all/shares) render read-only.
  const myTagIds = useMemo(() => new Set(ownTags(allTags, currentUserId).map((t) => t.id)), [allTags, currentUserId]);
  const tagById = Object.fromEntries(allTags.map((t) => [t.id, t] as const));
  // Optimistic local set of the caller's own applied tags; PUT replaces exactly
  // this set (server keeps other users' links intact), reverts on error.
  const [tagIds, setTagIds] = useState<string[]>(() => leadTagIds.filter((id) => myTagIds.has(id)));
  const [savingTags, setSavingTags] = useState(false);
  // Read-only chips: tags on this lead owned by someone else that we can see.
  const otherOwnerTagIds = leadTagIds.filter((id) => !myTagIds.has(id));
  const availableTags = ownTags(allTags, currentUserId).filter((t) => !tagIds.includes(t.id));

  async function saveTags(next: string[]) {
    const prev = tagIds;
    setTagIds(next);
    setSavingTags(true);
    const res = await fetch(`/api/leads/${lead.id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagIds: next }),
    });
    setSavingTags(false);
    if (!res.ok) {
      setTagIds(prev);
      const j = await res.json().catch(() => ({}));
      toast({ kind: "error", title: j.error ?? "Could not update tags" });
      return;
    }
    toast({ kind: "success", title: "Tags updated" });
    router.refresh();
  }
  const removeTag = (id: string) => saveTags(toggleTag(tagIds, id));
  const addTag = (id: string) => { if (id && !tagIds.includes(id)) saveTags(toggleTag(tagIds, id)); };

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
    setQueueMsg(res.ok ? "Queued for generation" : (j.error ?? "Could not queue"));
    toast({
      kind: res.ok ? "success" : "error",
      title: res.ok ? "Queued for website generation" : (j.error ?? "Could not queue"),
    });
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
  const socialProfiles = lead.social_profiles ?? [];
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
              {hasContractSent && <ContractSentBadge />}
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
            {canTemplateGen && (
              <Link href={`/ai-tools/site-studio/runs?lead=${lead.id}`} className={btn + " inline-flex items-center gap-1.5"}>
                <LayoutTemplate size={14} /> Generate from template
              </Link>
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
              <FieldRow label="Owner name" value={lead.owner_name ?? ""} canEdit={canEdit} onSave={(v) => patch({ owner_name: nz(v) })} />
              <FieldRow label="Phone" value={lead.business_phone ?? ""} canEdit={canEdit} onSave={(v) => patch({ business_phone: nz(v) })} />
              {/* A lead submitted with "no email" must still accept one later —
                  the address often arrives after the first call, so this row
                  stays EDITABLE and only its empty-state text differs. Saving an
                  address clears the no_email flag, which re-enables the mail and
                  contract features that skip flagged leads. */}
              <FieldRow
                label="Email"
                value={lead.business_email ?? ""}
                canEdit={canEdit}
                display={lead.no_email && !lead.business_email ? muted("No email — add one if you get it") : undefined}
                onSave={(v) => {
                  const email = nz(v);
                  return patch(email && lead.no_email ? { business_email: email, no_email: false } : { business_email: email });
                }}
                // Advisory only — checks the draft while editing, never gates the save.
                editExtra={(draft, setDraft) => <EmailFieldVerify email={draft} onAccept={setDraft} />}
              />
              <FieldRow label="Profile link" value={lead.business_profile_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ business_profile_link: nz(v) })} />
              <FieldRow
                label="Website link"
                value={lead.website_link ?? ""}
                type="url"
                canEdit={canEdit}
                onSave={(v) => patch({ website_link: nz(v) })}
                display={
                  lead.website_link ? (
                    <span className="inline-flex max-w-full items-center gap-1">
                      <span className="min-w-0 break-words">{lead.website_link}</span>
                      <DownloadSiteFilesButton
                        site={lead.website_link}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45"
                        iconSize={13}
                      />
                      {canSiteAgent && (
                        <>
                          <UploadSiteFilesButton
                            site={lead.website_link}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45"
                            iconSize={13}
                          />
                          <ShuffleSiteButton
                            site={lead.website_link}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink disabled:pointer-events-none disabled:opacity-45"
                            iconSize={13}
                            onShuffled={() => router.refresh()}
                          />
                        </>
                      )}
                    </span>
                  ) : undefined
                }
              />
              {/* A logo sent by SMS is uploaded to an image host afterwards, so the
                  link arrives LATER — the field must stay editable rather than being
                  replaced by static text. The note only shows until a link exists. */}
              <FieldRow
                label="Logo link"
                value={lead.logo_link ?? ""}
                type="url"
                canEdit={canEdit}
                onSave={(v) => patch({ logo_link: nz(v) })}
                display={
                  lead.logo_via_sms && !lead.logo_link
                    ? muted("Sent via SMS — add the link once uploaded")
                    : undefined
                }
              />
              <FieldRow label="Map embed link" value={lead.map_embed_link ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ map_embed_link: nz(v) })} />
              <FieldRow label="Reference link" value={lead.reference_link ?? ""} type="url" canEdit={canEdit} onSave={(v) => patch({ reference_link: nz(v) })} />
              {designRefs.length > 0 ? (
                designRefs.map((link, i) => (
                  <FieldRow key={i} label={`Design reference ${i + 1}`} value={link} type="url" />
                ))
              ) : (
                <FieldRow label="Design reference sites" value="" />
              )}
              {/* Read-only here: profiles are a structured list, and the
                  submission form is where they are composed. */}
              {socialProfiles.length > 0 ? (
                socialProfiles.map((p, i) => (
                  <FieldRow
                    key={i}
                    label={p.platform === "Other" ? p.label || "Other" : p.platform}
                    value={p.url}
                    type="url"
                  />
                ))
              ) : (
                <FieldRow label="Social profiles" value="" />
              )}
            </div>
            {/* AI developer, ticketless: direct edits on this site, reviewed
                before deploy (v2 F5). Sits right under the website link and
                its file buttons — the same gate as the upload icon. */}
            {lead.website_link && canSiteAgent ? (
              <div className="mt-4">
                <AgentRunPanel
                  leadId={lead.id}
                  websiteLink={lead.website_link}
                  canViewAgentRuns={canSiteAgent}
                  canResolve={canSiteAgent}
                />
              </div>
            ) : null}
          </SectionCard>

          <SectionCard n={2} icon={ClipboardList} title="Lead info" subtitle="Status, pricing & rating" done={false} delay={60}>
            <div className={grid}>
              <FieldRow label="Agent" value={lead.agent_id ?? ""} type="select" options={agentOptions} display={agentName} canEdit={isAdmin && canAssign} onSave={(v) => patch({ agent_id: v || null })} />
              <FieldRow
                label="Closed by"
                value={lead.closed_by ?? ""}
                type="select"
                options={[{ value: "", label: "— (none) —" }, ...closingUsers.map((u) => ({ value: u.id, label: u.display_name }))]}
                display={closedByName}
                canEdit={isAdmin && canEditClosedBy}
                onSave={(v) => patch({ closed_by: v || null })}
              />
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
              <FieldRow label="Rating (1–10)" value={lead.rating?.toString() ?? ""} type="number" display={<RatingStars value={lead.rating} />} canEdit={isAdmin} onSave={(v) => patch({ rating: num(v) })} />
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
              {/* Always editable. Legacy "same as logo" leads used to render read-only,
                  which meant the one field that needed fixing was the one field nobody
                  could fix. The old intent survives as a display hint only. */}
              <FieldRow
                label="Color scheme"
                value={lead.color_scheme ?? ""}
                display={
                  lead.color_same_as_logo && !lead.color_scheme
                    ? muted("Was: same as logo — set explicit colours")
                    : undefined
                }
                canEdit={canEdit}
                onSave={(v) => patch({ color_scheme: nz(v) })}
                editExtra={(draft, setDraft) => (
                  <ColorSchemeAdvice
                    draft={draft}
                    onApply={setDraft}
                    context={{
                      business_name: lead.business_name ?? undefined,
                      services: lead.services ?? undefined,
                      site_type: lead.site_type ?? undefined,
                    }}
                  />
                )}
              />

              <FieldRow label="Client experience (years)" value={lead.client_experience?.toString() ?? ""} type="number" canEdit={canEdit} onSave={(v) => patch({ client_experience: num(v) })} />
            </div>
            {/* The template sales agreed with the client on the call. It was
                only ever visible on the submission form until now, so the
                builder's "recommended" pick had no place to be checked. */}
            <div className="mt-4">
              <RecommendedTemplateField
                templateId={lead.recommended_template_id}
                canEdit={canEdit}
                onChange={async (id) => {
                  try {
                    await patch({ recommended_template_id: id || null });
                  } catch (e) {
                    toast({ kind: "error", title: "Could not save the template", body: e instanceof Error ? e.message : "Save failed" });
                    throw e;
                  }
                }}
              />
            </div>
          </SectionCard>

          <SectionCard n={4} icon={CalendarClock} title="Follow-up & notes" subtitle="Timing & context" done={false} delay={180}>
            <div className={grid}>
              <FieldRow label="Follow-up date & time" value={toDateTimeLocal(lead.follow_up_time)} type="datetime" display={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : undefined} copy={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : ""} canEdit={canEdit} onSave={(v) => patch({ follow_up_time: v ? new Date(v).toISOString() : null })} />
              <FieldRow label="Direct line saved" value={lead.direct_line_saved == null ? "" : lead.direct_line_saved ? "Yes" : "No"} type="select" options={YES_NO} canEdit={canEdit} onSave={(v) => patch({ direct_line_saved: triBool(v) })} />
              <FieldRow label="Yearly price" value={lead.yearly_price ?? ""} canEdit={canEdit} onSave={(v) => patch({ yearly_price: nz(v) })} />
              <FieldRow className="sm:col-span-2" label="Comments" value={lead.comments ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ comments: nz(v) })} />
              {/* Free-text background the website generator reads as supplied fact. */}
              <FieldRow className="sm:col-span-2" label="About business" value={lead.about_business ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ about_business: nz(v) })} />
              <FieldRow className="sm:col-span-2" label="Instructions for developer" value={lead.developer_instructions ?? ""} type="textarea" canEdit={canEdit} onSave={(v) => patch({ developer_instructions: nz(v) })} />
            </div>
          </SectionCard>

          <SectionCard n={5} icon={ImageIcon} title="Images" subtitle="Reference imagery" done={false} delay={240}>
            <div className="space-y-4">
              <LeadPhotoPicker leadId={lead.id} profileLink={lead.business_profile_link} canEdit={canEdit} />
              <FieldRow label="Image links (one per line)" value={(lead.image_links ?? []).join("\n")} type="textarea" copy={(lead.image_links ?? []).join("\n")} canEdit={canEdit} onSave={(v) => patch({ image_links: lines(v) })} />
            </div>
          </SectionCard>

          {canViewTags && (
            <SectionCard n={6} icon={Tags} title="Tags" subtitle="Categorize this lead" done={false} delay={300}>
              <div className="flex flex-wrap items-center gap-2">
                {tagIds.length === 0 && otherOwnerTagIds.length === 0 && (
                  <span className="text-sm text-text-faint">No tags</span>
                )}
                {/* Editable — the caller's own tags */}
                {tagIds.map((id) => {
                  const t = tagById[id];
                  if (!t) return null;
                  const col = tagColor(t.color);
                  return (
                    <span
                      key={id}
                      style={{ background: col.chipBg, color: col.chipFg, borderColor: col.hex + "55" }}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                    >
                      {t.name}
                      {canManageTags && (
                        <button
                          type="button"
                          onClick={() => removeTag(id)}
                          disabled={savingTags}
                          aria-label={`Remove tag ${t.name}`}
                          className="hover:opacity-70 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  );
                })}
                {/* Read-only — tags owned by another user, visible via sharing / view-all */}
                {otherOwnerTagIds.map((id) => {
                  const t = tagById[id];
                  if (!t) return null;
                  const col = tagColor(t.color);
                  return (
                    <span
                      key={id}
                      title="Owned by another user — read-only"
                      style={{ background: col.chipBg, color: col.chipFg, borderColor: col.hex + "55" }}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium opacity-80"
                    >
                      <Lock className="h-2.5 w-2.5 shrink-0" />
                      {t.name}
                    </span>
                  );
                })}
              </div>
              {canManageTags && availableTags.length > 0 && (
                <div className="mt-3 inline-flex items-center gap-2">
                  <Plus className="h-4 w-4 text-text-faint" />
                  <Select
                    value=""
                    onChange={(e) => addTag(e.target.value)}
                    disabled={savingTags}
                    className="px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-muted outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                  >
                    <option value="">Add tag…</option>
                    {availableTags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </div>
              )}
              {canManageTags && availableTags.length === 0 && tagIds.length === 0 && (
                <p className="mt-2 text-xs text-text-faint">
                  You have no tags yet — create tags from the Tags filter on the Leads list.
                </p>
              )}
            </SectionCard>
          )}

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
            {canViewContracts && (
              <LeadContractsCard
                leadId={lead.id}
                contracts={contracts}
                mailboxes={verifiedMailboxes}
                canSend={canSendContracts}
                recipientEmail={lead.no_email ? null : lead.business_email}
                leadOneTimePrice={lead.price_quoted}
                leadYearlyPrice={lead.yearly_price}
              />
            )}
            <RecentFollowUps leadId={lead.id} businessName={lead.business_name} leadStatus={lead.status} followUps={followUps} />
            <TicketsCard leadId={lead.id} leadStatus={lead.status} tickets={tickets} sla={sla} />
          </div>
        </aside>
      </div>

      <StatusChangeModal leadId={lead.id} current={lead.status} businessName={lead.business_name} websiteLink={lead.website_link} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <DeleteLeadModal leadId={lead.id} businessName={lead.business_name} open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}
