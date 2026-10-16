"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** Long enough that dragging the cursor down a column costs nothing. */
const OPEN_DELAY_MS = 120;
/** Short enough to feel instant, long enough to cross the gap into the card. */
const CLOSE_DELAY_MS = 120;
const GAP = 8;
const EDGE = 8;

/**
 * Hover/focus intent for a small trigger with a card behind it (the leads
 * table's pills). `onOpen` runs when the card actually opens, after the delay
 * — the place to start a lazy fetch.
 */
export function useHoverCard(onOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOpenRef = useRef(onOpen);
  const id = useId();

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const show = useCallback(
    (el: HTMLElement) => {
      cancelClose();
      setAnchor(el);
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => {
        setOpen(true);
        onOpenRef.current?.();
      }, OPEN_DELAY_MS);
    },
    [cancelClose]
  );

  const hide = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  /** Spread onto the trigger. */
  const triggerProps = {
    tabIndex: 0,
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: MouseEvent<HTMLElement>) => show(e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => show(e.currentTarget),
    onBlur: hide,
  };

  return { open, anchor, id, triggerProps, cancelClose, hide };
}

/**
 * The card itself: portalled, fixed, placed above the anchor when it fits and
 * below otherwise, with a caret pointing back at it. `measureKey` should change
 * whenever the content can change height (a fetch landing) so it is re-placed.
 */
export function HoverCardPanel({
  id,
  anchor,
  width,
  measureKey,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  id: string;
  anchor: HTMLElement;
  width: number;
  measureKey?: unknown;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean; arrow: number } | null>(null);

  // The card has to be measured before it can be placed, and it is re-measured
  // whenever the content changes height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const above = rect.top - GAP - h >= EDGE;
    const top = above ? rect.top - GAP - h : rect.bottom + GAP;
    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE), maxLeft);
    const arrow = Math.min(Math.max(rect.left + rect.width / 2 - left, 14), width - 14);
    setPos((p) =>
      p && p.top === top && p.left === left && p.above === above && p.arrow === arrow
        ? p
        : { top, left, above, arrow }
    );
  }, [anchor, width, measureKey]);

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
        width,
        maxWidth: `calc(100vw - ${EDGE * 2}px)`,
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
      {children}
      {/* caret, pointing back at the trigger */}
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
