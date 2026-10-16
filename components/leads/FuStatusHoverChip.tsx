"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/lib/leads/format";
import { HoverCardPanel, useHoverCard } from "@/components/common/HoverCard";
import { FuStatusChip } from "./FuStatusChip";

type LastPickup = { comments: string | null; created_at: string };
type LoadState = "idle" | "loading" | "ready" | "error";

const CARD_WIDTH = 300;

/**
 * The follow-up pill, plus the comment behind it on hover.
 *
 * Comments only ever live on a PICKUP — the follow-up API nulls them for
 * "No Pickup" — so both pills read the same row: a Pickup pill is showing its
 * own comment, a No Pickup pill is showing the last thing the client actually
 * said, dated so a stale note is obvious.
 */
export function FuStatusHoverChip({
  leadId,
  status,
  version,
}: {
  leadId: string;
  status: string;
  /**
   * The lead's `updated_at`. Logging a follow-up bumps it (trg_leads_touch),
   * which is the only signal a still-mounted row gets that its cached comment
   * went stale — a refreshed table re-renders these rows, it does not remount
   * them.
   */
  version?: string | null;
}) {
  const [pickup, setPickup] = useState<LastPickup | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  /** The `leadId|version` already fetched — guards the second hover. */
  const loadedKey = useRef<string | null>(null);

  const key = `${leadId}|${version ?? ""}`;

  // A new lead, or a lead touched since the last fetch, invalidates the cache.
  useEffect(() => {
    if (loadedKey.current === null || loadedKey.current === key) return;
    loadedKey.current = null;
    setState("idle");
    setPickup(null);
  }, [key]);

  const load = useCallback(async () => {
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setState("loading");
    try {
      const res = await fetch(`/api/leads/${leadId}/follow-ups/last-pickup`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setPickup((json?.pickup ?? null) as LastPickup | null);
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
        data-fu-chip
        {...card.triggerProps}
        className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FuStatusChip status={status} />
      </span>
      {card.open && card.anchor && (
        <HoverCardPanel
          id={card.id}
          anchor={card.anchor}
          width={CARD_WIDTH}
          measureKey={`${state}|${pickup?.created_at ?? ""}`}
          onMouseEnter={card.cancelClose}
          onMouseLeave={card.hide}
        >
          <CommentBody isPickup={status === "Pickup"} state={state} pickup={pickup} />
        </HoverCardPanel>
      )}
    </>
  );
}

function CommentBody({
  isPickup,
  state,
  pickup,
}: {
  isPickup: boolean;
  state: LoadState;
  pickup: LastPickup | null;
}) {
  const comments = pickup?.comments?.trim();
  return (
    <>
      <div className="flex items-baseline justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">
          {isPickup ? "Last follow-up" : "Last pickup comments"}
        </span>
        {pickup && (
          <span
            data-testid="fu-tooltip-date"
            className="whitespace-nowrap font-mono text-[11px] text-text-muted"
          >
            {formatDateTime(pickup.created_at)}
          </span>
        )}
      </div>

      <div className="px-3 py-2.5">
        {state === "idle" || state === "loading" ? (
          <div className="space-y-1.5" aria-hidden>
            <div className="h-2.5 w-full rounded bg-border-subtle" />
            <div className="h-2.5 w-2/3 rounded bg-border-subtle" />
          </div>
        ) : state === "error" ? (
          <p className="text-xs text-dropped-fg">Couldn&apos;t load the comments.</p>
        ) : comments ? (
          <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-text">
            {comments}
          </p>
        ) : (
          <p className="text-xs italic text-text-faint">
            {pickup || isPickup ? "No comments recorded." : "No pickup logged yet."}
          </p>
        )}
      </div>
    </>
  );
}
