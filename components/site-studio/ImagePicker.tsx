"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { btnPrimary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { ImageCandidate, PickChoice } from "@/lib/site-studio/assets/types";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

type ThumbCandidate = ImageCandidate & { thumb_url?: string | null };
interface LibraryHit { id: string; storage_path: string; subject: string; thumb_url: string | null; }

const TABS = [
  { id: "candidates", label: "Candidates" },
  { id: "library", label: "Library" },
  { id: "client", label: "Client photos" },
  { id: "upload", label: "Upload" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * Per-slot image dialog: sourced candidates, library search, the lead's own
 * photos, and a manual upload — all funnel into the same `POST /images` pick,
 * which rehosts (never hot-links) and writes `asset:{id}` into the slot. The
 * paired `{slotId}_alt` text slot is edited right here too — nothing new is
 * needed for alt text (the compiler already pairs every image slot with one).
 */
export function ImagePicker({
  runId,
  leadId,
  pageIndex,
  slotId,
  clientPhotos,
  altValue,
  onEditAlt,
  onPicked,
  onClose,
}: {
  runId: string;
  leadId: string | null;
  pageIndex: number;
  slotId: string;
  clientPhotos: string[];
  altValue: string;
  onEditAlt: (value: string) => Promise<void>;
  onPicked: (run: StudioRunRow) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const key = `${pageIndex}:${slotId}`;

  const [tab, setTab] = useState<Tab>("candidates");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ThumbCandidate[]>([]);

  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibraryHit[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);

  const [altDraft, setAltDraft] = useState(altValue);
  const [savingAlt, setSavingAlt] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/images`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load image candidates");
      const slot = body.slots?.[key] as { query?: string; candidates?: ThumbCandidate[] } | undefined;
      setQuery(slot?.query ?? "");
      setCandidates(slot?.candidates ?? []);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load image candidates" });
    } finally {
      setLoading(false);
    }
  }, [runId, key, toast]);

  useEffect(() => { void loadCandidates(); }, [loadCandidates]);

  const searchLibrary = useCallback(async (subject: string) => {
    setLibraryLoading(true);
    try {
      const params = new URLSearchParams();
      if (subject.trim()) params.set("subject", subject.trim());
      if (leadId) params.set("lead_id", leadId);
      const res = await fetch(`/api/site-studio/assets?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setLibraryHits((body.assets ?? []) as LibraryHit[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setLibraryLoading(false);
    }
  }, [leadId, toast]);

  useEffect(() => {
    if (tab === "library" && libraryHits.length === 0 && !libraryLoading) void searchLibrary(librarySearch || query);
    // Only re-run when the tab is opened — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(choice: PickChoice) {
    setPicking(true);
    try {
      const res = await fetch(`/api/site-studio/runs/${runId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, choice }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // The row changed under us (another edit or pick landed first, see
        // images/route.ts's CAS comment) — this dialog's candidate list may
        // now be stale too, so refetch the run for the parent and close
        // rather than leave a picker open against a doc that no longer
        // matches what's on the row. Toast the server's message verbatim.
        toast({
          kind: "error",
          title: body.error ?? "This run changed while you were editing — your view has been refreshed, please redo that change",
        });
        const freshRes = await fetch(`/api/site-studio/runs/${runId}`);
        const freshBody = await freshRes.json().catch(() => ({}));
        if (freshRes.ok && freshBody.run) onPicked(freshBody.run as StudioRunRow);
        onClose();
        return;
      }
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not pick this image" });
        return;
      }
      toast({ kind: "success", title: "Image picked" });
      onPicked(body.run as StudioRunRow);
      onClose();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not pick this image" });
    } finally {
      setPicking(false);
    }
  }

  async function uploadThenPick() {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("subject", query);
      const res = await fetch("/api/site-studio/assets", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Upload failed" });
        return;
      }
      await pick({ kind: "library", asset_id: body.asset.id });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function saveAlt() {
    setSavingAlt(true);
    try {
      await onEditAlt(altDraft);
      toast({ kind: "success", title: "Alt text saved" });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not save alt text" });
    } finally {
      setSavingAlt(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-border bg-surface"
        role="dialog"
        aria-label="Pick an image"
      >
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="flex-1 font-display text-base font-semibold text-text">Pick an image</h2>
          <button className={iconBtn} onClick={onClose} title="Close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-border px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {tab === "candidates" ? (
            loading ? (
              <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-text-muted">No candidates were sourced for this slot yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={picking}
                    onClick={() => void pick(
                      c.kind === "library"
                        ? { kind: "library", asset_id: c.asset_id }
                        : { kind: "pexels", pexels_id: c.pexels_id, download_url: c.download_url, width: c.width, height: c.height, photographer: c.photographer, subject: query },
                    )}
                    className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumb_url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {c.kind === "pexels" ? (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        Photo by {c.photographer} · Pexels
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )
          ) : null}

          {tab === "library" ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchLibrary(librarySearch); }}
                  placeholder="Search subject"
                  aria-label="Search the asset library"
                />
                <button className={btnSecondarySm} onClick={() => void searchLibrary(librarySearch)}>Search</button>
              </div>
              {libraryLoading ? (
                <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
              ) : libraryHits.length === 0 ? (
                <p className="text-sm text-text-muted">No matches.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {libraryHits.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={picking}
                      onClick={() => void pick({ kind: "library", asset_id: a.id })}
                      className="relative aspect-[4/3] overflow-hidden rounded-md border border-border"
                      title={a.subject}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.thumb_url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === "client" ? (
            clientPhotos.length === 0 ? (
              <p className="text-sm text-text-muted">This lead has no photos on file.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {clientPhotos.map((url) => (
                  <button
                    key={url}
                    type="button"
                    disabled={picking}
                    onClick={() => void pick({ kind: "client", url, subject: query })}
                    className="relative aspect-[4/3] overflow-hidden rounded-md border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )
          ) : null}

          {tab === "upload" ? (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                aria-label="Upload an image"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <button className={btnPrimary} onClick={() => void uploadThenPick()} disabled={uploading || !uploadFile}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload &amp; pick
              </button>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border p-4">
          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor={`alt-${key}`}>Alt text</label>
          <div className="flex gap-2">
            <input id={`alt-${key}`} className={inputCls} value={altDraft} onChange={(e) => setAltDraft(e.target.value)} />
            <button className={btnSecondarySm} onClick={() => void saveAlt()} disabled={savingAlt}>
              {savingAlt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
