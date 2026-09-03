"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDateTime } from "@/lib/leads/format";
import { FuStatusChip } from "./FuStatusChip";

type LastPickup = { comments: string | null; created_at: string };
type LoadState = "idle" | "loading" | "ready" | "error";

/** Long enough that dragging the cursor down the column costs nothing. */
const OPEN_DELAY_MS = 120;
/** Short enough to feel instant, long enough to cross the gap into the card. */
const CLOSE_DELAY_MS = 120;
const CARD_WIDTH = 300;
const GAP = 8;
const EDGE = 8;

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
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState<LastPickup | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The `leadId|version` already fetched — guards the second hover. */
  const loadedKey = useRef<string | null>(null);
  const tipId = useId();

  const key = `${leadId}|${version ?? ""}`;

  // A new lead, or a lead touched since the last fetch, invalidates the cache.
  useEffect(() => {
    if (loadedKey.current === null || loadedKey.current === key) return;
    loadedKey.current = null;
    setState("idle");
    setPickup(null);
  }, [key]);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
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

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  function show(el: HTMLElement) {
    cancelClose();
    setAnchor(el);
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      setOpen(true);
      if (loadedKey.current !== key) void load();
    }, OPEN_DELAY_MS);
  }

  const hide = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  return (
    <>
      <span
        data-fu-chip
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
        className="inline-flex cursor-help rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FuStatusChip status={status} />
      </span>
      {open && anchor && (
        <CommentCard
          id={tipId}
          anchor={anchor}
          isPickup={status === "Pickup"}
          state={state}
          pickup={pickup}
          onMouseEnter={cancelClose}
          onMouseLeave={hide}
        />
      )}
    </>
  );
}

function CommentCard({
  id,
  anchor,
  isPickup,
  state,
  pickup,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  anchor: HTMLElement;
  isPickup: boolean;
  state: LoadState;
  pickup: LastPickup | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    above: boolean;
    arrow: number;
  } | null>(null);

  // The card has to be measured before it can be placed, and it is re-measured
  // whenever the content changes height — the comment landing under the
  // skeleton is exactly that.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const above = rect.top - GAP - h >= EDGE;
    const top = above ? rect.top - GAP - h : rect.bottom + GAP;
    const maxLeft = Math.max(EDGE, window.innerWidth - CARD_WIDTH - EDGE);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - CARD_WIDTH / 2, EDGE), maxLeft);
    const arrow = Math.min(Math.max(rect.left + rect.width / 2 - left, 14), CARD_WIDTH - 14);
    setPos((p) =>
      p && p.top === top && p.left === left && p.above === above && p.arrow === arrow
        ? p
        : { top, left, above, arrow }
    );
  }, [anchor, state, pickup]);

  const comments = pickup?.comments?.trim();
  const above = pos?.above ?? true;

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        width: CARD_WIDTH,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-[60] rounded-lg border border-border bg-surface shadow-xl"
    >
      {/* transparent bridge across the gap, so the pointer can reach the card */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: GAP,
          ...(above ? { bottom: -GAP } : { top: -GAP }),
        }}
      />

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

      {/* caret, pointing back at the pill */}
      <span
        aria-hidden
        style={{ left: pos?.arrow ?? 0, ...(above ? { bottom: -5 } : { top: -5 }) }}
        className={
          "absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-border bg-surface " +
          (above ? "border-b border-r" : "border-l border-t")
        }
      />
    </div>,
    document.body
  );
}
