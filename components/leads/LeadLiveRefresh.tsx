"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeLeadsTicks } from "@/lib/realtime/leadsTicks";
import { useTableTicks } from "@/hooks/useTableTicks";

/** Tables the lead page shows rows of, beyond the lead itself (matched by lead_id / ticket_id). */
export const LEAD_PAGE_TABLES = [
  "lead_tickets",
  "ticket_items",
  "contracts",
  "lead_receipts",
  "form_endpoints",
  "form_submissions",
  "lead_status_events",
  "lead_hitlist",
];

/** Wait after a tick before checking, so a burst of changes is one check. */
export const LEAD_PAGE_CHECK_DELAY_MS = 600;

/**
 * Keeps an open lead page current when SOMEONE ELSE changes the lead. On a
 * lead tick it reads just this lead's `updated_at` (one tiny row) and — only
 * when it moved, or its tags changed — refreshes the page. Hidden tabs wait
 * until they are looked at. The page used to never update by itself.
 */
export function LeadLiveRefresh({
  leadId,
  updatedAt,
  tagIds,
  ticketIds = [],
}: {
  leadId: string;
  updatedAt: string;
  tagIds: string[];
  /** This lead's tickets, so a ticked-off item on one of them refreshes the page. */
  ticketIds?: string[];
}) {
  const router = useRouter();
  // Its other rows: tickets and their items, contracts, receipts, forms, the
  // status history and its HitList star — but never another lead's.
  const ticketSet = ticketIds.join(",");
  useTableTicks(LEAD_PAGE_TABLES, () => router.refresh(), {
    filter: (p) =>
      p.table === "ticket_items"
        ? !!p.ticket_id && ticketSet.split(",").includes(p.ticket_id)
        : p.lead_id === leadId,
  });
  const seen = useRef({ updatedAt, tags: [...tagIds].sort().join(",") });
  useEffect(() => {
    seen.current = { updatedAt, tags: [...tagIds].sort().join(",") };
  }, [updatedAt, tagIds]);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;
    let pendingTags = false;
    let cancelled = false;

    const check = async () => {
      timer = null;
      if (document.visibilityState !== "visible") return; // stays pending
      const tags = pendingTags;
      pending = false;
      pendingTags = false;
      const { data } = await supabase.from("leads").select("updated_at").eq("id", leadId).maybeSingle();
      let moved = !!data && (data as { updated_at: string }).updated_at !== seen.current.updatedAt;
      if (!moved && tags) {
        const { data: links } = await supabase.from("lead_tag_links").select("tag_id").eq("lead_id", leadId);
        const now = ((links ?? []) as { tag_id: string }[]).map((l) => l.tag_id).sort().join(",");
        moved = now !== seen.current.tags;
      }
      if (moved && !cancelled) router.refresh();
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(() => void check(), LEAD_PAGE_CHECK_DELAY_MS);
    };
    const unsubscribe = subscribeLeadsTicks(
      (kind) => {
        if (kind === "other") return;
        pending = true;
        if (kind === "tags") pendingTags = true;
        if (document.visibilityState === "visible") schedule();
      },
      () => {
        pending = true;
        pendingTags = true;
        schedule();
      },
    );
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending) schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leadId, router]);

  return null;
}
