"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { stripUnreadPrefix, withUnreadPrefix } from "@/lib/notifications/tabBadge";

/** Original favicon href, cached once per page load so we can always restore it. */
let originalFaviconHref: string | null = null;

function setFaviconHref(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

/** Draw the base favicon (or a brand-accent fallback) plus unread dots onto a 64×64 canvas and swap it in. */
function drawBadged(base: HTMLImageElement | null, general: number, website: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (base) {
    ctx.drawImage(base, 0, 0, 64, 64);
  } else {
    ctx.fillStyle = "#0d9488";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(4, 4, 56, 56, 12);
      ctx.fill();
    } else {
      ctx.fillRect(4, 4, 56, 56);
    }
  }
  const dot = (x: number, y: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  };
  if (website > 0) dot(50, 50, "#2563eb"); // bottom-right — Website bell
  if (general > 0) dot(50, 14, "#f59e0b"); // top-right — General bell
  setFaviconHref(canvas.toDataURL("image/png"));
}

function applyBadge(general: number, website: number) {
  if (originalFaviconHref === null) {
    originalFaviconHref =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? "/favicon.ico";
  }
  document.title = withUnreadPrefix(document.title, general + website);
  if (general === 0 && website === 0) {
    setFaviconHref(originalFaviconHref);
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      drawBadged(img, general, website);
    } catch {
      /* canvas unavailable — keep the plain favicon */
    }
  };
  img.onerror = () => {
    try {
      drawBadged(null, general, website);
    } catch {
      /* canvas unavailable — keep the plain favicon */
    }
  };
  img.src = originalFaviconHref;
}

/**
 * WhatsApp-Web-style tab badge: favicon dots + "(n) " title prefix for unread
 * notifications. Renders nothing — it only drives document.title and the icon link.
 */
export function TabBadge() {
  const [counts, setCounts] = useState({ general: 0, website: 0 });
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [gRes, wRes] = await Promise.all([
          fetch("/api/notifications?bell=general&unread=1"),
          fetch("/api/notifications?bell=website&unread=1"),
        ]);
        const general = gRes.ok ? (((await gRes.json()).notifications ?? []) as unknown[]).length : 0;
        const website = wRes.ok ? (((await wRes.json()).notifications ?? []) as unknown[]).length : 0;
        if (active) setCounts({ general, website });
      } catch {
        /* fail-soft — the tab badge just doesn't update */
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  // Live updates — same direct subscription BellBase uses (router.refresh()
  // wouldn't re-run the client-side fetch effect above).
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-tab-badge");

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRefreshTick((n) => n + 1), 400);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    try {
      applyBadge(counts.general, counts.website);
    } catch {
      /* jsdom / no-canvas safety — the badge must never throw */
    }
  }, [counts]);

  // Restore the original favicon + title when the badge unmounts.
  useEffect(() => {
    return () => {
      try {
        if (originalFaviconHref) setFaviconHref(originalFaviconHref);
        document.title = stripUnreadPrefix(document.title);
      } catch {
        /* nothing to restore */
      }
    };
  }, []);

  return null;
}
