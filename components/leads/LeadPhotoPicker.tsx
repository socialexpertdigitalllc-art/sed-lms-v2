"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";
import { usePhotoExtension } from "@/hooks/usePhotoExtension";
import { ExtensionInstallCard } from "./ExtensionInstallCard";
import { useToast } from "@/components/common/Toast";

type Candidate = {
  id: string;
  photoKey: string;
  thumbUrl: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  hostedUrl: string | null;
  error: string | null;
};

type CaptureState = {
  status: "pending" | "ready" | "none_found" | "failed";
  profileLink: string | null;
  foundCount: number;
  error: string | null;
} | null;

export function LeadPhotoPicker({
  leadId,
  profileLink,
  canEdit,
}: {
  leadId: string;
  profileLink: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const ext = usePhotoExtension();
  const [capture, setCapture] = useState<CaptureState>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const autoFired = useRef<string | null>(null);

  type CaptureData = { capture: CaptureState; candidates: Candidate[] };

  const fetchState = useCallback(async (): Promise<CaptureData | null> => {
    const res = await fetch(`/api/leads/${leadId}/photos`);
    if (!res.ok) {
      // A silent failure here is indistinguishable from "no capture yet",
      // which is exactly what an unapplied migration looks like — say so.
      toast({ kind: "error", title: (await res.json().catch(() => ({}))).error ?? "Could not load photo capture state" });
      return null;
    }
    return (await res.json()) as CaptureData;
  }, [leadId, toast]);

  const apply = useCallback((data: CaptureData) => {
    setCapture(data.capture);
    setCandidates(data.candidates);
    setLoaded(true);
  }, []);

  /** Refresh after an action. Callers await this, so it stays imperative. */
  const load = useCallback(async () => {
    const data = await fetchState();
    if (data) apply(data);
  }, [fetchState, apply]);

  // The initial fetch sets state from the promise callback rather than the
  // effect body: setState directly in an effect body triggers cascading
  // renders (react-hooks/set-state-in-effect). `alive` drops a response that
  // lands after the operator has navigated away.
  useEffect(() => {
    let alive = true;
    void fetchState().then((data) => {
      if (alive && data) apply(data);
    });
    return () => {
      alive = false;
    };
  }, [fetchState, apply]);

  const runCapture = useCallback(async () => {
    if (!profileLink) return;

    // EVERY call here must check `ok`. The server now returns a 500 when the
    // store fails (e.g. the migration is not applied) — ignoring that would
    // leave the operator watching a spinner, or worse, show "Captured 18
    // photos" for a harvest that was never saved.
    const started = await fetch(`/api/leads/${leadId}/photos/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "started", profileLink }),
    });
    if (!started.ok) {
      toast({ kind: "error", title: (await started.json().catch(() => ({}))).error ?? "Could not start the capture" });
      return;
    }
    setCapture({ status: "pending", profileLink, foundCount: 0, error: null });
    try {
      const photos = await ext.capture(profileLink);
      const saved = await fetch(`/api/leads/${leadId}/photos/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "done", profileLink, photos, extensionVersion: ext.version }),
      });
      if (!saved.ok) {
        toast({ kind: "error", title: (await saved.json().catch(() => ({}))).error ?? "Captured, but could not save the photos" });
        await load();
        return;
      }
      toast({
        kind: photos.length ? "success" : "info",
        title: photos.length ? `Captured ${photos.length} photos` : "No photos found on that profile",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Capture failed";
      await fetch(`/api/leads/${leadId}/photos/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "failed", error: message }),
      });
      toast({ kind: "error", title: message });
    }
    await load();
  }, [leadId, profileLink, ext, toast, load]);

  /**
   * Auto-capture. Two cases, one rule: run when this lead has never been
   * captured, or when the profile link has been EDITED since the last capture
   * (the design's trigger (b)). `autoFired` keeps it to once per link per
   * mount, so a failed capture does not spin.
   */
  useEffect(() => {
    if (!loaded || !profileLink || !ext.installed || ext.capturing || !canEdit) return;
    if (!isGoogleProfileLink(profileLink)) return;
    if (capture && capture.profileLink === profileLink) return;
    if (autoFired.current === profileLink) return;
    autoFired.current = profileLink;
    void runCapture();
  }, [loaded, profileLink, ext.installed, ext.capturing, canEdit, capture, runCapture]);

  async function upload() {
    const photoKeys = candidates.filter((c) => selected.has(c.id)).map((c) => c.photoKey);
    if (photoKeys.length === 0) return;
    setUploading(true);
    const res = await fetch(`/api/leads/${leadId}/photos/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoKeys }),
    });
    setUploading(false);
    if (!res.ok) {
      toast({ kind: "error", title: (await res.json().catch(() => ({}))).error ?? "Upload failed" });
      return;
    }
    const { uploaded, failed } = (await res.json()) as { uploaded: string[]; failed: { error: string }[] };
    // Counts alone ("0 uploaded · 3 failed") leave the reason reachable only
    // by hovering a specific thumbnail — surface the first failure's reason
    // right in the toast so a fully-failed batch (e.g. no image host
    // configured) is actionable without hunting.
    toast({
      kind: failed.length ? "error" : "success",
      title: `${uploaded.length} uploaded${failed.length ? ` · ${failed.length} failed — ${failed[0].error}` : ""}`,
    });
    setSelected(new Set());
    await load();
    router.refresh();
  }

  if (!profileLink) return null;

  const pickable = candidates.filter((c) => c.status !== "uploaded");

  return (
    <div className="space-y-3">
      <ExtensionInstallCard installed={ext.installed} version={ext.version} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canEdit || ext.capturing || !ext.installed}
          onClick={runCapture}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {ext.capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {ext.capturing ? `Capturing… ${ext.progress} found` : candidates.length ? "Re-capture photos" : "Capture photos"}
        </button>
        {capture?.status === "failed" && <span className="text-sm text-dropped-fg">{capture.error}</span>}
        {capture?.status === "none_found" && <span className="text-sm text-text-faint">No photos found on that profile.</span>}
      </div>

      {candidates.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => setSelected(new Set(pickable.map((c) => c.id)))} className="underline">
              Select all
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="underline">
              None
            </button>
            <span className="text-text-faint">
              <b>{selected.size}</b> selected
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {candidates.map((c) => {
              const done = c.status === "uploaded";
              const isSelected = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={done || !canEdit}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className={`relative aspect-square overflow-hidden rounded border-2 ${
                    done ? "border-green-500/60 opacity-60" : isSelected ? "border-accent" : "border-transparent"
                  }`}
                  title={c.error ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  {(done || isSelected) && (
                    <span className="absolute right-1 top-1 rounded-full bg-black/70 p-1">
                      <Check size={12} className={done ? "text-green-400" : "text-white"} />
                    </span>
                  )}
                  {c.status === "failed" && <span className="absolute inset-x-0 bottom-0 bg-red-500/80 text-[10px]">failed</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!canEdit || uploading || selected.size === 0}
            onClick={upload}
            className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {uploading && <Loader2 size={16} className="animate-spin" />}
            Use selected photos
          </button>
        </>
      )}
    </div>
  );
}
