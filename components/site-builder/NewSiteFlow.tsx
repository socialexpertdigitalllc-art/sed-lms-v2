"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ImageOff, Loader2, Rocket, Search, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { SmartImage, prefetchImages } from "@/components/common/SmartImage";
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
  /** The template the agent picked with the client on the submission form. */
  recommended_template_id: string | null;
}

/** One thumbnail on the image screen. `kind: "manual"` is a candidate added
 *  through the "search instead" escape hatch — unlike an auto-sourced one
 *  (rehosted only once actually used, at Generate), `BuilderImagePicker`
 *  rehosts immediately on pick, so a manual candidate already carries a
 *  durable `url`, not just a thumbnail. `kind: "client"` is one of the
 *  lead's own photos offered as a Hero option — its `url` is the lead's own
 *  (not yet rehosted) link, resolved the same way a Gallery pick is. */
interface DisplayCandidate {
  kind: "library" | "pexels" | "client" | "manual";
  key: string;
  thumb_url: string | null;
  width?: number;
  height?: number;
  asset_id?: string;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
  url?: string;
}

interface ServiceRow {
  service: string;
  purpose: string;
  query: string;
  candidates: DisplayCandidate[];
  pexelsError: string | null;
  /** A candidate's `key`, or null for an explicit "no image" — single-select,
   *  the operator picks exactly one option for this service. */
  pickedKey: string | null;
}

interface SourceApiCandidate {
  kind: "library" | "pexels" | "client";
  key: string;
  width?: number;
  height?: number;
  thumb_url: string | null;
  asset_id?: string;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
  url?: string;
}
interface SourceApiServiceRow {
  service: string;
  purpose: string;
  query: string;
  pexelsError: string | null;
  candidates: SourceApiCandidate[];
}
interface SourceApiResponse {
  hero: SourceApiCandidate[];
  services: SourceApiServiceRow[];
  servicesTruncated: boolean;
  droppedServices: string[];
}

/** The most hero picks the operator may carry into Generate — the source
 *  route offers up to 5 candidates (one from each of the first 3 services,
 *  one of the lead's own photos if it has any, topped up with next-best
 *  results from those same service searches); the operator narrows that
 *  down to at most 3. Enforced here, not just suggested: a 4th click is a
 *  no-op until one of the first 3 is deselected. */
const HERO_PICK_LIMIT = 3;

/**
 * Candidate tiles were fixed 64x64 squares in rows that had the full page
 * width to play with, so an operator could not actually SEE what they were
 * choosing (feedback, 2026-08-18). They now fill the available width: as
 * many ~190px tiles per row as fit, growing to share leftover space.
 */
const TILE_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]";
const TILE_SIZES = "(max-width: 640px) 45vw, 240px";

const tileCls = (selected: boolean) =>
  cn(
    "relative aspect-[4/3] overflow-hidden rounded-lg border-2 bg-surface-2 transition-all",
    selected ? "border-accent ring-2 ring-accent" : "border-border hover:border-accent/60",
  );

function SelectedTick() {
  return (
    <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-white shadow">
      <Check className="h-4 w-4" />
    </span>
  );
}

/**
 * The Site Builder image step: sourcing fires automatically the moment a
 * lead is picked (`POST /api/site-builder/images/source`), landing the
 * operator on an already-populated screen — a Hero row (up to 5 candidates,
 * pick up to 3), one row per service (3 candidates each, pick 1), plus the
 * lead's own photos as the Gallery. The default path is close to zero
 * clicks: an operator happy with the auto picks only has to narrow Hero down
 * to 3 (or fewer) and hit Generate. Manual search (`BuilderImagePicker`) is
 * kept only as a per-row escape hatch for when the auto candidates are all
 * wrong.
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
  // Publish automatically once generation finishes. Defaults ON: Generate is
  // meant to be the last click, and the whole point of a generated site is
  // that it goes live. It shipped opt-in, the operator then ticked it on
  // every run, so the box survives only as an escape hatch — a client whose
  // site must be eyeballed before it reaches a public URL — and is never
  // remembered between runs.
  const [autoDeploy, setAutoDeploy] = useState(true);

  const [needsLoading, setNeedsLoading] = useState(false);
  const [heroCandidates, setHeroCandidates] = useState<DisplayCandidate[]>([]);
  const [heroSelected, setHeroSelected] = useState<Set<string>>(new Set());
  const [serviceRows, setServiceRows] = useState<ServiceRow[]>([]);
  const [servicesTruncated, setServicesTruncated] = useState(false);
  const [droppedServices, setDroppedServices] = useState<string[]>([]);
  const [gallerySelected, setGallerySelected] = useState<Set<string>>(new Set());
  const [searchRowFor, setSearchRowFor] = useState<string | null>(null);
  const manualKeyCounter = useRef(0);

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

  /**
   * What to say about the sales recommendation, if anything.
   *
   * Three cases worth distinguishing, because they need different actions
   * from the operator: it was applied, it was overridden (so they know they
   * are departing from what the client was shown), or the recommended
   * template is gone and somebody has to choose deliberately.
   */
  const recommendedNote = useMemo((): { text: string; tone: "info" | "warn" } | null => {
    const recId = selectedLead?.recommended_template_id;
    if (!recId || templates === null) return null;
    const rec = templates.find((t) => t.id === recId);
    if (!rec) {
      return {
        text: "The template sales recommended for this lead no longer exists — pick one deliberately.",
        tone: "warn",
      };
    }
    if (templateId === rec.id) {
      return { text: `Auto-selected "${rec.name}" — the template sales chose with the client.`, tone: "info" };
    }
    return {
      text: `Sales recommended "${rec.name}" for this lead. You are building with a different template.`,
      tone: "warn",
    };
  }, [selectedLead, templates, templateId]);

  function selectLead(lead: LeadOption) {
    setSelectedLeadId(lead.id);
    // The template sales agreed WITH the client becomes the selection, rather
    // than the operator re-deciding it from the brief alone. Still a plain
    // select afterwards: this is a default, not a lock. A lead with no
    // recommendation clears back to "choose", so the previous lead's pick can
    // never quietly carry over onto this one.
    setTemplateId(lead.recommended_template_id ?? "");
  }

  // Sourcing fires the instant a lead is selected — no search box, no manual
  // step. The lead's own photos become the Gallery's default selection in
  // the same pass (no searching involved there at all — see AGENTS.md).
  useEffect(() => {
    if (!selectedLead) {
      setHeroCandidates([]);
      setHeroSelected(new Set());
      setServiceRows([]);
      setGallerySelected(new Set());
      setServicesTruncated(false);
      setDroppedServices([]);
      return;
    }
    setGallerySelected(new Set(selectedLead.image_links ?? []));
    // Warm the thumbnail cache the moment a lead is chosen, so the photos are
    // already there when the operator opens the picker instead of loading
    // from scratch on every open.
    prefetchImages(selectedLead.image_links ?? []);
    let cancelled = false;
    setNeedsLoading(true);
    setHeroCandidates([]);
    setHeroSelected(new Set());
    setServiceRows([]);
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
        const data = body as SourceApiResponse;
        const hero = (data.hero ?? []) as DisplayCandidate[];
        setHeroCandidates(hero);
        setHeroSelected(new Set(hero.slice(0, HERO_PICK_LIMIT).map((c) => c.key)));
        const rows: ServiceRow[] = (data.services ?? []).map((s) => ({
          service: s.service,
          purpose: s.purpose,
          query: s.query,
          candidates: (s.candidates ?? []) as DisplayCandidate[],
          pexelsError: s.pexelsError ?? null,
          pickedKey: s.candidates?.[0]?.key ?? null,
        }));
        setServiceRows(rows);
        setServicesTruncated(!!data.servicesTruncated);
        setDroppedServices((data.droppedServices ?? []) as string[]);
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
    const base = ["Hero", "Gallery"];
    const services = selectedLead?.services ?? [];
    return [...base, ...services.map((s) => `Service: ${s}`)];
  }, [selectedLead]);

  const clientPhotos = selectedLead?.image_links ?? [];

  function toggleHero(key: string) {
    setHeroSelected((prev) => {
      if (prev.has(key)) {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      if (prev.size >= HERO_PICK_LIMIT) {
        toast({ kind: "error", title: `Pick at most ${HERO_PICK_LIMIT} hero images — deselect one first` });
        return prev;
      }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function pickService(purpose: string, key: string) {
    setServiceRows((prev) => prev.map((r) => (r.purpose === purpose ? { ...r, pickedKey: key } : r)));
  }
  function pickServiceNone(purpose: string) {
    setServiceRows((prev) => prev.map((r) => (r.purpose === purpose ? { ...r, pickedKey: null } : r)));
  }

  /** Take everything the picker handed back in ONE go. The picker used to
   *  close after a single pick, so filling a 3-image Hero row from the
   *  client's photos meant opening it three times (operator feedback,
   *  2026-08-18); it now multi-selects and commits a batch. */
  function applyManualPicks(purpose: string, images: PickedImage[]) {
    if (images.length === 0) return;
    const candidates: DisplayCandidate[] = images.map((img) => ({
      kind: "manual",
      key: `manual:${++manualKeyCounter.current}`,
      thumb_url: img.url,
      url: img.url,
    }));

    if (purpose === "Hero") {
      setHeroCandidates((prev) => [...prev, ...candidates]);
      setHeroSelected((prev) => {
        const next = new Set(prev);
        let dropped = 0;
        for (const c of candidates) {
          if (next.size >= HERO_PICK_LIMIT) {
            dropped++;
            continue;
          }
          next.add(c.key);
        }
        // Hero holds three. Anything past that lands in the row as a
        // candidate but is NOT selected — say so, or the operator counts
        // their picks and finds one missing with no explanation.
        if (dropped > 0) {
          toast({
            kind: "error",
            title: `${dropped} image${dropped === 1 ? "" : "s"} added to the row but not selected — Hero holds ${HERO_PICK_LIMIT}`,
          });
        }
        return next;
      });
    } else {
      // A service row holds one image: the last pick wins, the rest stay
      // available as candidates in the row.
      setServiceRows((prev) =>
        prev.map((r) =>
          r.purpose === purpose
            ? { ...r, candidates: [...r.candidates, ...candidates], pickedKey: candidates[candidates.length - 1].key }
            : r,
        ),
      );
    }
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

  /** Turn one auto-sourced or manually-added candidate into a durable URL,
   *  ready to sit in the run's `images` array. Manual candidates already
   *  carry one (BuilderImagePicker rehosts on pick); library/pexels/client
   *  candidates are only rehosted now, on actual use — never before. */
  async function resolveDisplayCandidate(candidate: DisplayCandidate, purpose: string): Promise<string> {
    if (candidate.kind === "manual") return candidate.url as string;
    const body =
      candidate.kind === "library"
        ? { kind: "link", url: candidate.url, subject: purpose }
        : candidate.kind === "pexels"
          ? {
              kind: "pexels",
              pexels: {
                download_url: candidate.download_url,
                thumb_url: candidate.thumb_url,
                pexels_id: candidate.pexels_id,
                width: candidate.width,
                height: candidate.height,
                photographer: candidate.photographer,
                subject: purpose,
              },
            }
          : { kind: "client", url: candidate.url, lead_id: selectedLead?.id, subject: purpose };
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
    if (heroSelected.size > HERO_PICK_LIMIT) {
      toast({ kind: "error", title: `Pick at most ${HERO_PICK_LIMIT} hero images` });
      return;
    }
    setSubmitting(true);
    try {
      const picks: PickedImage[] = [];
      let firstError: string | null = null;

      await Promise.all(
        heroCandidates
          .filter((c) => heroSelected.has(c.key))
          .map(async (c) => {
            try {
              const url = await resolveDisplayCandidate(c, "Hero");
              picks.push({ url, purpose: "Hero" });
            } catch (e) {
              firstError ??= e instanceof Error ? e.message : "Could not use one of the hero images";
            }
          }),
      );

      await Promise.all(
        serviceRows.map(async (row) => {
          if (row.pickedKey === null) return;
          const candidate = row.candidates.find((c) => c.key === row.pickedKey);
          if (!candidate) return;
          try {
            const url = await resolveDisplayCandidate(candidate, row.purpose);
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
        body: JSON.stringify({
          lead_id: selectedLead.id,
          template_id: templateId,
          images: picks,
          options: { auto_deploy: autoDeploy },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not start the run" });
        return;
      }
      toast({ kind: "success", title: autoDeploy ? "Generating — will deploy automatically" : "Generating…" });
      router.push(`/ai-tools/site-builder/runs/${body.run.id}`);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not start the run" });
    } finally {
      setSubmitting(false);
    }
  }

  const searchRow = searchRowFor === "Hero" ? "Hero" : serviceRows.find((r) => r.purpose === searchRowFor)?.purpose ?? null;

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
        {recommendedNote && (
          <p
            className={
              "mb-2 flex items-start gap-1.5 text-[11px] leading-relaxed " +
              (recommendedNote.tone === "warn" ? "text-notready-fg" : "text-text-muted")
            }
          >
            <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{recommendedNote.text}</span>
          </p>
        )}
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

            {needsLoading && heroCandidates.length === 0 && serviceRows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Finding images…</p>
            ) : (
              <>
                {/* Hero: up to 5 candidates, pick up to 3. */}
                <div className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-text">Hero</p>
                      <p className="text-xs text-text-faint">
                        Pick up to {HERO_PICK_LIMIT} — {heroSelected.size} selected
                      </p>
                    </div>
                    <button
                      type="button"
                      className={btnSecondarySm}
                      // At the limit the picker would open offering a slot that
                      // applyManualPicks then drops on the floor (a click that
                      // does nothing). Say so instead.
                      onClick={() =>
                        heroSelected.size >= HERO_PICK_LIMIT
                          ? toast({
                              kind: "error",
                              title: `Already ${HERO_PICK_LIMIT} hero images — deselect one to swap`,
                            })
                          : setSearchRowFor("Hero")
                      }
                    >
                      <Search className="h-3.5 w-3.5" /> Search instead
                    </button>
                  </div>
                  {needsLoading ? (
                    <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
                  ) : heroCandidates.length === 0 ? (
                    <p className="text-xs text-text-muted">No candidates found — try &ldquo;Search instead&rdquo;.</p>
                  ) : (
                    <div className={TILE_GRID}>
                      {heroCandidates.map((c, i) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggleHero(c.key)}
                          aria-pressed={heroSelected.has(c.key)}
                          aria-label="Use this image for Hero"
                          className={tileCls(heroSelected.has(c.key))}
                        >
                          <SmartImage src={c.thumb_url ?? ""} sizes={TILE_SIZES} priority={i < 6} />
                          {heroSelected.has(c.key) ? <SelectedTick /> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {serviceRows.map((row) => (
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
                      <div className={TILE_GRID}>
                        <button
                          type="button"
                          onClick={() => pickServiceNone(row.purpose)}
                          aria-pressed={row.pickedKey === null}
                          title="No image for this"
                          aria-label={`No image for ${row.purpose}`}
                          className={cn(
                            "grid aspect-[4/3] place-items-center rounded-lg border-2 text-center text-xs leading-tight text-text-muted",
                            row.pickedKey === null ? "border-accent ring-2 ring-accent" : "border-border hover:border-accent/60",
                          )}
                        >
                          <span>
                            <ImageOff className="mx-auto mb-1 h-5 w-5" />
                            No image
                          </span>
                        </button>
                        {row.candidates.map((c, i) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => pickService(row.purpose, c.key)}
                            aria-pressed={row.pickedKey === c.key}
                            aria-label={`Use this image for ${row.purpose}`}
                            className={tileCls(row.pickedKey === c.key)}
                          >
                            <SmartImage src={c.thumb_url ?? ""} sizes={TILE_SIZES} priority={i < 3} />
                            {row.pickedKey === c.key ? <SelectedTick /> : null}
                          </button>
                        ))}
                        {row.candidates.length === 0 ? (
                          <p className="self-center text-xs text-text-muted">No candidates — try &ldquo;Search instead&rdquo;.</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Gallery: the client's own photos, pre-selected, no searching. */}
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium text-text">Gallery</p>
              {clientPhotos.length === 0 ? (
                <p className="text-sm text-text-muted">This lead has no photos on file.</p>
              ) : (
                <div className={TILE_GRID}>
                  {clientPhotos.map((url, i) => {
                    const selected = gallerySelected.has(url);
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => toggleGallery(url)}
                        aria-pressed={selected}
                        aria-label={selected ? "Remove from gallery" : "Add to gallery"}
                        className={cn(tileCls(selected), selected ? "" : "opacity-60 hover:opacity-100")}
                      >
                        <SmartImage src={url} sizes={TILE_SIZES} priority={i < 6} />
                        {selected ? <SelectedTick /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-end gap-4">
        <label className="mr-auto flex items-start gap-2.5 text-sm text-text">
          <input
            type="checkbox"
            className="accent-accent mt-0.5 h-4 w-4 shrink-0"
            checked={autoDeploy}
            onChange={(e) => setAutoDeploy(e.target.checked)}
          />
          <span>
            Auto deploy
            <span className="block text-xs text-text-muted">
              On by default: the site publishes to a subdomain the moment generation finishes, the lead&apos;s website
              link is updated, and its agent is notified — Generate is the only click. Untick to hold it for review
              and deploy it by hand instead.
            </span>
          </span>
        </label>
        <button className={btnPrimary} onClick={() => void generate()} disabled={submitting || !selectedLead || !templateId}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Generate
        </button>
      </div>

      {searchRow && selectedLead ? (
        <BuilderImagePicker
          leadId={selectedLead.id}
          purposeSuggestions={[searchRow, ...purposeSuggestions.filter((p) => p !== searchRow)]}
          clientPhotos={clientPhotos}
          // Hero can still take whatever is left of its 3 slots; a service
          // row takes exactly one.
          maxSelectable={searchRow === "Hero" ? Math.max(1, HERO_PICK_LIMIT - heroSelected.size) : 1}
          onAdded={(images) => applyManualPicks(searchRow, images)}
          onClose={() => setSearchRowFor(null)}
        />
      ) : null}
    </div>
  );
}
