"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Formatting helpers (presentation only)                              */
/* ------------------------------------------------------------------ */

/** Split `Display Name <user@host>` into its parts; tolerant of bare addresses. */
export function parseAddress(raw: string): { name: string; email: string } {
  const value = (raw ?? "").trim();
  if (!value) return { name: "", email: "" };
  const m = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || m[2], email: m[2] };
  }
  return { name: value, email: value.includes("@") ? value : "" };
}

/** One or two letters for the avatar chip. */
export function initials(raw: string): string {
  const { name } = parseAddress(raw);
  const words = name.replace(/[^\p{L}\p{N}\s.@-]/gu, " ").split(/[\s.@-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Compact, list-friendly date: time today, `12 Mar` this year, `12 Mar 24` beyond. */
export function listDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

export function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/* ------------------------------------------------------------------ */
/* Presentational atoms                                                */
/* ------------------------------------------------------------------ */

export function Avatar({ from, size = "sm" }: { from: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 inline-flex items-center justify-center rounded-md bg-accent-soft font-medium text-accent-ink select-none",
        size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs",
      )}
    >
      {initials(from)}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("h-full flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
        <Icon className="h-4 w-4 text-accent-ink" />
      </span>
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 max-w-[26rem] text-xs leading-relaxed text-text-faint">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Placeholder rows matching the real list rhythm — no layout shift on load. */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-subtle" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-start gap-3 px-3 py-3">
          <div className="h-7 w-7 shrink-0 rounded-md bg-border-subtle" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-3 rounded-sm bg-border-subtle" style={{ width: `${38 + ((i * 7) % 22)}%` }} />
              <div className="ml-auto h-2.5 w-8 rounded-sm bg-border-subtle" />
            </div>
            <div className="h-3 rounded-sm bg-border-subtle" style={{ width: `${58 + ((i * 11) % 26)}%` }} />
            <div className="h-2.5 rounded-sm bg-border-subtle" style={{ width: `${44 + ((i * 13) % 34)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReaderSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6" aria-hidden>
      <div className="space-y-3">
        <div className="h-5 w-2/3 rounded-sm bg-border-subtle" />
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-border-subtle" />
          <div className="space-y-1.5">
            <div className="h-3 w-40 rounded-sm bg-border-subtle" />
            <div className="h-2.5 w-56 rounded-sm bg-border-subtle" />
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {[92, 84, 96, 70, 88, 60].map((w, i) => (
          <div key={i} className="h-3 rounded-sm bg-border-subtle" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
