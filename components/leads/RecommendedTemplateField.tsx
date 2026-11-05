"use client";

import { useEffect, useState } from "react";
import { LayoutTemplate, Loader2, Pencil, X } from "lucide-react";
import { TemplateCard, type TemplateCardRow } from "@/components/site-builder/TemplateCard";
import { TemplateRecommendation } from "@/components/leads/TemplateRecommendation";
import { HeroVideoChoice } from "@/components/hero-videos/HeroVideoChoice";
import { EMPTY_HERO_VIDEO, HeroVideoGallery, type HeroVideoValue } from "@/components/hero-videos/HeroVideoGallery";

/**
 * The template sales recommended for this lead, on the lead screen.
 *
 * The lead row only stores the template's id; this fetches the template
 * itself (by id, so one that has since gone out of service is still named
 * rather than shown as a blank) and renders the same card the picker used.
 * Editors get "Change", which opens the picker the lead form uses, and
 * "Remove" — the recommendation is advice from the call, and advice changes.
 */
export function RecommendedTemplateField({
  templateId,
  canEdit,
  onChange,
  heroVideo = EMPTY_HERO_VIDEO,
  leadCategory,
}: {
  templateId: string | null | undefined;
  canEdit: boolean;
  /** Persists the new id ("" clears it), with the hero video choice when the
   *  template plays one (SD Home) — the two are saved together, because the
   *  server refuses a video-hero template without its video. Should reject on failure. */
  onChange: (id: string, hero?: HeroVideoValue) => Promise<void>;
  /** The lead's current hero video choice (video-hero templates only). */
  heroVideo?: HeroVideoValue;
  leadCategory?: string | null;
}) {
  // Keyed by the id it was fetched for, so a changed id simply reads as
  // "not loaded yet" — no state to reset in the effect.
  const [loaded, setLoaded] = useState<{
    id: string;
    template: TemplateCardRow | null;
    status: "ok" | "missing" | "error";
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  /** A video-hero template picked, waiting for its video before anything is saved. */
  const [pendingHero, setPendingHero] = useState<TemplateCardRow | null>(null);

  useEffect(() => {
    if (!templateId) return;
    const id = templateId;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/site-builder/templates/${encodeURIComponent(id)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setLoaded({ id, template: null, status: "missing" });
          return;
        }
        if (!res.ok) throw new Error("load failed");
        const body = (await res.json()) as { template: TemplateCardRow };
        if (!cancelled) setLoaded({ id, template: body.template, status: "ok" });
      } catch {
        if (!cancelled) setLoaded({ id, template: null, status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const current = templateId && loaded?.id === templateId ? loaded : null;
  const template = current?.template ?? null;
  const state = current ? current.status : "loading";

  async function save(id: string, hero?: HeroVideoValue) {
    setSaving(true);
    try {
      await (hero ? onChange(id, hero) : onChange(id));
      setPicking(false);
      setPendingHero(null);
    } finally {
      setSaving(false);
    }
  }

  const btn =
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-faint">Recommended template</span>
        {canEdit && !picking && (
          <button type="button" onClick={() => setPicking(true)} className={btn} disabled={saving}>
            <Pencil className="h-3 w-3" aria-hidden /> {templateId ? "Change" : "Choose"}
          </button>
        )}
        {picking && (
          <button type="button" onClick={() => setPicking(false)} className={btn} disabled={saving}>
            <X className="h-3 w-3" aria-hidden /> Cancel
          </button>
        )}
      </div>

      {picking ? (
        <TemplateRecommendation
          value={templateId ?? ""}
          onChange={(id, t) => {
            // A video-hero template needs its video first: the gallery opens,
            // and only its confirmation saves template + video together.
            if (t?.hero_video && id !== templateId) setPendingHero(t);
            else void save(id);
          }}
        />
      ) : templateId ? (
        state === "loading" ? (
          <p className="flex items-center gap-2 py-3 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading template…
          </p>
        ) : template ? (
          <div className="space-y-3">
          <div className="max-w-xs">
            <TemplateCard
              template={template}
              footer={
                <>
                  {template.in_service === false && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted">
                      Out of service
                    </span>
                  )}
                  {canEdit && (
                    <button type="button" onClick={() => void save("")} className={btn} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <X className="h-3 w-3" aria-hidden />} Remove
                    </button>
                  )}
                </>
              }
            />
          </div>
          {template.hero_video && (
            <HeroVideoChoice
              value={heroVideo}
              canEdit={canEdit}
              templateName={template.name}
              leadCategory={leadCategory}
              onChange={(v) => save(template.id, v)}
            />
          )}
          </div>
        ) : (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-text-muted">
            {state === "missing"
              ? "The recommended template no longer exists — it was deleted from the templates board."
              : "Could not load the recommended template. Refresh the page to try again."}
          </p>
        )
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-text-muted">
          <LayoutTemplate className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
          No template was recommended for this lead.
        </div>
      )}

      {pendingHero && (
        <HeroVideoGallery
          value={EMPTY_HERO_VIDEO}
          templateName={pendingHero.name}
          leadCategory={leadCategory}
          onClose={() => !saving && setPendingHero(null)}
          onConfirm={(v) => void save(pendingHero.id, v).catch(() => {})}
        />
      )}
    </div>
  );
}
