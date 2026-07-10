"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Returns to the exact page the user came from (preserving its URL/filters) when there is
 *  in-app history; otherwise falls back to `href` (deep link / fresh tab). */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  function onClick() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(href);
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className ?? "text-xs text-text-muted hover:text-text inline-flex items-center gap-1"}
    >
      <ArrowLeft className="w-4 h-4" /> {label}
    </button>
  );
}
