"use client";

import { useState } from "react";
import { Film, Loader2, MessageSquarePlus, Pencil } from "lucide-react";
import { btnPrimary } from "@/components/common/buttons";
import { formatDuration } from "@/lib/hero-videos/names";
import { HeroVideoGallery, heroVideoChosen, type HeroVideoValue } from "./HeroVideoGallery";
import { useHeroVideos } from "./useHeroVideos";

/**
 * The hero video a lead carries for a video-hero template, as one compact
 * field: the chosen video (playable), or the request, or a call to choose —
 * with the gallery one click away.
 *
 * `autoOpen`: open the gallery straight away when nothing is chosen yet —
 * the lead form renders this the moment a video-hero template is picked (keyed
 * by the template, so another pick mounts it afresh), so picking the template
 * IS the click that opens the gallery.
 */
export function HeroVideoChoice({
  value,
  onChange,
  leadCategory,
  templateName,
  error,
  autoOpen = false,
  canEdit = true,
  allowRequest = true,
}: {
  value: HeroVideoValue;
  /** May return a promise (a save); the gallery stays open until it settles. */
  onChange: (value: HeroVideoValue) => void | Promise<void>;
  leadCategory?: string | null;
  templateName?: string | null;
  error?: string;
  autoOpen?: boolean;
  canEdit?: boolean;
  allowRequest?: boolean;
}) {
  const { videos } = useHeroVideos();
  const [open, setOpen] = useState(autoOpen && !heroVideoChosen(value) && canEdit);
  const [saving, setSaving] = useState(false);

  const video = value.videoId ? (videos ?? []).find((v) => v.id === value.videoId) ?? null : null;

  async function confirm(next: HeroVideoValue) {
    setSaving(true);
    try {
      await onChange(next);
      setOpen(false);
    } catch {
      // the caller has already said why; keep the gallery open to try again
    } finally {
      setSaving(false);
    }
  }

  const changeBtn =
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50";

  return (
    <div data-error={error ? "true" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-faint">
          <Film className="h-3.5 w-3.5" aria-hidden /> Hero video{templateName ? ` · ${templateName}` : ""}
        </span>
        {canEdit && heroVideoChosen(value) && (
          <button type="button" onClick={() => setOpen(true)} className={changeBtn} disabled={saving}>
            <Pencil className="h-3 w-3" aria-hidden /> Change
          </button>
        )}
      </div>

      {value.videoId ? (
        video ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-2">
            <video
              src={`${video.media_url}#t=0.5`}
              preload="metadata"
              controls
              muted
              playsInline
              loop
              className="aspect-video w-44 shrink-0 rounded-md bg-black object-cover"
              aria-label={`${video.category} — ${video.name}`}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">{video.category}</p>
              <p className="truncate text-[11px] text-text-muted">
                {video.name}
                {video.duration_ms ? ` · ${formatDuration(video.duration_ms)}` : ""}
              </p>
            </div>
          </div>
        ) : videos === null ? (
          <p className="flex items-center gap-2 py-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading video…
          </p>
        ) : (
          <p className="rounded-md border border-dashed border-notready-fg/50 bg-notready-bg/40 px-3 py-2 text-xs text-notready-fg">
            The chosen video is no longer in the library — choose another.
          </p>
        )
      ) : value.request ? (
        <div className="flex items-start gap-2 rounded-lg border border-notready-fg/40 bg-notready-bg/40 px-3 py-2">
          <MessageSquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-notready-fg" aria-hidden />
          <div className="min-w-0 text-xs">
            <p className="font-medium text-notready-fg">New video requested</p>
            <p className="mt-0.5 whitespace-pre-wrap text-text-muted">{value.note || "No details given."}</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3">
          <p className="text-xs text-text-muted">This template plays a video behind its hero. Choose one for the client.</p>
          {canEdit && (
            <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>
              <Film className="h-4 w-4" aria-hidden /> Choose video
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-notready-fg">{error}</p>}

      {open && (
        <HeroVideoGallery
          value={value}
          leadCategory={leadCategory}
          templateName={templateName}
          allowRequest={allowRequest}
          onClose={() => !saving && setOpen(false)}
          onConfirm={(next) => void confirm(next)}
        />
      )}
    </div>
  );
}
