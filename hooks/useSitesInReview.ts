"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTableTicks } from "@/hooks/useTableTicks";

/**
 * Which leads have a website waiting for the developer (lead_site_reviews,
 * lib/leads/siteReview.ts) — readable by Tech and Admin only (RLS). Lets the
 * SENT button know a lead without a link still has a site it can finalize.
 * Live: re-reads when that table changes.
 */
export function useSitesInReview(enabled: boolean): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(0);
  useTableTicks(enabled ? ["lead_site_reviews"] : [], () => setVersion((v) => v + 1));
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await createClient().from("lead_site_reviews").select("lead_id");
        if (!cancelled && !error && data) setIds(new Set((data as { lead_id: string }[]).map((r) => r.lead_id)));
      } catch {
        /* no table / offline: no sites in review */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);
  return ids;
}
