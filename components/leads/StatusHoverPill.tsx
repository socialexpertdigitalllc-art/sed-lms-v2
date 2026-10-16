"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HoverCardPanel, useHoverCard } from "@/components/common/HoverCard";
import { formatDateTimeLong } from "@/lib/leads/format";
import { currentStatusSince, statusSummary, type StatusHistory } from "@/lib/leads/statusHistory";
import { StatusPill } from "./StatusPill";
import { StatusTimeline } from "./StatusTimeline";

type LoadState = "idle" | "loading" | "ready" | "error";

const CARD_WIDTH = 320;

/**
 * The leads table's status pill, plus WHEN on hover: since when the lead has
 * been in this status, when it was submitted and the changes in between —
 * fetched on first hover, like the follow-up pill's comment.
 */
export function StatusHoverPill({
  leadId,
  status,
  version,
}: {
  leadId: string;
  status: string;
  /**
   * The lead's `updated_at`. A status change (and a corrected Closed/Dropped
   * date) bumps it, so a still-mounted row knows its cached history is stale.
   */
  version?: string | null;
}) {
  const [history, setHistory] = useState<StatusHistory | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const loadedKey = useRef<string | null>(null);
  const key = `${leadId}|${status}|${version ?? ""}`;

  useEffect(() => {
    if (loadedKey.current === null || loadedKey.current === key) return;
    loadedKey.current = null;
    setState("idle");
    setHistory(null);
  }, [key]);

  const load = useCallback(async () => {
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setState("loading");
    try {
      const res = await fetch(`/api/leads/${leadId}/status-history`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setHistory((json?.history ?? null) as StatusHistory | null);
      setState("ready");
    } catch {
      loadedKey.current = null;
      setState("error");
    }
  }, [key, leadId]);

  const card = useHoverCard(() => void load());

  return (
    <>
      <span
        data-status-chip
        {...card.triggerProps}
        className="inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <StatusPill status={status} />
      </span>
      {card.open && card.anchor && (
        <HoverCardPanel
          id={card.id}
          anchor={card.anchor}
          width={CARD_WIDTH}
          measureKey={`${state}|${history?.events.length ?? 0}`}
          onMouseEnter={card.cancelClose}
          onMouseLeave={card.hide}
        >
          <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{status} since</span>
            {history && (
              <span data-testid="status-since" className="whitespace-nowrap font-mono text-[11px] text-text">
                {formatDateTimeLong(currentStatusSince(history))}
              </span>
            )}
          </div>
          <div className="px-3 py-2.5">
            {state === "idle" || state === "loading" ? (
              <div className="space-y-1.5" aria-hidden>
                <div className="h-2.5 w-full rounded bg-border-subtle" />
                <div className="h-2.5 w-2/3 rounded bg-border-subtle" />
              </div>
            ) : state === "error" || !history ? (
              <p className="text-xs text-dropped-fg">Couldn&apos;t load the status history.</p>
            ) : (
              <StatusTimeline history={history} compact />
            )}
          </div>
          {history && state === "ready" && (
            <div className="border-t border-border-subtle px-3 py-2 text-[11px] text-text-muted">
              {statusSummary(history, new Date())}
            </div>
          )}
        </HoverCardPanel>
      )}
    </>
  );
}
