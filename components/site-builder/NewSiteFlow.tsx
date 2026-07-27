"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Rocket, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { BuilderImagePicker, type PickedImage } from "@/components/site-builder/BuilderImagePicker";
import type { BuilderTemplateRow } from "@/components/site-builder/TemplatesBoard";

/** Only the fields this screen actually reads off a lead row — see
 *  `lib/site-studio/run/dossier.ts`'s own rule on why a generation launcher
 *  has no business looking at commercial/internal fields. */
interface LeadOption {
  id: string;
  business_name: string;
  status: string;
  deleted_at: string | null;
  business_phone: string | null;
  business_email: string | null;
  services: string[] | null;
  service_areas: string[] | null;
  color_scheme: string | null;
  specify_pages: string[] | null;
  about_business: string | null;
  image_links: string[] | null;
}

/**
 * The whole Site Builder flow on one screen: pick a lead, pick a template,
 * pick images (each labelled with a purpose), then Generate. Mirrors
 * `RunLaunch.tsx`'s sectioned layout, but as its own page rather than a
 * slide-over — there is no separate "pages" or "fan-out" step here (Site
 * Builder has no manifest to fan out against; every template page is always
 * rewritten, plus whatever extra pages the lead's own `specify_pages` asks
 * for — see `lib/site-builder/run.ts#runSite`).
 */
export function NewSiteFlow() {
  const router = useRouter();
  const { toast } = useToast();

  const [leads, setLeads] = useState<LeadOption[] | null>(null);
  const [templates, setTemplates] = useState<BuilderTemplateRow[] | null>(null);
  const [leadQuery, setLeadQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load leads");
      setLeads((body.leads ?? []) as LeadOption[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load leads" });
      setLeads([]);
    }
  }, [toast]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/site-builder/templates");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load templates");
      setTemplates((body.templates ?? []) as BuilderTemplateRow[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load templates" });
      setTemplates([]);
    }
  }, [toast]);

  useEffect(() => { void loadLeads(); void loadTemplates(); }, [loadLeads, loadTemplates]);

  const eligibleLeads = useMemo(() => (leads ?? []).filter((l) => l.status === "Not Ready" && !l.deleted_at), [leads]);
  const shownLeads = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    if (!q) return eligibleLeads;
    return eligibleLeads.filter((l) => l.business_name.toLowerCase().includes(q));
  }, [eligibleLeads, leadQuery]);
  const selectedLead = useMemo(() => eligibleLeads.find((l) => l.id === selectedLeadId) ?? null, [eligibleLeads, selectedLeadId]);

  function selectLead(lead: LeadOption) {
    setSelectedLeadId(lead.id);
    setImages([]);
  }

  const purposeSuggestions = useMemo(() => {
    const base = ["Hero", "Gallery", "About"];
    const services = selectedLead?.services ?? [];
    return [...base, ...services.map((s) => `Service: ${s}`)];
  }, [selectedLead]);

  const clientPhotos = selectedLead?.image_links ?? [];

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePurpose(index: number, purpose: string) {
    setImages((prev) => prev.map((img, i) => (i === index ? { ...img, purpose } : img)));
  }

  async function generate() {
    if (!selectedLead) { toast({ kind: "error", title: "Pick a lead first" }); return; }
    if (!templateId) { toast({ kind: "error", title: "Pick a template first" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/site-builder/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: selectedLead.id, template_id: templateId, images }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not start the run" });
        return;
      }
      toast({ kind: "success", title: "Generating…" });
      router.push(`/ai-tools/site-builder/runs/${body.run.id}`);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not start the run" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="New site"
        description="Pick a lead, a template, and the images you want used — the AI writes the whole site from there."
      />

      {/* 1. Lead */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">1. Lead (Not Ready)</h3>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "pl-8")}
            value={leadQuery}
            onChange={(e) => setLeadQuery(e.target.value)}
            placeholder="Search leads by business name"
            aria-label="Search leads"
          />
        </div>
        {leads === null ? (
          <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading leads…</p>
        ) : shownLeads.length === 0 ? (
          <p className="text-sm text-text-muted">No "Not Ready" leads match.</p>
        ) : (
          <ul className="max-h-52 divide-y divide-border overflow-auto rounded-md border border-border">
            {shownLeads.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => selectLead(l)}
                  aria-pressed={selectedLeadId === l.id}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm",
                    selectedLeadId === l.id ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2 text-text",
                  )}
                >
                  {l.business_name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedLead ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-muted">
            <dt className="font-medium text-text">Phone</dt><dd>{selectedLead.business_phone ?? "—"}</dd>
            <dt className="font-medium text-text">Email</dt><dd>{selectedLead.business_email ?? "—"}</dd>
            <dt className="font-medium text-text">Services</dt><dd>{(selectedLead.services ?? []).join(", ") || "—"}</dd>
            <dt className="font-medium text-text">Areas</dt><dd>{(selectedLead.service_areas ?? []).join(", ") || "—"}</dd>
            <dt className="font-medium text-text">Colours</dt><dd>{selectedLead.color_scheme ?? "—"}</dd>
            <dt className="font-medium text-text">Requested pages</dt><dd>{(selectedLead.specify_pages ?? []).join(", ") || "—"}</dd>
            <dt className="col-span-2 font-medium text-text">About</dt>
            <dd className="col-span-2">{selectedLead.about_business ?? "—"}</dd>
          </dl>
        ) : null}
      </section>

      {/* 2. Template */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">2. Template</h3>
        {templates === null ? (
          <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-text-muted">No templates yet — upload one on the Templates tab first.</p>
        ) : (
          <select
            className={inputCls}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            aria-label="Template"
          >
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.page_files.length} page{t.page_files.length === 1 ? "" : "s"})</option>
            ))}
          </select>
        )}
      </section>

      {/* 3. Images */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">3. Images</h3>
          <button
            type="button"
            className={btnSecondarySm}
            onClick={() => setPickerOpen(true)}
            disabled={!selectedLead}
          >
            <Plus className="h-3.5 w-3.5" /> Add image
          </button>
        </div>
        {!selectedLead ? (
          <p className="text-sm text-text-muted">Pick a lead first.</p>
        ) : images.length === 0 ? (
          <p className="text-sm text-text-muted">No images picked yet — the AI will keep the template's own images unless you add some.</p>
        ) : (
          <ul className="space-y-2">
            {images.map((img, i) => (
              <li key={`${img.url}-${i}`} className="flex items-center gap-3 rounded-md border border-border p-2">
                <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                </span>
                <input
                  className={cn(inputCls, "flex-1")}
                  value={img.purpose}
                  onChange={(e) => updatePurpose(i, e.target.value)}
                  aria-label={`Purpose for image ${i + 1}`}
                />
                <button
                  type="button"
                  className={iconBtnDanger}
                  title="Remove image"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => removeImage(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => void generate()} disabled={submitting || !selectedLead || !templateId}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Generate
        </button>
      </div>

      {pickerOpen ? (
        <BuilderImagePicker
          leadId={selectedLead?.id ?? null}
          purposeSuggestions={purposeSuggestions}
          clientPhotos={clientPhotos}
          onAdded={(img) => setImages((prev) => [...prev, img])}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
