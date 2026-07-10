"use client";
import { formatRelative, formatDateTime } from "@/lib/leads/format";
/** Relative label with the absolute date/time in the title tooltip. */
export function RelativeTime({ iso, className = "" }: { iso: string | null | undefined; className?: string }) {
  return <span className={className} title={formatDateTime(iso)}>{formatRelative(iso)}</span>;
}
