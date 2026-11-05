"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Link2, Loader2 } from "lucide-react";
import { btnPrimary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { matchCategory } from "@/lib/hero-videos/names";
import { HeroVideoChoice } from "./HeroVideoChoice";
import { invalidateHeroVideos, useHeroVideos, type HeroVideoCard } from "./useHeroVideos";

export interface HeroLead {
  id: string;
  category?: string | null;
  hero_video_id?: string | null;
  hero_video_request?: boolean | null;
  hero_video_note?: string | null;
}

/**
 * The New Site screen's hero video step, for video-hero templates (SD Home).
 *
 * Three states, each with its own job for the developer:
 *  - the lead has a library video → shown, swappable for another;
 *  - sales REQUESTED a new video → a warning with what the client wants, and
 *    a field for the video's Google Drive link (it joins the library, under
 *    the category chosen here, and becomes this lead's video);
 *  - nothing chosen (a lead from before the gallery, or a template changed
 *    here) → the same choices, so the build is never blocked for good.
 */
export function DeveloperHeroVideo({
  lead,
  templateName,
  onAssigned,
}: {
  lead: HeroLead;
  templateName: string;
  onAssigned: (video: HeroVideoCard) => void;
}) {
  const { toast } = useToast();
  const { videos, reload } = useHeroVideos();
  const [link, setLink] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);

  const categories = useMemo(() => [...new Set((videos ?? []).map((v) => v.category))].sort(), [videos]);
  const current = lead.hero_video_id ? (videos ?? []).find((v) => v.id === lead.hero_video_id) ?? null : null;
  const suggested = matchCategory(lead.category, categories) ?? (lead.category ?? "");
  const categoryValue = category || suggested;

  async function assign(videoId: string) {
    const res = await fetch("/api/site-builder/hero-videos/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, hero_video_id: videoId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: body.error ?? "Could not set the hero video" });
      throw new Error(body.error ?? "assign failed");
    }
    onAssigned(body.video as HeroVideoCard);
    toast({ kind: "success", title: "Hero video set for this lead" });
  }

  async function addFromLink() {
    if (!link.trim() || !categoryValue.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/site-builder/hero-videos/from-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: link.trim(), category: categoryValue.trim(), lead_id: lead.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not add the video" });
        return;
      }
      invalidateHeroVideos();
      reload();
      setLink("");
      onAssigned(body.video as HeroVideoCard);
      toast({ kind: "success", title: `Added "${body.video.name}" to the library and set it for this lead` });
    } finally {
      setAdding(false);
    }
  }

  const linkForm = (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-text" htmlFor="hero-video-link">
        Google Drive link to the video
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="hero-video-link"
          className={inputCls}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/file/d/…/view"
          disabled={adding}
        />
        <input
          className={inputCls + " sm:max-w-[220px]"}
          list="hero-video-categories"
          value={categoryValue}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (e.g. Roofing)"
          aria-label="Category of the video"
          disabled={adding}
        />
        <datalist id="hero-video-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="button"
          className={btnPrimary + " shrink-0"}
          onClick={() => void addFromLink()}
          disabled={adding || !link.trim() || !categoryValue.trim()}
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Add video
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">
        The video is copied into the library&apos;s Drive folder for that category (so later leads can pick it too), put on
        the media host once, and set as this lead&apos;s hero video. Compress it first — a few MB, 10–20 seconds, no
        sound. Copying can take a minute.
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      {current ? (
        <HeroVideoChoice
          value={{ videoId: current.id, request: false, note: "" }}
          templateName={templateName}
          leadCategory={lead.category}
          allowRequest={false}
          onChange={(v) => (v.videoId ? assign(v.videoId) : undefined)}
        />
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-md border border-notready-fg/40 bg-notready-bg/50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-notready-fg" aria-hidden />
            <div className="min-w-0 text-xs leading-relaxed">
              {lead.hero_video_request ? (
                <>
                  <p className="font-semibold text-notready-fg">Sales requested a NEW hero video for this lead.</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-text">
                    {lead.hero_video_note ? <>What the client wants: {lead.hero_video_note}</> : "No details were given."}
                  </p>
                  <p className="mt-1 text-text-muted">Add the video&apos;s Drive link below (or pick one from the library) — the site cannot be generated without it.</p>
                </>
              ) : lead.hero_video_id && videos !== null ? (
                <p className="font-semibold text-notready-fg">This lead&apos;s hero video is no longer in the library — choose another.</p>
              ) : (
                <p className="font-semibold text-notready-fg">
                  {templateName} plays a video behind its hero, and this lead has none yet. Pick one from the library, or add one by link.
                </p>
              )}
            </div>
          </div>
          {linkForm}
          <HeroVideoChoice
            value={{ videoId: null, request: false, note: "" }}
            templateName={templateName}
            leadCategory={lead.category}
            allowRequest={false}
            onChange={(v) => (v.videoId ? assign(v.videoId) : undefined)}
          />
        </>
      )}
    </div>
  );
}
