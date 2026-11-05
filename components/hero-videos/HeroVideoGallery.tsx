"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Film, Loader2, MessageSquarePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { formatDuration, matchCategory } from "@/lib/hero-videos/names";
import { useHeroVideos, type HeroVideoCard } from "./useHeroVideos";

/** What a lead holds for a video-hero template: a library video, or a request for a new one. */
export interface HeroVideoValue {
  videoId: string | null;
  request: boolean;
  note: string;
}

export const EMPTY_HERO_VIDEO: HeroVideoValue = { videoId: null, request: false, note: "" };

export const heroVideoChosen = (v: HeroVideoValue) => !!v.videoId || v.request;

/**
 * The hero video gallery: every library video, playable, filterable by
 * category (the category is each video's title), plus "Request a new video"
 * for when none fits — the developer then supplies one at build time.
 *
 * Opens on the lead's own trade when the library has that category.
 */
export function HeroVideoGallery({
  value,
  onConfirm,
  onClose,
  leadCategory,
  templateName,
  allowRequest = true,
}: {
  value: HeroVideoValue;
  onConfirm: (value: HeroVideoValue) => void;
  onClose: () => void;
  leadCategory?: string | null;
  templateName?: string | null;
  /** The developer's picker hides it: they answer requests, they don't make them. */
  allowRequest?: boolean;
}) {
  const { videos, error, reload } = useHeroVideos();
  const [draft, setDraft] = useState<HeroVideoValue>(value);
  const [filter, setFilter] = useState<string | null>(null);
  const [filterTouched, setFilterTouched] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of videos ?? []) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [videos]);

  // Open on the lead's trade — or, when re-opening, on the chosen video's category.
  const defaultFilter = useMemo(() => {
    if (!videos) return null;
    const chosen = videos.find((v) => v.id === value.videoId);
    if (chosen) return chosen.category;
    return matchCategory(leadCategory, categories.map((c) => c.name));
  }, [videos, value.videoId, leadCategory, categories]);
  const activeFilter = filterTouched ? filter : defaultFilter;

  const shown = useMemo(
    () => (videos ?? []).filter((v) => !activeFilter || v.category === activeFilter),
    [videos, activeFilter],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (id: string) => setDraft({ videoId: id, request: false, note: "" });
  const chosen = (videos ?? []).find((v) => v.id === draft.videoId) ?? null;
  const canConfirm = !!chosen || (allowRequest && draft.request);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="hero-gallery-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 sm:p-6">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="hero-gallery-title" className="flex items-center gap-2 font-semibold text-text">
              <Film className="h-4 w-4 text-accent" aria-hidden /> Choose the hero video
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              It plays behind the home page hero{templateName ? ` of the ${templateName} site` : ""}. Press play to watch any
              of them{allowRequest ? ", or request a new video if none fits" : ""}.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        {categories.length > 0 && (
          <div
            className="flex gap-1.5 overflow-x-auto border-b border-border px-5 py-3 sm:flex-wrap sm:overflow-visible"
            role="toolbar"
            aria-label="Filter by category"
          >
            <FilterChip label="All" count={videos?.length ?? 0} active={!activeFilter} onClick={() => { setFilter(null); setFilterTouched(true); }} />
            {categories.map((c) => (
              <FilterChip
                key={c.name}
                label={c.name}
                count={c.count}
                active={activeFilter === c.name}
                onClick={() => { setFilter(c.name); setFilterTouched(true); }}
              />
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-4 text-sm text-text-muted">
              {error}{" "}
              <button type="button" className="font-medium text-accent-ink underline" onClick={reload}>
                Try again
              </button>
            </div>
          ) : videos === null ? (
            <p className="flex items-center gap-2 py-10 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading videos…
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {allowRequest && (
                <RequestCard
                  selected={draft.request}
                  note={draft.note}
                  onSelect={() => setDraft({ videoId: null, request: true, note: draft.note })}
                  onNote={(note) => setDraft({ videoId: null, request: true, note })}
                />
              )}
              {shown.map((v) => (
                <VideoCard key={v.id} video={v} selected={draft.videoId === v.id} onSelect={() => pick(v.id)} />
              ))}
              {videos.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-text-muted sm:col-span-2">
                  The video library is empty.{allowRequest ? " Request a new video — the developer adds it when building the site." : ""}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="min-w-0 truncate text-xs text-text-muted">
            {chosen ? (
              <>
                Selected: <span className="font-medium text-text">{chosen.category}</span> · {chosen.name}
              </>
            ) : draft.request ? (
              <span className="font-medium text-notready-fg">A new video will be requested from the developer.</span>
            ) : (
              "Pick a video to continue."
            )}
          </p>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!canConfirm}
              onClick={() => onConfirm(chosen ? { videoId: chosen.id, request: false, note: "" } : { videoId: null, request: true, note: draft.note.trim() })}
            >
              <Check className="h-4 w-4" aria-hidden /> {draft.request && !chosen ? "Request new video" : "Use this video"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // On a phone the chips scroll sideways: keep the active one in view
  // (the gallery often opens on the lead's trade, far down the list).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-accent bg-accent text-white" : "border-border bg-surface text-text-muted hover:border-accent/60 hover:text-text",
      )}
    >
      {label} <span className={active ? "text-white/80" : "text-text-faint"}>{count}</span>
    </button>
  );
}

function VideoCard({ video, selected, onSelect }: { video: HeroVideoCard; selected: boolean; onSelect: () => void }) {
  const duration = formatDuration(video.duration_ms);
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-surface transition-colors",
        selected ? "border-accent ring-2 ring-accent" : "border-border hover:border-accent/60",
      )}
    >
      <div className="relative aspect-video bg-black">
        {/* `#t=0.5` shows a real frame before play; metadata only, so a grid
            of 25 cards fetches headers, not 25 videos. */}
        <video
          src={`${video.media_url}#t=0.5`}
          preload="metadata"
          controls
          muted
          playsInline
          loop
          className="h-full w-full object-cover"
          aria-label={`${video.category} — ${video.name}`}
        />
        {selected && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
            Selected
          </span>
        )}
        {duration && (
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {duration}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text">{video.category}</h3>
          {/* "Kitchen Remodel 2" tells two kitchens apart; "Roofing" under "Roofing" tells nothing. */}
          {video.name.trim().toLowerCase() !== video.category.trim().toLowerCase() && (
            <p className="truncate text-[11px] text-text-muted">{video.name}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={cn(
            "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            selected ? "border-accent bg-accent text-white" : "border-border text-text hover:bg-surface-2",
          )}
        >
          {selected ? "Selected" : "Select"}
        </button>
      </div>
    </div>
  );
}

function RequestCard({
  selected,
  note,
  onSelect,
  onNote,
}: {
  selected: boolean;
  note: string;
  onSelect: () => void;
  onNote: (note: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-dashed p-3 transition-colors",
        selected ? "border-notready-fg bg-notready-bg/40 ring-2 ring-notready-fg/60" : "border-border hover:border-accent/60",
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex items-start gap-2 text-left">
        <MessageSquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-notready-fg" aria-hidden />
        <span>
          <span className="block text-sm font-medium text-text">Request a new video</span>
          <span className="block text-[11px] leading-relaxed text-text-muted">
            None of these fit? The developer adds the right video when building the site.
          </span>
        </span>
      </button>
      {selected && (
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          maxLength={1000}
          rows={3}
          autoFocus
          placeholder="What should it show? e.g. a crew installing solar panels on a tile roof"
          className={inputCls}
          aria-label="What the new video should show"
        />
      )}
    </div>
  );
}
