import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page-level heading: display-font title, one-line description, right-aligned action.
 * Shared by the admin / contract screens so every page opens the same way.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-text">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/**
 * Bordered content card with an optional icon/title/count header and footer bar.
 * `flush` drops body padding so the child can be an edge-to-edge list or table.
 */
export function Panel({
  icon: Icon,
  title,
  description,
  count,
  action,
  footer,
  flush,
  className,
  bodyClassName,
  children,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-lg border border-border bg-surface", className)}>
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
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
              </h2>
              {description ? <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </header>
      ) : null}

      <div className={cn("flex-1", flush ? "" : "p-4", bodyClassName)}>{children}</div>

      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-surface-2 px-4 py-3">{footer}</div>
      ) : null}
    </section>
  );
}

/**
 * Empty state with an accent-tinted icon well, a headline, one line of guidance
 * and an optional primary action.
 */
export function EmptyPanel({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
        <Icon className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {hint ? <p className="mx-auto max-w-xs text-xs leading-relaxed text-text-muted">{hint}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export type PillTone = "ready" | "notready" | "dropped" | "accent" | "neutral";

const PILL_TONE: Record<PillTone, string> = {
  ready: "bg-ready-bg text-ready-fg",
  notready: "bg-notready-bg text-notready-fg",
  dropped: "bg-dropped-bg text-dropped-fg",
  accent: "bg-accent-soft text-accent-ink",
  neutral: "bg-surface-2 text-text-muted ring-1 ring-inset ring-border",
};

/** Small status pill with an optional leading icon. */
export function Pill({
  tone = "neutral",
  icon: Icon,
  className,
  children,
}: {
  tone?: PillTone;
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        PILL_TONE[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
      {children}
    </span>
  );
}
