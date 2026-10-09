"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useAssistant } from "@/providers/AssistantProvider";
import { cn } from "@/lib/utils";

/**
 * The assistant's entry in the top header — "SED Assistant", or whatever this
 * user named it — opening the full Assistant page. The floating button in
 * the corner is the quick way in; this is the full workspace.
 */
export function AssistantHeaderButton() {
  const { enabled, name } = useAssistant();
  const pathname = usePathname() ?? "";
  if (!enabled) return null;
  const active = pathname === "/assistant" || pathname.startsWith("/assistant/");
  return (
    <Link
      href="/assistant"
      title={`Open ${name}`}
      aria-label={`Open ${name}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors",
        active ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      <Sparkles className="h-[18px] w-[18px] text-accent" aria-hidden />
      <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
    </Link>
  );
}
