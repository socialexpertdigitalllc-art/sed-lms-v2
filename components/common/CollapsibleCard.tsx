"use client";

import { useState } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Panel-look card whose body is COLLAPSED by default — the lead page's
 * right-column action sections use it so the page stays short: the header
 * always shows the name, count, a one-line status summary and the primary
 * action button; history only renders once the user expands.
 *
 * The whole header row toggles except the `action` area (buttons there must
 * stay one-click). Deliberately no persistence: sections start closed on
 * every visit, per the operator's request.
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
  /** One-line "last activity" line shown under the title while collapsed (and kept when open). */
  summary?: React.ReactNode;
  /** Right-aligned controls (e.g. the New … button). Clicks here never toggle. */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  /** Drop body padding so the child can be an edge-to-edge list (Panel's flush). */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={cn("flex flex-col overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <header className={cn("flex items-start justify-between gap-3 px-4 py-3", open && "border-b border-border-subtle")}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          {Icon ? (
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-sm font-semibold leading-tight text-text">
              <span className="truncate">{title}</span>
              {typeof count === "number" ? (
                <span className="tabular shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-normal text-text-muted">
                  {count}
                </span>
              ) : null}
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-faint transition-transform", open ? "" : "-rotate-90")} />
            </h2>
            {summary ? <p className="mt-0.5 truncate text-xs leading-relaxed text-text-muted">{summary}</p> : null}
          </div>
        </button>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      {open ? <div className={cn(flush ? "" : "p-4")}>{children}</div> : null}
    </section>
  );
}
