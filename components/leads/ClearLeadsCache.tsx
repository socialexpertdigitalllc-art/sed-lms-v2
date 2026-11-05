"use client";

import { useEffect } from "react";
import { clearLeadsCache } from "@/lib/leads/liveSource";
import { resetLiveLeads } from "@/hooks/useLiveLeads";

/**
 * Mounted on the sign-in page: whoever lands there is signed out, so the
 * browser's copy of the leads is forgotten: the tab's in-memory copy first
 * (so nothing saves it again), then the saved one (lib/leads/liveSource.ts).
 * A shared computer never keeps the previous person's leads.
 */
export function ClearLeadsCache() {
  useEffect(() => {
    resetLiveLeads();
    void clearLeadsCache();
  }, []);
  return null;
}
