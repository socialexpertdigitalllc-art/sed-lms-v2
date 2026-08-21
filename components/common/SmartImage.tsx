"use client";

import { useState } from "react";
import Image from "next/image";
import { isOptimizableImageUrl } from "@/lib/images/hosts";
import { cn } from "@/lib/utils";

/**
 * A remote thumbnail that loads FAST and degrades safely.
 *
 * Known hosts (lib/images/hosts.ts) go through Next's optimizer: our server
 * fetches the original once, resizes it with sharp, and serves a small webp
 * that the browser and CDN cache for a year — the difference between a
 * 832 KB / 4-second ImgBB original and a ~25 KB instant tile. Anything else
 * (a pasted link, an unknown CDN) renders as a plain <img>, so no image can
 * ever fail to appear just because its host isn't on the list. If the
 * optimizer itself errors on a specific image, this falls back to the raw
 * URL rather than showing a hole.
 *
 * Always fills its positioned parent — the caller owns the box and aspect.
 */
export function SmartImage({
  src,
  alt = "",
  sizes = "240px",
  priority = false,
  className,
}: {
  src: string;
  alt?: string;
  /** Width hint so the optimizer picks the right variant. */
  sizes?: string;
  /** Load immediately (above-the-fold tiles) instead of lazily. */
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Distinct from `failed`: that one means "optimizer said no, retry raw".
  // This one means the raw URL failed too — the image is simply not
  // retrievable, and the tile must settle into a static broken state instead
  // of pulsing forever (a shimmer that never resolves reads as "still
  // loading", so the operator waits on an image that will never arrive).
  const [broken, setBroken] = useState(false);

  // A changed src is a different image: re-arm both flags, or a previously
  // failed tile would stay in fallback and a loaded one would skip its fade.
  // Adjusted DURING RENDER (React's documented pattern for state derived from
  // props) rather than in an effect — an effect would paint the old image's
  // state for a frame first, and re-render cascades on a grid of tiles.
  const [renderedSrc, setRenderedSrc] = useState(src);
  if (renderedSrc !== src) {
    setRenderedSrc(src);
    setFailed(false);
    setLoaded(false);
    setBroken(false);
  }

  // A candidate can arrive without a thumbnail (`thumb_url ?? ""`). An empty
  // src makes some browsers re-request the current page, so render just the
  // placeholder box instead of an image element.
  if (!src) return <span aria-hidden className="absolute inset-0 bg-surface-2" />;

  const optimize = isOptimizableImageUrl(src) && !failed;
  const imgCls = cn(
    "h-full w-full object-cover transition-opacity duration-200",
    loaded ? "opacity-100" : "opacity-0",
    className,
  );

  if (broken) {
    return (
      <span
        className="absolute inset-0 grid place-items-center bg-surface-2 text-[10px] text-text-faint"
        title={`This image could not be loaded: ${src}`}
      >
        Image unavailable
      </span>
    );
  }

  return (
    <>
      {/* Skeleton underneath: the tile has shape immediately, so a grid never
          reflows or flashes white while thumbnails stream in. */}
      {!loaded ? <span aria-hidden className="absolute inset-0 animate-pulse bg-surface-2" /> : null}
      {optimize ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          quality={70}
          priority={priority}
          loading={priority ? undefined : "lazy"}
          className={imgCls}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className={imgCls}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      )}
    </>
  );
}

/** Warm at most this many images per burst, this many at a time. */
const PREFETCH_MAX = 24;
const PREFETCH_CONCURRENCY = 6;
/** URLs already warmed this page-load, so stacked bursts don't refetch. */
const prefetched = new Set<string>();
const prefetchKey = (url: string, width: number) => `${width}|${url}`;

/**
 * Warm the optimizer + browser cache for images the operator is ABOUT to
 * see. Called when a lead is selected so its photos are already decoded by
 * the time the picker opens — the wait the operator complained about was
 * happening at open time, on every open.
 */
export function prefetchImages(urls: string[]): void {
  if (typeof window === "undefined") return;

  // Warm the width the browser will ACTUALLY request. Tiles ask for ~260px
  // with no vw unit, so Next emits the full srcset and the browser picks the
  // first candidate at or above its DPR: 384 at DPR 1, but 640 at 1.5+
  // (Windows 150% scaling, retina). Prefetching a fixed 384 warmed a variant
  // half our operators never request, and made the server encode BOTH.
  const dpr = window.devicePixelRatio || 1;
  const width = dpr >= 1.5 ? 640 : 384;

  const queue = urls
    .filter((u) => u && !prefetched.has(prefetchKey(u, width)))
    .slice(0, PREFETCH_MAX);
  if (queue.length === 0) return;

  // Bounded concurrency: every optimizer miss is a server-side fetch of an
  // ~832 KB original plus a sharp encode, and these bursts stack (lead
  // select, picker open, each debounced search). Firing all of them at once
  // buried the box; a small window keeps the first tiles fast without
  // monopolising it.
  let active = 0;
  const pump = () => {
    while (active < PREFETCH_CONCURRENCY && queue.length > 0) {
      const url = queue.shift() as string;
      const key = prefetchKey(url, width);
      if (prefetched.has(key)) continue;
      prefetched.add(key);
      active++;
      const img = new window.Image();
      img.decoding = "async";
      const done = () => {
        active--;
        pump();
      };
      img.onload = done;
      img.onerror = () => {
        // A failed warm must not poison the real render's chance to retry.
        prefetched.delete(key);
        done();
      };
      img.src = isOptimizableImageUrl(url)
        ? `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=70`
        : url;
    }
  };
  pump();
}
