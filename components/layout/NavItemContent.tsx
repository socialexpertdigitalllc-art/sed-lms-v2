"use client";

import { useLinkStatus } from "next/link";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavCountTone } from "@/lib/nav/counts";

/**
 * Inner content of a sidebar nav row. MUST render inside a `<Link>` so
 * `useLinkStatus` can report this link's navigation state — that gives the
 * instant per-item spinner the moment a link is clicked (the fix for users
 * clicking a slow nav link again and again).
 *
 * Expanded: icon + label + a trailing slot that shows a spinner while
 * navigating, otherwise a count badge (when count > 0). Collapsed rail: just
 * the icon, with a corner dot for a non-zero count and a corner spinner while
 * navigating.
 */
export function NavItemContent({
  icon: Icon,
  label,
  count,
  showLabels,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  showLabels: boolean;
  tone?: NavCountTone;
}) {
  const { pending } = useLinkStatus();
  const hasCount = typeof count === "number" && count > 0;

  if (!showLabels) {
    return (
      <span className="relative inline-flex">
        <Icon className="w-[18px] h-[18px] shrink-0" />
        {pending ? (
          <Loader2 className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 animate-spin text-text-muted" />
        ) : hasCount ? (
          <span
            className={cn(
              "absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-surface-2",
              tone === "alert" ? "bg-dropped-fg" : "bg-accent"
            )}
          />
        ) : null}
      </span>
    );
  }

  return (
    <>
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span className="truncate">{label}</span>
      {pending ? (
        <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin shrink-0 text-text-muted" />
      ) : hasCount ? (
        <span
          className={cn(
            "ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-full leading-none",
            tone === "alert" ? "bg-dropped-bg text-dropped-fg" : "bg-surface-2 text-text-muted"
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
}
