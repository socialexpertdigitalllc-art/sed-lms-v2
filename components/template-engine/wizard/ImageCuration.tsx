"use client";

import { useState } from "react";
import {
  Check, CircleUserRound, Hammer, ImagePlus, Link2, Loader2, RefreshCw, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";
import { slotProgress } from "@/lib/template-engine/wizard";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

export function ImageCuration({ gen, onChanged }: { gen: GenerationDetail; onChanged: () => void }) {
  const editable = gen.status === "curating";
  const slots = Array.isArray(gen.image_slots) ? gen.image_slots : [];
  const { chosen, total } = slotProgress(slots);
  const [building, setBuilding] = useState(false);
  // One mutation in flight per GENERATION, not per slot: the curation routes
  // read-modify-write the whole image_slots array, so two concurrent slot
  // updates would silently lose one of them (last writer wins).
  const [mutating, setMutating] = useState(false);
  const { toast } = useToast();

  async function startBuild() {
    setBuilding(true);
    try {
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

  if (slots.length === 0) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">No image slots yet — they appear when planning finishes.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text">{chosen}/{total}</span> slots chosen
          {editable ? " — every slot needs at least one image before the build" : ""}
        </p>
        {editable ? (
          <button type="button" onClick={startBuild} disabled={building || mutating || chosen < total}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            Build the site
          </button>
        ) : null}
      </div>

      {slots.map((slot) => (
        <SlotGrid key={slot.id} genId={gen.id} slot={slot} editable={editable} onChanged={onChanged}
          mutating={mutating} setMutating={setMutating} />
      ))}
    </div>
  );
}

function SlotGrid({ genId, slot, editable, onChanged, mutating, setMutating }: {
  genId: string; slot: ImageSlot; editable: boolean; onChanged: () => void;
  mutating: boolean; setMutating: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState<"more" | "select" | "custom" | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const { toast } = useToast();

  async function post(path: string, body?: unknown, kind: "more" | "select" | "custom" = "select") {
    if (mutating) return false; // another slot's write is in flight — see the lost-update note above
    setMutating(true);
    setBusy(kind);
    try {
      const res = await fetch(`/api/template-engine/generations/${genId}/images/${slot.id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        toast({ kind: "error", title: "Image update failed", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
        return false;
      }
      onChanged();
      return true;
    } catch {
      toast({ kind: "error", title: "Image update failed", body: "Try again" });
      return false;
    } finally {
      setBusy(null);
      setMutating(false);
    }
  }

  function toggle(url: string) {
    if (!editable) return;
    if (slot.selected.includes(url)) {
      post("select", { urls: slot.selected.filter((u) => u !== url) });
      return;
    }
    if (slot.selected.length < slot.pick_max) {
      post("select", { urls: [...slot.selected, url] });
      return;
    }
    if (slot.pick_max === 1) {
      post("select", { urls: [url] }); // single-pick: clicking another image swaps the pick
      return;
    }
    // Multi-pick slot already full — say so instead of silently ignoring the click.
    toast({ kind: "info", title: `This slot allows ${slot.pick_max} images`, body: "Deselect one first to swap." });
  }

  async function addCustom() {
    if (!customUrl.trim()) return;
    if (await post("custom", { url: customUrl.trim() }, "custom")) setCustomUrl("");
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
          <button type="button" onClick={() => post("more", undefined, "more")} disabled={mutating}
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
            <button key={c.url} type="button" onClick={() => toggle(c.url)} disabled={!editable || mutating}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded-md border-2 transition-colors",
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
          );
        })}
        {slot.candidates.length === 0 ? (
          <p className="col-span-full text-sm text-text-faint">No candidates — use "Show different ones" or add a custom URL.</p>
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
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} />
          </div>
          <button type="button" onClick={addCustom} disabled={mutating || !customUrl.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
            {busy === "custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}
