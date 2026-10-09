"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAssistant } from "@/providers/AssistantProvider";
import { cn } from "@/lib/utils";
import { SedAiMark } from "./SedAiMark";

/**
 * The assistant's entry in the top header — "SED Assistant", or whatever this
 * user named it — opening the full Assistant page. Drawn as the SED AI pill:
 * black, with the magenta → blue gradient edge. The floating button in the
 * corner is the quick way in; this is the full workspace.
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
        "sed-ai-surface sed-ai-button inline-flex h-8 items-center justify-center gap-2 rounded-full text-[13px] font-medium",
        "w-8 sm:w-auto sm:pl-3 sm:pr-3.5",
      )}
    >
      <SedAiMark className="h-4 w-4" />
      <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
    </Link>
  );
}
