"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/common/Toast";
import { syncLeadsNow } from "@/hooks/useLiveLeads";
import { LINE_LABEL, type LineType } from "@/lib/hitlist/line";

type Override = { v: LineType | null; pending: boolean };

/**
 * The HitList's Direct Line tag as the table shows it: the lead's saved value
 * plus this tab's optimistic clicks. A click shows at once and saves behind
 * it; a failure puts the old value back and says why. Settled clicks drop off
 * when fresh leads arrive from the live store (`rowsVersion` changes).
 */
export function useLineTypes(rowsVersion: unknown) {
  const { toast } = useToast();
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [seen, setSeen] = useState(rowsVersion);
  if (seen !== rowsVersion) {
    setSeen(rowsVersion);
    setOverrides((o) => {
      const keep: Record<string, Override> = {};
      for (const [id, x] of Object.entries(o)) if (x.pending) keep[id] = x;
      return keep;
    });
  }

  const lineOf = useCallback(
    (lead: { id: string; line_type?: LineType | null }): LineType | null =>
      lead.id in overrides ? overrides[lead.id].v : (lead.line_type ?? null),
    [overrides],
  );

  const setLine = useCallback(
    async (leadId: string, v: LineType | null) => {
      setOverrides((o) => ({ ...o, [leadId]: { v, pending: true } }));
      try {
        const res = await fetch(`/api/hitlist/${leadId}/line`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ line_type: v }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `Request failed (${res.status})`);
        }
        setOverrides((o) => (o[leadId]?.v === v ? { ...o, [leadId]: { v, pending: false } } : o));
        syncLeadsNow();
      } catch (e) {
        setOverrides((o) => {
          if (o[leadId]?.v !== v) return o;
          const n = { ...o };
          delete n[leadId];
          return n;
        });
        toast({
          kind: "error",
          title: v ? `Couldn't mark it ${LINE_LABEL[v]}` : "Couldn't clear the line tag",
          body: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [toast],
  );

  return { lineOf, setLine };
}
