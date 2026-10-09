"use client";

import { CalendarClock, Clock, MessageSquareText, PhoneCall, PieChart, Target, Ticket, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Starter questions for an empty chat, each with an icon for what it is about. */

const ICONS: [RegExp, LucideIcon][] = [
  [/remember/i, Target],
  [/compar|how am i doing|pipeline doing/i, TrendingUp],
  [/called first|call first/i, PhoneCall],
  [/time of day|picked up/i, Clock],
  [/categor|close best/i, PieChart],
  [/agents|team/i, Users],
  [/late|hours/i, CalendarClock],
  [/ticket/i, Ticket],
];

export function suggestionIcon(text: string): LucideIcon {
  return ICONS.find(([re]) => re.test(text))?.[1] ?? MessageSquareText;
}

export function Suggestions({ items, onPick, layout }: { items: string[]; onPick: (text: string) => void; layout: "grid" | "list" }) {
  return (
    <div className={cn(layout === "grid" ? "grid gap-2 sm:grid-cols-2" : "space-y-1.5")}>
      {items.map((s) => {
        const Icon = suggestionIcon(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "flex w-full items-start gap-2.5 border border-border bg-surface text-left text-text-muted transition-colors hover:bg-surface-2 hover:text-text",
              layout === "grid" ? "rounded-2xl px-3.5 py-3 text-[13px]" : "rounded-xl px-3 py-2.5 text-[13px]",
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            <span className="min-w-0">{s}</span>
          </button>
        );
      })}
    </div>
  );
}
