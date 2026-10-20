"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, FastForward, Hand, Zap } from "lucide-react";
import type { PermissionMode } from "@/lib/assistant/actions/permissions";
import { cn } from "@/lib/utils";
import type { ActPermissionsView } from "./useActPermissions";

/**
 * Act's permission mode, next to the Ask / Act switch: how much SED AI does
 * without a click. Like Claude Code's permission modes — ask first, or let
 * changes run on their own — within the limit the company set.
 */

export const MODE_ICON: Record<PermissionMode, typeof Hand> = { ask: Hand, auto_safe: Zap, auto: FastForward };

export function PermissionModePicker({
  view,
  onChange,
  compact,
}: {
  view: ActPermissionsView;
  onChange: (mode: PermissionMode) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = view.modes.find((m) => m.mode === view.effective) ?? view.modes[0];
  const Icon = MODE_ICON[current.mode];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${current.label}: ${current.description}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
          current.mode === "ask"
            ? "border-border text-text-muted hover:text-text"
            : current.mode === "auto_safe"
              ? "border-accent/40 bg-accent-soft text-accent-ink"
              : "border-notready-fg/30 bg-notready-bg text-notready-fg",
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {current.short}
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Permission mode"
          className={cn(
            "absolute bottom-full left-0 z-30 mb-1.5 rounded-xl border border-border bg-surface p-1.5 shadow-lg",
            compact ? "w-[min(18rem,calc(100vw-2rem))]" : "w-[min(21rem,calc(100vw-2rem))]",
          )}
        >
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">Permission mode</p>
          {view.modes.map((m) => {
            const MIcon = MODE_ICON[m.mode];
            const selected = m.mode === view.effective;
            return (
              <button
                key={m.mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={!m.allowed}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(m.mode);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  selected ? "bg-surface-2" : "hover:bg-surface-2",
                  !m.allowed && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <MIcon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", m.mode === "ask" ? "text-text-muted" : m.mode === "auto_safe" ? "text-accent" : "text-notready-fg")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text">{m.label}</span>
                  <span className="block text-xs leading-snug text-text-muted">{m.allowed ? m.description : "Your admin has limited SED AI below this."}</span>
                </span>
                {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
              </button>
            );
          })}
          <div className="mt-1 flex items-center justify-between border-t border-border-subtle px-2 pb-0.5 pt-1.5 text-[11px] text-text-faint">
            <span>High-impact changes always ask.</span>
            <Link href="/assistant/actions?tab=permissions" className="font-medium text-accent-ink hover:underline">
              Manage{view.allow.length ? ` (${view.allow.length} always allowed)` : ""}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
