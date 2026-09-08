"use client";

import { useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact, collapsed-by-default card for the lead page's right-column action
 * sections. ONE header line: disclosure chevron, icon, title (never
 * truncated — titles are short by contract), count, a truncating one-line
 * summary filling the middle, and the primary action button pinned right.
 * Expanding reveals the history below.
 *
 * Deliberately no persistence: sections start closed on every visit, per the
 * operator's request.
 */
export function CollapsibleCard({
  icon: Icon,
  title,
  count,
  summary,
  action,
  defaultOpen = false,
  flush,
  className,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  count?: number;
  /** One-line status, e.g. "sent · 12 Aug", "2 open". Truncates first when space is tight. */
  summary?: React.ReactNode;
  /** Right-pinned control (the New … button). Clicks here never toggle. */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  /** Drop body padding so the child can be an edge-to-edge list (Panel's flush). */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex min-h-10 items-center gap-2 py-1.5 pl-2.5 pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 text-text-faint transition-transform", open && "rotate-90")}
          />
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-accent-ink" /> : null}
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-text">{title}</span>
          {typeof count === "number" ? (
            <span className="tabular shrink-0 font-mono text-[11px] leading-none text-text-muted">{count}</span>
          ) : null}
          {summary ? (
            <span className="min-w-0 truncate text-[11px] text-text-faint">
              <span className="mx-0.5">·</span> {summary}
            </span>
          ) : null}
        </button>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </div>
      {open ? <div className={cn("border-t border-border-subtle", flush ? "" : "p-3")}>{children}</div> : null}
    </section>
  );
}
