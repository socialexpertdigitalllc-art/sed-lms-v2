"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import type { ProactiveSuggestion } from "@/lib/assistant/proactive";
import { cn } from "@/lib/utils";

/**
 * "SED AI noticed…": a few things it could do for the person right now, each
 * one tap away (sent in Act mode — it still asks before changing anything).
 */
export function ProactiveSuggestions({ onPick, compact = false }: { onPick: (prompt: string) => void; compact?: boolean }) {
  const [items, setItems] = useState<ProactiveSuggestion[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/assistant/proactive", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { suggestions?: ProactiveSuggestion[] }) => alive && setItems(b.suggestions ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className={cn("mb-4", compact ? "space-y-1.5" : "grid gap-2 sm:grid-cols-2")}>
      <p className={cn("text-[11px] font-semibold uppercase tracking-wide text-accent-ink", !compact && "sm:col-span-2")}>I can take care of</p>
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.prompt)}
          className="flex w-full items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft"
        >
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-text">{s.title}</span>
            <span className="block text-xs text-text-muted">{s.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
