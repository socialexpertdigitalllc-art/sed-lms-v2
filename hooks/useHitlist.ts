"use client";

import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/components/common/Toast";
import type { HitlistMap } from "@/lib/hitlist/store";

type Override = { p: number | null; pending: boolean };

/**
 * The hit list as the table shows it: the server's map plus this tab's
 * optimistic changes. A star click updates the screen at once and the request
 * runs behind it; a failure puts the star back and says why. Settled changes
 * drop off as soon as fresh server data arrives (realtime or a refresh).
 */
export function useHitlist(server: HitlistMap | undefined) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  // New server data: keep only the changes still in flight.
  const [seen, setSeen] = useState(server);
  if (seen !== server) {
    setSeen(server);
    setOverrides((o) => {
      const keep: Record<string, Override> = {};
      for (const [id, v] of Object.entries(o)) if (v.pending) keep[id] = v;
      return keep;
    });
  }

  const map = useMemo<HitlistMap>(() => {
    const m: HitlistMap = { ...(server ?? {}) };
    for (const [id, v] of Object.entries(overrides)) {
      if (v.p == null) delete m[id];
      else m[id] = v.p;
    }
    return m;
  }, [server, overrides]);

  const setPriority = useCallback(
    async (leadId: string, p: number | null) => {
      setOverrides((o) => ({ ...o, [leadId]: { p, pending: true } }));
      try {
        const res = await fetch(`/api/hitlist/${leadId}`, p == null
          ? { method: "DELETE" }
          : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: p }) });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `Request failed (${res.status})`);
        }
        setOverrides((o) => (o[leadId]?.p === p ? { ...o, [leadId]: { p, pending: false } } : o));
      } catch (e) {
        setOverrides((o) => {
          if (o[leadId]?.p !== p) return o;
          const n = { ...o };
          delete n[leadId];
          return n;
        });
        toast({
          kind: "error",
          title: p == null ? "Couldn't remove it from the hit list" : "Couldn't add it to the hit list",
          body: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [toast],
  );

  return { map, setPriority };
}
