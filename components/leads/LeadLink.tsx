"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps } from "react";

/** How long the pointer must rest on a lead before its page is fetched ahead. */
export const LEAD_PREFETCH_INTENT_MS = 120;

/**
 * A link to a lead page that starts loading the FULL page as soon as the
 * person shows intent (pointer resting on it, keyboard focus, or the press
 * itself), so by the time the click lands the page is usually already here.
 * A plain Link only fetches dynamic pages up to their loading screen.
 *
 * Intent, not visibility: fetching every lead row in view would cost one full
 * page render per row for leads nobody opens.
 */
export function LeadLink({ onMouseEnter, onMouseLeave, onFocus, onPointerDown, href, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);
  const url = typeof href === "string" ? href : String(href.pathname ?? "");
  const go = () => {
    if (done.current || !url) return;
    done.current = true;
    router.prefetch(url);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <Link
      href={href}
      {...rest}
      onMouseEnter={(e) => {
        cancel();
        timer.current = setTimeout(go, LEAD_PREFETCH_INTENT_MS);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        cancel();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        go();
        onFocus?.(e);
      }}
      onPointerDown={(e) => {
        go();
        onPointerDown?.(e);
      }}
    />
  );
}
