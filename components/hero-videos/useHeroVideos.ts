"use client";

import { useCallback, useEffect, useState } from "react";
import type { HeroVideoCard } from "@/lib/hero-videos/library";

export type { HeroVideoCard };

/**
 * The gallery catalogue (ready videos), fetched once per page and shared by
 * every component that needs it — the lead form's summary and its gallery
 * both read it, and neither should cost its own request.
 */
let cache: Promise<HeroVideoCard[]> | null = null;

function load(force = false): Promise<HeroVideoCard[]> {
  if (!cache || force) {
    cache = fetch("/api/site-builder/hero-videos")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the hero videos");
        return (body.videos ?? []) as HeroVideoCard[];
      })
      .catch((e) => {
        cache = null; // a failure is retried by the next caller
        throw e;
      });
  }
  return cache;
}

export function useHeroVideos(): {
  videos: HeroVideoCard[] | null;
  error: string | null;
  reload: () => void;
} {
  const [videos, setVideos] = useState<HeroVideoCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback((force: boolean) => {
    let cancelled = false;
    load(force)
      .then((v) => {
        if (!cancelled) {
          setVideos(v);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the hero videos");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => run(false), [run]);

  return { videos, error, reload: () => void run(true) };
}

/** Drop the shared catalogue so the next reader fetches it fresh (after a sync or an import). */
export function invalidateHeroVideos(): void {
  cache = null;
}
