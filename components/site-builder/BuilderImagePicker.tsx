"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Link as LinkIcon, Loader2, X } from "lucide-react";
import { btnPrimary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { SmartImage, prefetchImages } from "@/components/common/SmartImage";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

export interface PickedImage {
  url: string;
  purpose: string;
}

interface LibraryHit { id: string; url: string; subject: string; thumb_url: string | null; }
interface PexelsHit { pexels_id: number; thumb_url: string; download_url: string; width: number; height: number; photographer: string; }

const TABS = [
  { id: "client", label: "Client photos" },
  { id: "library", label: "Library" },
  { id: "pexels", label: "Pexels" },
  { id: "link", label: "By link" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Search results survive close→reopen (and tab switches) for the session:
 *  reopening the picker used to re-run every search from scratch, which is
 *  most of what made it feel slow on the second and third open. */
const searchCache = {
  library: new Map<string, LibraryHit[]>(),
  pexels: new Map<string, PexelsHit[]>(),
};

/** Fire the library bookkeeping write WITHOUT making the operator wait for
 *  it. `/images/pick` returns the same URL it was given (it rehosts nothing —
 *  see its docblock), so the picked URL is already known client-side and the
 *  POST is pure record-keeping. Awaiting it added a network round-trip
 *  between click and selection for zero user-visible benefit. Errors surface
 *  as a toast; the pick itself still stands, because the URL is valid
 *  regardless of whether the library remembered it. */
function recordPick(body: Record<string, unknown>, onError: (message: string) => void): void {
  void (async () => {
    try {
      const res = await fetch("/api/site-builder/images/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        onError(parsed.error ?? "The image was added, but could not be saved to the library");
      }
    } catch {
      onError("The image was added, but could not be saved to the library");
    }
  })();
}

/**
 * The Site Builder image picker: the lead's own photos, the link library,
 * Pexels, and a pasted URL.
 *
 * Built around how it is ACTUALLY used (operator feedback, 2026-08-18):
 * most picks come from the client's own photos, and a Hero row usually takes
 * three of them. So the grid is large and adaptive (tiles grow into whatever
 * width the dialog has — never postage stamps in a sea of empty space),
 * selection is MULTI-select up to the row's limit with one "Add" at the end,
 * and the dialog does NOT close after each pick. Selection is instant: it is
 * local state, and the library write happens in the background.
 */
export function BuilderImagePicker({
  leadId,
  purposeSuggestions,
  clientPhotos,
  maxSelectable = 1,
  onAdded,
  onClose,
}: {
  leadId: string | null;
  purposeSuggestions: string[];
  clientPhotos: string[];
  /** How many images this row can still take (Hero: 3 minus already picked). */
  maxSelectable?: number;
  onAdded: (images: PickedImage[]) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const limit = Math.max(1, maxSelectable);
  const [tab, setTab] = useState<Tab>(clientPhotos.length > 0 ? "client" : "library");
  const [purpose, setPurpose] = useState(purposeSuggestions[0] ?? "Hero");

  /** Chosen-but-not-yet-added images, keyed by URL so a tile can show its own
   *  state and the footer can count them. Insertion order is preserved. */
  const [chosen, setChosen] = useState<Map<string, PickedImage & { record: Record<string, unknown> }>>(new Map());

  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryHits, setLibraryHits] = useState<LibraryHit[]>(() => searchCache.library.get("") ?? []);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsHits, setPexelsHits] = useState<PexelsHit[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);

  const [pastedUrl, setPastedUrl] = useState("");
  const activePurpose = purpose.trim() || purposeSuggestions[0] || "Hero";

  const searchLibrary = useCallback(async (subject: string) => {
    const key = `${subject.trim()}|${leadId ?? ""}`;
    const cached = searchCache.library.get(key);
    if (cached) {
      setLibraryHits(cached);
      return;
    }
    setLibraryLoading(true);
    try {
      const params = new URLSearchParams();
      if (subject.trim()) params.set("subject", subject.trim());
      if (leadId) params.set("lead_id", leadId);
      const res = await fetch(`/api/site-builder/images/library?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      const hits = (body.images ?? []) as LibraryHit[];
      searchCache.library.set(key, hits);
      setLibraryHits(hits);
      prefetchImages(hits.map((h) => h.thumb_url ?? h.url));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setLibraryLoading(false);
    }
  }, [leadId, toast]);

  // One effect for both "the tab was opened" and "the operator is typing":
  // the search always runs from a timer (never synchronously in the effect
  // body), and only for the tab actually in use — the old version re-fetched
  // the library on every open regardless of which tab was wanted.
  useEffect(() => {
    if (tab !== "library") return;
    const t = setTimeout(() => void searchLibrary(librarySearch), librarySearch ? 300 : 0);
    return () => clearTimeout(t);
  }, [tab, librarySearch, searchLibrary]);

  const searchPexels = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    const cached = searchCache.pexels.get(q);
    if (cached) {
      setPexelsHits(cached);
      return;
    }
    setPexelsLoading(true);
    try {
      const res = await fetch(`/api/site-builder/images/pexels?query=${encodeURIComponent(q)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Pexels search failed");
      const hits = (body.candidates ?? []) as PexelsHit[];
      searchCache.pexels.set(q, hits);
      setPexelsHits(hits);
      prefetchImages(hits.map((h) => h.thumb_url));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Pexels search failed" });
    } finally {
      setPexelsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab !== "pexels" || !pexelsQuery.trim()) return;
    const t = setTimeout(() => void searchPexels(pexelsQuery), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pexelsQuery, tab]);

  useEffect(() => {
    prefetchImages(clientPhotos);
  }, [clientPhotos]);

  const commit = useCallback(() => {
    if (chosen.size === 0) {
      onClose();
      return;
    }
    // Read the purpose HERE, not at click time: batching means the operator
    // can select tiles and THEN correct the Purpose field, and the label they
    // can see when they press Add is the one they mean. (Single-pick never had
    // this gap — the pick and the read happened in the same instant.)
    const images = [...chosen.values()].map((image) => ({
      ...image,
      purpose: activePurpose,
      record: { ...image.record, subject: activePurpose },
    }));
    for (const image of images) {
      recordPick(image.record, (message) => toast({ kind: "error", title: message }));
    }
    // Those picks are now IN the library, so any cached library result for
    // this session is stale — it would hide the images the operator just
    // added when they search the same subject again.
    searchCache.library.clear();
    onAdded(images.map(({ url, purpose: p }) => ({ url, purpose: p })));
    onClose();
  }, [chosen, onAdded, onClose, toast, activePurpose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, commit]);

  /** Toggle a tile. Selection is pure local state — no network, no await, so
   *  the ring appears on the same frame as the click. */
  const toggle = useCallback(
    (url: string, record: Record<string, unknown>) => {
      setChosen((prev) => {
        const next = new Map(prev);
        if (next.has(url)) {
          next.delete(url);
          return next;
        }
        if (next.size >= limit) {
          // Single-slot rows behave like a radio: picking another replaces it,
          // which is what an operator means by clicking a second image.
          if (limit === 1) {
            next.clear();
          } else {
            toast({
              kind: "error",
              title: `That's ${limit} image${limit === 1 ? "" : "s"} — deselect one first`,
            });
            return prev;
          }
        }
        next.set(url, { url, purpose: activePurpose, record });
        return next;
      });
    },
    [limit, toast, activePurpose],
  );

  const gridCls = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]";
  const tileCls = (selected: boolean) =>
    cn(
      "group relative aspect-[4/3] overflow-hidden rounded-lg border-2 bg-surface-2 transition-shadow",
      selected ? "border-accent ring-2 ring-accent" : "border-border hover:border-accent/60",
    );

  const SelectedBadge = ({ shown }: { shown: boolean }) =>
    shown ? (
      <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-white shadow">
        <Check className="h-4 w-4" />
      </span>
    ) : null;

  const clientTiles = useMemo(
    () =>
      clientPhotos.map((url, i) => {
        const selected = chosen.has(url);
        return (
          <button
            key={url}
            type="button"
            onClick={() => toggle(url, { kind: "client", url, lead_id: leadId, subject: activePurpose })}
            aria-pressed={selected}
            aria-label={`Client photo ${i + 1}`}
            className={tileCls(selected)}
          >
            <SmartImage src={url} sizes="260px" priority={i < 8} />
            <SelectedBadge shown={selected} />
          </button>
        );
      }),
    [clientPhotos, chosen, leadId, toggle, activePurpose],
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3 sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-label="Pick an image"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="flex-1 font-display text-base font-semibold text-text">
            Pick images
            <span className="ml-2 text-xs font-normal text-text-faint">
              {limit === 1 ? "one for this slot" : `up to ${limit}`}
            </span>
          </h2>
          <input
            list="builder-image-purpose-suggestions"
            className={cn(inputCls, "max-w-[260px]")}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Purpose — Hero, Gallery…"
            aria-label="Purpose for the picked images"
          />
          <datalist id="builder-image-purpose-suggestions">
            {purposeSuggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
          <button className={iconBtn} onClick={onClose} title="Close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-border px-5 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {t.label}
              {t.id === "client" && clientPhotos.length > 0 ? (
                <span className="ml-1.5 opacity-70">{clientPhotos.length}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {tab === "client" ? (
            clientPhotos.length === 0 ? (
              <p className="text-sm text-text-muted">This lead has no photos on file.</p>
            ) : (
              <div className={gridCls}>{clientTiles}</div>
            )
          ) : null}

          {tab === "library" ? (
            <div className="space-y-3">
              <input
                className={inputCls}
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Search the library by subject — results filter as you type"
                aria-label="Search the asset library"
              />
              {libraryLoading && libraryHits.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
              ) : libraryHits.length === 0 ? (
                <p className="text-sm text-text-muted">No matches.</p>
              ) : (
                <div className={gridCls}>
                  {libraryHits.map((a, i) => {
                    const selected = chosen.has(a.url);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggle(a.url, { kind: "link", url: a.url, subject: activePurpose })}
                        aria-pressed={selected}
                        className={tileCls(selected)}
                        title={a.subject}
                      >
                        <SmartImage src={a.thumb_url ?? a.url} sizes="260px" priority={i < 8} />
                        <SelectedBadge shown={selected} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {tab === "pexels" ? (
            <div className="space-y-3">
              <input
                className={inputCls}
                value={pexelsQuery}
                onChange={(e) => setPexelsQuery(e.target.value)}
                placeholder="Search Pexels, e.g. plumber van — searches as you type"
                aria-label="Search Pexels"
              />
              {pexelsLoading && pexelsHits.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>
              ) : pexelsHits.length === 0 ? (
                <p className="text-sm text-text-muted">Type above to search Pexels.</p>
              ) : (
                <div className={gridCls}>
                  {pexelsHits.map((h, i) => {
                    const selected = chosen.has(h.download_url);
                    return (
                      <button
                        key={h.pexels_id}
                        type="button"
                        onClick={() =>
                          toggle(h.download_url, {
                            kind: "pexels",
                            pexels: {
                              download_url: h.download_url,
                              thumb_url: h.thumb_url,
                              pexels_id: h.pexels_id,
                              width: h.width,
                              height: h.height,
                              photographer: h.photographer,
                              subject: activePurpose,
                            },
                          })
                        }
                        aria-pressed={selected}
                        className={tileCls(selected)}
                      >
                        <SmartImage src={h.thumb_url} sizes="260px" priority={i < 8} />
                        <SelectedBadge shown={selected} />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[10px] text-white">
                          Photo by {h.photographer} · Pexels
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {tab === "link" ? (
            <div className="max-w-2xl space-y-2">
              <label className="block text-xs font-medium text-text-muted" htmlFor="sb-paste-url">
                Image URL
              </label>
              <input
                id="sb-paste-url"
                className={inputCls}
                type="url"
                inputMode="url"
                placeholder="https://images.pexels.com/photos/…/photo.jpeg"
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const url = pastedUrl.trim();
                  if (!/^https?:\/\//i.test(url)) {
                    toast({ kind: "error", title: "Enter a full http(s) image URL" });
                    return;
                  }
                  toggle(url, { kind: "link", url, subject: activePurpose });
                  setPastedUrl("");
                }}
              />
              <p className="text-[11px] leading-relaxed text-text-faint">
                The site links to this URL directly, so it must be publicly reachable — a link that needs a login or an
                expiring token will not load for visitors.
              </p>
              <button
                className={btnSecondarySm}
                onClick={() => {
                  const url = pastedUrl.trim();
                  if (!/^https?:\/\//i.test(url)) {
                    toast({ kind: "error", title: "Enter a full http(s) image URL" });
                    return;
                  }
                  toggle(url, { kind: "link", url, subject: activePurpose });
                  setPastedUrl("");
                }}
                disabled={!pastedUrl.trim()}
              >
                <LinkIcon className="h-4 w-4" /> Add this link to the selection
              </button>
            </div>
          ) : null}
        </div>

        {/* Footer: the selection lives here until the operator commits it, so
            picking three photos is three clicks and ONE dialog, not three. */}
        <footer className="flex items-center gap-3 border-t border-border px-5 py-3">
          <div className="flex flex-1 items-center gap-2 overflow-x-auto">
            {[...chosen.values()].map((image) => (
              <button
                key={image.url}
                type="button"
                onClick={() => toggle(image.url, image.record)}
                title="Remove from selection"
                aria-label="Remove from selection"
                className="relative h-11 w-14 shrink-0 overflow-hidden rounded-md border border-accent"
              >
                <SmartImage src={image.url} sizes="112px" />
              </button>
            ))}
            <span className="whitespace-nowrap text-xs text-text-muted">
              {chosen.size} of {limit} selected
            </span>
          </div>
          <button className={btnSecondarySm} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={commit} disabled={chosen.size === 0}>
            Add {chosen.size > 0 ? chosen.size : ""} {chosen.size === 1 ? "image" : "images"}
          </button>
        </footer>
      </div>
    </div>
  );
}
