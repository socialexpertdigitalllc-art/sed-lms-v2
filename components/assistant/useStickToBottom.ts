"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keep a chat scrolled to its newest words while they arrive — unless the
 * user has scrolled up to read, in which case leave them be and offer a way
 * back down. Follows the content's real height (ResizeObserver), so it keeps
 * up with text revealed word by word, charts drawing, anything that grows.
 */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const observerRef = useRef<ResizeObserver | null>(null);

  const follow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Not following (the user is reading): is anything below them now? If
    // it all fits, there is nothing to jump to — follow again.
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near);
    if (near) stickRef.current = true;
  }, []);

  /** Attach to the element inside the scroller that holds the messages. */
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(follow);
      ro.observe(node);
      observerRef.current = ro;
    },
    [follow],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = near;
    setAtBottom(near);
  }, []);

  /**
   * Stop following until the user is back at the bottom — for when they open
   * something in the thread (a "Worked for…" line) and want to read it rather
   * than be carried past it. Attach to the scroller's onClickCapture.
   */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // Whether the jump button is needed is decided once the content has
    // actually changed size (see follow).
    if ((e.target as HTMLElement).closest("button[aria-expanded]")) stickRef.current = false;
  }, []);

  /** Jump to the newest message and keep following from there. */
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    stickRef.current = true;
    setAtBottom(true);
    if (!el) return;
    if (smooth && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  return { scrollRef, contentRef, onScroll, onClickCapture, atBottom, scrollToBottom, follow };
}
