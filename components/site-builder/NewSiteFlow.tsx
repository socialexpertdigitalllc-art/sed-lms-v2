"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, Rocket, Search } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm } from "@/components/common/buttons";
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

interface NeedCandidate {
  kind: "library" | "pexels";
  key: string;
  width: number;
  height: number;
  thumb_url: string | null;
  asset_id?: string;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
}

/** A candidate picked through the "search instead" escape hatch. Unlike an
 *  auto-sourced candidate (rehosted only once actually used, at Generate),
 *  `BuilderImagePicker` rehosts immediately on pick — so this already carries
 *  a durable `url`, not just a thumbnail. */
interface ManualPick {
  key: "manual";
  thumb_url: string;
  url: string;
  purpose: string;
}

interface NeedRow {
  purpose: string;
  query: string;
  candidates: NeedCandidate[];
  manualPick: ManualPick | null;
  pexelsError: string | null;
  /** A candidate's `key`, `"manual"`, or null for an explicit "no image". */
  pickedKey: string | null;
}

interface SourceApiCandidate {
  kind: "library" | "pexels";
  key: string;
  width: number;
  height: number;
  thumb_url: string | null;
  asset_id?: string;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
}
interface SourceApiNeed {
  purpose: string;
  query: string;
  pexelsError: string | null;
  candidates: SourceApiCandidate[];
}

/**
 * The Site Builder image step: sourcing fires automatically the moment a
 * lead is picked (`POST /api/site-builder/images/source`), landing the
 * operator on an already-populated screen — one row per need (Hero, one per
 * service, About), each with its first candidate pre-selected, plus the
 * lead's own photos as the Gallery. The default path is zero clicks: an
 * operator happy with everything just hits Generate. Manual search
 * (`BuilderImagePicker`) is kept only as a per-row escape hatch for when the
 * auto candidates are all wrong — see AGENTS.md's brief on this rework.
 */
export function NewSiteFlow() {
  const router = useRouter();
  const { toast } = useToast();

  const [leads, setLeads] = useState<LeadOption[] | null>(null);
  const [templates, setTemplates] = useState<BuilderTemplateRow[] | null>(null);
  const [leadQuery, setLeadQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [needsLoading, setNeedsLoading] = useState(false);
  const [needRows, setNeedRows] = useState<NeedRow[]>([]);
  const [servicesTruncated, setServicesTruncated] = useState(false);
  const [droppedServices, setDroppedServices] = useState<string[]>([]);
  const [gallerySelected, setGallerySelected] = useState<Set<string>>(new Set());
  const [searchRowFor, setSearchRowFor] = useState<string | null>(null);

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
  }

  // Sourcing fires the instant a lead is selected — no search box, no manual
  // step. The lead's own photos become the Gallery's default selection in
  // the same pass (no searching involved there at all — see AGENTS.md).
  useEffect(() => {
    if (!selectedLead) {
      setNeedRows([]);
      setGallerySelected(new Set());
      setServicesTruncated(false);
      setDroppedServices([]);
      return;
    }
    setGallerySelected(new Set(selectedLead.image_links ?? []));
    let cancelled = false;
    setNeedsLoading(true);
    setNeedRows([]);
    (async () => {
      try {
        const res = await fetch("/api/site-builder/images/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_id: selectedLead.id }),
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast({ kind: "error", title: body.error ?? "Could not source images" });
          return;
        }
        const needs = (body.needs ?? []) as SourceApiNeed[];
        const rows: NeedRow[] = needs.map((n) => ({
          purpose: n.purpose,
          query: n.query,
          candidates: n.candidates ?? [],
          manualPick: null,
          pexelsError: n.pexelsError ?? null,
          pickedKey: n.candidates?.[0]?.key ?? null,
        }));
        setNeedRows(rows);
        setServicesTruncated(!!body.servicesTruncated);
        setDroppedServices((body.droppedServices ?? []) as string[]);
      } catch (e) {
        if (cancelled) return;
        toast({ kind: "error", title: e instanceof Error ? e.message : "Could not source images" });
      } finally {
        if (!cancelled) setNeedsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  const purposeSuggestions = useMemo(() => {
    const base = ["Hero", "Gallery", "About"];
    const services = selectedLead?.services ?? [];
    return [...base, ...services.map((s) => `Service: ${s}`)];
  }, [selectedLead]);

  const clientPhotos = selectedLead?.image_links ?? [];

  function pickCandidate(purpose: string, key: string) {
    setNeedRows((prev) => prev.map((r) => (r.purpose === purpose ? { ...r, pickedKey: key } : r)));
  }
  function pickNone(purpose: string) {
    setNeedRows((prev) => prev.map((r) => (r.purpose === purpose ? { ...r, pickedKey: null } : r)));
  }
  function applyManualPick(purpose: string, img: PickedImage) {
    setNeedRows((prev) =>
      prev.map((r) =>
        r.purpose === purpose
          ? { ...r, manualPick: { key: "manual", thumb_url: img.url, url: img.url, purpose: img.purpose }, pickedKey: "manual" }
          : r,
      ),
    );
    setSearchRowFor(null);
  }
  function toggleGallery(url: string) {
    setGallerySelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function resolveCandidate(candidate: NeedCandidate, purpose: string): Promise<string> {
    const body =
      candidate.kind === "library"
        ? { kind: "library", asset_id: candidate.asset_id, lead_id: selectedLead?.id }
        : {
            kind: "pexels",
            pexels: {
              download_url: candidate.download_url,
              pexels_id: candidate.pexels_id,
              width: candidate.width,
              height: candidate.height,
              photographer: candidate.photographer,
              subject: purpose,
            },
          };
    const res = await fetch("/api/site-builder/images/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(resBody.error ?? `Could not use the picked image for ${purpose}`);
    return resBody.url as string;
  }

  async function resolveGalleryPhoto(url: string): Promise<string> {
    const res = await fetch("/api/site-builder/images/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "client", url, lead_id: selectedLead?.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Could not use one of the client's photos");
    return body.url as string;
  }

  async function generate() {
    if (!selectedLead) { toast({ kind: "error", title: "Pick a lead first" }); return; }
    if (!templateId) { toast({ kind: "error", title: "Pick a template first" }); return; }
    setSubmitting(true);
    try {
      const picks: PickedImage[] = [];
      let firstError: string | null = null;

      await Promise.all(
        needRows.map(async (row) => {
          if (row.pickedKey === null) return;
          try {
            if (row.pickedKey === "manual") {
              if (row.manualPick) picks.push({ url: row.manualPick.url, purpose: row.manualPick.purpose });
              return;
            }
            const candidate = row.candidates.find((c) => c.key === row.pickedKey);
            if (!candidate) return;
            const url = await resolveCandidate(candidate, row.purpose);
            picks.push({ url, purpose: row.purpose });
          } catch (e) {
            firstError ??= e instanceof Error ? e.message : `Could not use the image for ${row.purpose}`;
          }
        }),
      );

      await Promise.all(
        [...gallerySelected].map(async (photoUrl) => {
          try {
            const url = await resolveGalleryPhoto(photoUrl);
            picks.push({ url, purpose: "Gallery" });
          } catch (e) {
            firstError ??= e instanceof Error ? e.message : "Could not use one of the client's photos";
          }
        }),
      );

      if (firstError) {
        toast({ kind: "error", title: firstError });
        return;
      }

      const res = await fetch("/api/site-builder/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: selectedLead.id, template_id: templateId, images: picks }),
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

  const searchRow = needRows.find((r) => r.purpose === searchRowFor) ?? null;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="New site"
        description="Pick a lead and a template — the images are found for you, and the AI writes the whole site from there."
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
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">3. Images</h3>
        {!selectedLead ? (
          <p className="text-sm text-text-muted">Pick a lead first — images are found automatically from there.</p>
        ) : (
          <div className="space-y-3">
            {servicesTruncated ? (
              <p className="rounded-md border border-border bg-surface-2 p-2 text-xs text-text-muted">
                This lead lists more than 8 services — only the first 8 got their own image row
                {droppedServices.length ? ` (dropped: ${droppedServices.join(", ")})` : ""}. Every service still appears in the site's copy.
              </p>
            ) : null}

            {needsLoading && needRows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Finding images…</p>
            ) : (
              needRows.map((row) => {
                const displayCandidates: (NeedCandidate | ManualPick)[] = row.manualPick
                  ? [...row.candidates, row.manualPick]
                  : row.candidates;
                return (
                  <div key={row.purpose} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text">{row.purpose}</p>
                        <p className="text-xs text-text-faint">Searched: &ldquo;{row.query || "—"}&rdquo;</p>
                      </div>
                      <button type="button" className={btnSecondarySm} onClick={() => setSearchRowFor(row.purpose)}>
                        <Search className="h-3.5 w-3.5" /> Search instead
                      </button>
                    </div>

                    {row.pexelsError ? (
                      <p className="mb-2 text-xs text-text-faint">
                        Pexels search failed for this row ({row.pexelsError}) — showing library results only.
                      </p>
                    ) : null}

                    {needsLoading ? (
                      <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => pickNone(row.purpose)}
                          aria-pressed={row.pickedKey === null}
                          title="No image for this"
                          aria-label={`No image for ${row.purpose}`}
                          className={cn(
                            "grid h-16 w-16 shrink-0 place-items-center rounded-md border text-center text-[10px] leading-tight text-text-muted",
                            row.pickedKey === null ? "border-accent ring-2 ring-accent" : "border-border",
                          )}
                        >
                          <ImageOff className="mb-0.5 h-4 w-4" />
                          No image
                        </button>
                        {displayCandidates.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => pickCandidate(row.purpose, c.key)}
                            aria-pressed={row.pickedKey === c.key}
                            aria-label={`Use this image for ${row.purpose}`}
                            className={cn(
                              "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border",
                              row.pickedKey === c.key ? "border-accent ring-2 ring-accent" : "border-border",
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.thumb_url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
                          </button>
                        ))}
                        {displayCandidates.length === 0 ? (
                          <p className="self-center text-xs text-text-muted">No candidates found — try &ldquo;Search instead&rdquo;.</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Gallery: the client's own photos, pre-selected, no searching. */}
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium text-text">Gallery</p>
              {clientPhotos.length === 0 ? (
                <p className="text-sm text-text-muted">This lead has no photos on file.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {clientPhotos.map((url) => {
                    const selected = gallerySelected.has(url);
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => toggleGallery(url)}
                        aria-pressed={selected}
                        aria-label={selected ? "Remove from gallery" : "Add to gallery"}
                        className={cn(
                          "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border",
                          selected ? "border-accent ring-2 ring-accent" : "border-border opacity-50",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => void generate()} disabled={submitting || !selectedLead || !templateId}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Generate
        </button>
      </div>

      {searchRow && selectedLead ? (
        <BuilderImagePicker
          leadId={selectedLead.id}
          purposeSuggestions={[searchRow.purpose, ...purposeSuggestions.filter((p) => p !== searchRow.purpose)]}
          clientPhotos={clientPhotos}
          onAdded={(img) => applyManualPick(searchRow.purpose, img)}
          onClose={() => setSearchRowFor(null)}
        />
      ) : null}
    </div>
  );
}
