"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { btnPrimary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

export interface PickedImage {
  url: string;
  purpose: string;
}

interface LibraryHit { id: string; storage_path: string; subject: string; thumb_url: string | null; }
interface PexelsHit { pexels_id: number; thumb_url: string; download_url: string; width: number; height: number; photographer: string; }

const TABS = [
  { id: "library", label: "Library" },
  { id: "pexels", label: "Pexels" },
  { id: "client", label: "Client photos" },
  { id: "upload", label: "Upload" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * The Site Builder image picker: library search, Pexels search, the lead's
 * own photos, and a manual upload — all funnel into `POST /api/site-builder/
 * images/pick`, which rehosts (never hot-links) and hands back a durable URL.
 * Every picked image is paired with a purpose label right here, in the same
 * dialog (the operator's main creative input for a run — see AGENTS.md) so
 * picking is a single click once the purpose is set, not a two-step chore.
 */
export function BuilderImagePicker({
  leadId,
  purposeSuggestions,
  clientPhotos,
  onAdded,
  onClose,
}: {
  leadId: string | null;
  purposeSuggestions: string[];
  clientPhotos: string[];
  onAdded: (image: PickedImage) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("library");
  const [purpose, setPurpose] = useState(purposeSuggestions[0] ?? "Hero");
  const [picking, setPicking] = useState(false);

  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibraryHit[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsHits, setPexelsHits] = useState<PexelsHit[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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

  useEffect(() => { void searchLibrary(""); }, [searchLibrary]);

  const searchPexels = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setPexelsLoading(true);
    try {
      const res = await fetch(`/api/site-builder/images/pexels?query=${encodeURIComponent(query.trim())}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Pexels search failed");
      setPexelsHits((body.candidates ?? []) as PexelsHit[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Pexels search failed" });
    } finally {
      setPexelsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pickLibrary(assetId: string) {
    if (!purpose.trim()) { toast({ kind: "error", title: "Enter a purpose for this image first" }); return; }
    setPicking(true);
    try {
      const res = await fetch("/api/site-builder/images/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "library", asset_id: assetId, lead_id: leadId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not pick this image" }); return; }
      onAdded({ url: body.url as string, purpose: purpose.trim() });
      toast({ kind: "success", title: "Image added" });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not pick this image" });
    } finally {
      setPicking(false);
    }
  }

  async function pickPexels(hit: PexelsHit) {
    if (!purpose.trim()) { toast({ kind: "error", title: "Enter a purpose for this image first" }); return; }
    setPicking(true);
    try {
      const res = await fetch("/api/site-builder/images/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "pexels",
          pexels: {
            download_url: hit.download_url,
            pexels_id: hit.pexels_id,
            width: hit.width,
            height: hit.height,
            photographer: hit.photographer,
            subject: purpose.trim(),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not pick this image" }); return; }
      onAdded({ url: body.url as string, purpose: purpose.trim() });
      toast({ kind: "success", title: "Image added" });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not pick this image" });
    } finally {
      setPicking(false);
    }
  }

  async function pickClient(url: string) {
    if (!purpose.trim()) { toast({ kind: "error", title: "Enter a purpose for this image first" }); return; }
    if (!leadId) { toast({ kind: "error", title: "Pick a lead first" }); return; }
    setPicking(true);
    try {
      const res = await fetch("/api/site-builder/images/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "client", url, lead_id: leadId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Could not pick this photo" }); return; }
      onAdded({ url: body.url as string, purpose: purpose.trim() });
      toast({ kind: "success", title: "Image added" });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not pick this photo" });
    } finally {
      setPicking(false);
    }
  }

  async function uploadThenPick() {
    if (!uploadFile) return;
    if (!purpose.trim()) { toast({ kind: "error", title: "Enter a purpose for this image first" }); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("subject", purpose.trim());
      const res = await fetch("/api/site-studio/assets", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ kind: "error", title: body.error ?? "Upload failed" }); return; }
      await pickLibrary(body.asset.id as string);
      setUploadFile(null);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
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

        <div className="border-b border-border p-4">
          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="builder-image-purpose">
            Purpose — what is this image for?
          </label>
          <input
            id="builder-image-purpose"
            list="builder-image-purpose-suggestions"
            className={inputCls}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Hero, Gallery, About, or a service name…"
          />
          <datalist id="builder-image-purpose-suggestions">
            {purposeSuggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
          <p className="mt-1 text-xs text-text-faint">Picking an image below adds it with this purpose.</p>
        </div>

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
                      onClick={() => void pickLibrary(a.id)}
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

          {tab === "pexels" ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={pexelsQuery}
                  onChange={(e) => setPexelsQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchPexels(pexelsQuery); }}
                  placeholder="Search Pexels, e.g. plumber van"
                  aria-label="Search Pexels"
                />
                <button className={btnSecondarySm} onClick={() => void searchPexels(pexelsQuery)}>Search</button>
              </div>
              {pexelsLoading ? (
                <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
              ) : pexelsHits.length === 0 ? (
                <p className="text-sm text-text-muted">No results yet — search above.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {pexelsHits.map((h) => (
                    <button
                      key={h.pexels_id}
                      type="button"
                      disabled={picking}
                      onClick={() => void pickPexels(h)}
                      className="group relative aspect-[4/3] overflow-hidden rounded-md border border-border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={h.thumb_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        Photo by {h.photographer} · Pexels
                      </span>
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
                    onClick={() => void pickClient(url)}
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
                Upload &amp; add
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
