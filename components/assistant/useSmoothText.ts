"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Streamed text, revealed at an even pace. Models send words in uneven
 * bursts — a sentence at once, then nothing — and drawing each burst as it
 * lands makes an answer lurch. While `live`, this releases the text a few
 * characters per frame, faster the further behind it is, so it never lags
 * more than a fraction of a second; once the answer is finished it shows
 * everything at once.
 */
export function useSmoothText(target: string, live: boolean): string {
  const [shown, setShown] = useState(target);
  /** How much of the text has been revealed. */
  const revealedRef = useRef(target);
  /** The last value handed to React, so a frame with no change costs nothing. */
  const renderedRef = useRef(target);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
    // A finished answer is shown whole; picking up again starts from there.
    if (!live) revealedRef.current = target;
  }, [target, live]);

  useEffect(() => {
    if (!live) return;
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    const publish = (value: string) => {
      if (value !== renderedRef.current) {
        renderedRef.current = value;
        setShown(value);
      }
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // No animation: follow the text as it arrives.
      const id = window.setInterval(() => {
        revealedRef.current = targetRef.current;
        publish(targetRef.current);
      }, 100);
      return () => window.clearInterval(id);
    }
    let frame = 0;
    const tick = () => {
      const goal = targetRef.current;
      let current = revealedRef.current;
      if (!goal.startsWith(current)) {
        // The text was rewound (a retried round): continue from what is shared.
        let i = 0;
        while (i < current.length && i < goal.length && current[i] === goal[i]) i++;
        current = goal.slice(0, i);
      }
      const behind = goal.length - current.length;
      if (behind > 0) current = goal.slice(0, current.length + Math.max(2, Math.ceil(behind / 10)));
      revealedRef.current = current;
      publish(current);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [live]);

  // Without animation frames (old browsers, the server) there is nothing to pace with.
  const canAnimate = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
  return live && canAnimate ? shown : target;
}
