"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check, CircleUserRound, Hammer, ImagePlus, Link2, Loader2, RefreshCw, ShieldCheck, X, ZoomIn,
} from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";
import { applyToggle, slotProgress } from "@/lib/template-engine/wizard";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

const slotsOf = (gen: GenerationDetail): ImageSlot[] =>
  Array.isArray(gen.image_slots) ? gen.image_slots : [];

export function ImageCuration({ gen, onChanged }: { gen: GenerationDetail; onChanged: () => void }) {
  const editable = gen.status === "curating";
  const { toast } = useToast();

  // Local, optimistic copy of the slots — clicks update this INSTANTLY, and the
  // server write happens in the background. Re-seeded only when the generation
  // id or status changes (e.g. reopen), never on a routine realtime poke, so an
  // in-progress selection is never clobbered.
  const [localSlots, setLocalSlots] = useState<ImageSlot[]>(() => slotsOf(gen));
  const lastSeed = useRef(`${gen.id}:${gen.status}`);
  useEffect(() => {
    const key = `${gen.id}:${gen.status}`;
    if (lastSeed.current !== key) {
      lastSeed.current = key;
      setLocalSlots(slotsOf(gen));
    }
  }, [gen]);

  // Serialize every server write for this generation: the curation routes
  // read-modify-write the whole image_slots array, so concurrent writes to
  // different slots would lose one. The UI stays instant regardless.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (fn: () => Promise<unknown>) => {
    chain.current = chain.current.then(fn, fn);
    return chain.current;
  };

  const [busySlot, setBusySlot] = useState<Record<string, "more" | "custom" | undefined>>({});
  const [building, setBuilding] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null); // full-size lightbox

  const patchSlot = (id: string, next: Partial<ImageSlot>) =>
    setLocalSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));
  const replaceSlot = (next: ImageSlot) =>
    setLocalSlots((prev) => prev.map((s) => (s.id === next.id ? next : s)));

  function toggle(slot: ImageSlot, url: string) {
    if (!editable) return;
    const { selected, full } = applyToggle(slot.selected, url, slot.pick_max);
    if (full) {
      toast({ kind: "info", title: `This slot allows ${slot.pick_max} images`, body: "Deselect one first to swap." });
      return;
    }
    const prev = slot.selected;
    patchSlot(slot.id, { selected }); // instant
    enqueue(async () => {
      try {
        const res = await fetch(`/api/template-engine/generations/${gen.id}/images/${slot.id}/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: selected }),
        });
        if (!res.ok) {
          patchSlot(slot.id, { selected: prev }); // roll back the optimistic change
          toast({ kind: "error", title: "Selection not saved", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
        }
      } catch {
        patchSlot(slot.id, { selected: prev });
        toast({ kind: "error", title: "Selection not saved", body: "Network error — try again" });
      }
    });
  }

  function fetchMore(slot: ImageSlot) {
    if (!editable || busySlot[slot.id]) return;
    setBusySlot((b) => ({ ...b, [slot.id]: "more" }));
    enqueue(async () => {
      try {
        const res = await fetch(`/api/template-engine/generations/${gen.id}/images/${slot.id}/more`, { method: "POST" });
        if (!res.ok) {
          toast({ kind: "error", title: "Could not load more", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
        } else {
          const { slot: fresh } = await res.json();
          if (fresh) replaceSlot(fresh);
        }
      } catch {
        toast({ kind: "error", title: "Could not load more", body: "Network error — try again" });
      } finally {
        setBusySlot((b) => ({ ...b, [slot.id]: undefined }));
      }
    });
  }

  function addCustom(slot: ImageSlot, url: string) {
    if (!editable || busySlot[slot.id] || !url.trim()) return;
    setBusySlot((b) => ({ ...b, [slot.id]: "custom" }));
    return enqueue(async () => {
      try {
        const res = await fetch(`/api/template-engine/generations/${gen.id}/images/${slot.id}/custom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
        if (!res.ok) {
          toast({ kind: "error", title: "Custom image rejected", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
          return false;
        }
        const { slot: fresh } = await res.json();
        if (fresh) replaceSlot(fresh);
        return true;
      } catch {
        toast({ kind: "error", title: "Custom image rejected", body: "Network error — try again" });
        return false;
      } finally {
        setBusySlot((b) => ({ ...b, [slot.id]: undefined }));
      }
    });
  }

  async function startBuild() {
    setBuilding(true);
    try {
      // Let any queued selection writes land before the build reads them.
      await chain.current;
      const res = await fetch(`/api/template-engine/generations/${gen.id}/build`, { method: "POST" });
      if (res.status === 422) {
        const j = await res.json().catch(() => ({}));
        const names = (j.slots ?? []).map((s: { label: string }) => s.label).join(", ");
        toast({ kind: "error", title: "Pick an image for every slot", body: names || j.error });
        return;
      }
      if (!res.ok) {
        toast({ kind: "error", title: "Could not start build", body: (await res.json().catch(() => ({}))).error ?? "Build failed to queue" });
        return;
      }
      toast({ kind: "success", title: "Build started", body: "Watch it on the Build step." });
      onChanged();
    } catch {
      toast({ kind: "error", title: "Could not start build", body: "Try again" });
    } finally {
      setBuilding(false);
    }
  }

  if (localSlots.length === 0) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">No image slots yet — they appear when planning finishes.</div>;
  }

  const { chosen, total } = slotProgress(localSlots);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text">{chosen}/{total}</span> slots chosen
          {editable ? " — every slot needs at least one image before the build" : ""}
        </p>
        {editable ? (
          <button type="button" onClick={startBuild} disabled={building || chosen < total}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            Build the site
          </button>
        ) : null}
      </div>

      {localSlots.map((slot) => (
        <SlotGrid
          key={slot.id}
          slot={slot}
          editable={editable}
          busy={busySlot[slot.id]}
          onToggle={(url) => toggle(slot, url)}
          onMore={() => fetchMore(slot)}
          onCustom={(url) => addCustom(slot, url)}
          onZoom={(url) => setZoomUrl(url)}
        />
      ))}

      <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />
    </div>
  );
}

/** Full-size image overlay. Closes on backdrop click, the Escape key, or the
 *  close button; clicking the image itself does not dismiss it. */
function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [url, onClose]);

  if (!url) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      role="dialog" aria-modal="true" aria-label="Image preview" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close preview"
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl" />
    </div>
  );
}

function SlotGrid({ slot, editable, busy, onToggle, onMore, onCustom, onZoom }: {
  slot: ImageSlot;
  editable: boolean;
  busy: "more" | "custom" | undefined;
  onToggle: (url: string) => void;
  onMore: () => void;
  onCustom: (url: string) => void | Promise<unknown>;
  onZoom: (url: string) => void;
}) {
  const [customUrl, setCustomUrl] = useState("");

  async function submitCustom() {
    if (!customUrl.trim()) return;
    const ok = await onCustom(customUrl.trim());
    if (ok !== false) setCustomUrl("");
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">
          {slot.label}
          <span className="ml-2 text-xs text-text-faint">
            {slot.kind === "hero" ? `pick up to ${slot.pick_max}` : "pick 1"} · {slot.selected.length} selected
          </span>
        </h2>
        {editable ? (
          <button type="button" onClick={onMore} disabled={busy !== undefined}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-50">
            {busy === "more" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Show different ones
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {slot.candidates.map((c) => {
          const selected = slot.selected.includes(c.url);
          return (
            <div key={c.url} className="group relative aspect-[4/3] overflow-hidden rounded-md">
              <button type="button" onClick={() => onToggle(c.url)} disabled={!editable}
                aria-pressed={selected}
                className={cn(
                  "absolute inset-0 h-full w-full rounded-md border-2 transition-colors",
                  selected ? "border-accent" : "border-transparent hover:border-border",
                )}>
                {/* Stock thumbs come from Pexels CDN; plain img keeps it simple */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.thumb || c.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                {selected ? (
                  <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
                    <Check className="h-4 w-4" />
                  </span>
                ) : null}
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 text-[10px] text-white">
                  {c.source === "client" ? "Client photo" : c.source === "custom" ? "Custom" : c.photographer ?? "Pexels"}
                  {c.vision && !c.vision.people ? <ShieldCheck className="h-3 w-3" aria-label="No people detected" /> : null}
                  {c.vision?.people ? <CircleUserRound className="h-3 w-3 text-notready-bg" aria-label="People detected" /> : null}
                </span>
              </button>
              {/* Sibling (not nested in the select button) so it stays clickable
                  even when the tile is disabled in review mode, and never hijacks
                  the select click. */}
              <button type="button" onClick={() => onZoom(c.url)} aria-label="View full size" title="View full size"
                className="absolute left-1.5 top-1.5 hidden h-6 w-6 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/80 group-hover:grid">
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {slot.candidates.length === 0 ? (
          <p className="col-span-full text-sm text-text-faint">No candidates — use &quot;Show different ones&quot; or add a custom URL.</p>
        ) : null}
      </div>

      {editable ? (
        <div className="mt-3 flex items-center gap-2">
          {/* Instant preview of the pasted URL, before the server round-trip */}
          {/^https?:\/\//.test(customUrl.trim()) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={customUrl} src={customUrl.trim()} alt="" className="h-10 w-14 rounded border border-border object-cover"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ) : null}
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-faint" />
            <input className={cn(inputCls, "pl-8")} placeholder="Custom image URL (https://…)"
              aria-label="Custom image URL"
              value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }} />
          </div>
          <button type="button" onClick={submitCustom} disabled={busy !== undefined || !customUrl.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
            {busy === "custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}
