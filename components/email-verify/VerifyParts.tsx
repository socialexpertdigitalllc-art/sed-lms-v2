"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL } from "@/lib/email-verify/labels";
import type { ProviderName, Verdict } from "@/lib/email-verify/types";

/** Icon + token set for each verdict, so every surface reads identically. */
export const VERDICT_STYLE: Record<
  Verdict,
  { icon: typeof CheckCircle2; fg: string; bg: string; ring: string }
> = {
  OK: { icon: CheckCircle2, fg: "text-ready-fg", bg: "bg-ready-bg", ring: "ring-ready-fg/20" },
  WARN: { icon: AlertTriangle, fg: "text-notready-fg", bg: "bg-notready-bg", ring: "ring-notready-fg/20" },
  BLOCK: { icon: XCircle, fg: "text-dropped-fg", bg: "bg-dropped-bg", ring: "ring-dropped-fg/20" },
};

/**
 * The typo suggestion, as a chip the user clicks to accept. Never auto-applied —
 * "did you mean" is a question, and guessing wrong silently loses a real lead.
 */
export function SuggestionChip({
  suggestion,
  onAccept,
  className,
}: {
  suggestion: string;
  onAccept: (value: string) => void;
  className?: string;
}) {
  return (
    <p className={cn("flex flex-wrap items-center gap-1.5 text-xs text-text-muted", className)}>
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <span>Did you mean</span>
      <button
        type="button"
        onClick={() => onAccept(suggestion)}
        title={`Use ${suggestion}`}
        className={cn(
          "tabular rounded-full border border-accent bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-medium text-accent-ink",
          "transition-colors duration-150 hover:bg-accent hover:text-white",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        {suggestion}
      </button>
      <span>?</span>
    </p>
  );
}

/** Copy-to-clipboard control with a two-second confirmation. */
export function CopyButton({
  value,
  label = "Copy address",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* Clipboard denied (insecure context / permission) — stay silent. */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent",
        "text-text-muted transition-colors duration-150 hover:border-border hover:bg-surface-2 hover:text-text",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      {copied ? <Check className="h-4 w-4 text-ready-fg" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** Small "Deep verify" action — one click, one provider credit. */
export function DeepVerifyButton({
  onClick,
  busy,
  disabled,
  compact,
  done,
  className,
}: {
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  compact?: boolean;
  /** A provider has already answered for this address. */
  done?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={
        done
          ? "A mail provider has already answered for this address"
          : "Ask a mail-verification provider — uses one credit"
      }
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface font-medium text-text",
        "transition-colors duration-150 hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-55",
        compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn("shrink-0 animate-spin", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      ) : (
        <Sparkles className={cn("shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      )}
      {busy ? "Verifying…" : done ? "Verify again" : "Deep verify"}
    </button>
  );
}

/** Footnote line: who answered, whether it was cached, and when. */
export function ResultFootnotes({
  provider,
  cached,
  verifiedAt,
  className,
}: {
  provider: ProviderName | null;
  cached: boolean;
  verifiedAt: string;
  className?: string;
}) {
  const when = new Date(verifiedAt);
  const stamp = Number.isNaN(when.getTime())
    ? "—"
    : when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <dl className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-faint", className)}>
      <div className="flex items-center gap-1">
        <dt className="sr-only">Source</dt>
        <dd>{provider ? `Verified by ${PROVIDER_LABEL[provider]}` : "Local checks only"}</dd>
      </div>
      <span aria-hidden className="text-border">
        ·
      </span>
      <div className="flex items-center gap-1">
        <dt className="sr-only">Freshness</dt>
        <dd>{cached ? "Cached result" : "Checked just now"}</dd>
      </div>
      <span aria-hidden className="text-border">
        ·
      </span>
      <div className="flex items-center gap-1">
        <dt className="sr-only">Verified at</dt>
        <dd className="tabular font-mono">{stamp}</dd>
      </div>
    </dl>
  );
}
