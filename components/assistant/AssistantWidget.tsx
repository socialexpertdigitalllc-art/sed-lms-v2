"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { useAssistant } from "@/providers/AssistantProvider";
import { cn } from "@/lib/utils";

/**
 * The floating assistant: a button in the bottom-right corner of every
 * screen that opens a chat in front of whatever the user is looking at.
 *
 * The panel and everything it needs (markdown, charts) load on first open,
 * not with every page — and the button prefetches them on hover, so the
 * first open is still instant. It sits just above the version badge in the
 * same corner, and stays out of the way on the full Assistant page.
 */

const loadPanel = () => import("./AssistantPanel");

const AssistantPanel = dynamic(loadPanel, {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[45] grid place-items-center bg-surface sm:inset-auto sm:bottom-[5.75rem] sm:right-4 sm:h-40 sm:w-[420px] sm:rounded-xl sm:border sm:border-border sm:shadow-2xl">
      <Loader2 className="h-5 w-5 animate-spin text-text-faint" aria-label="Loading" />
    </div>
  ),
});

export function AssistantWidget() {
  const { enabled, name, panelOpen, setPanelOpen } = useAssistant();
  const pathname = usePathname() ?? "";
  // Once opened, the panel stays mounted (hidden when closed) so an answer
  // being written keeps streaming in the background.
  const [mounted, setMounted] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setPanelOpen(false);
    // Hand keyboard focus back to the button that opened the chat — after
    // the re-render, since on a phone it is hidden while the chat is open.
    setTimeout(() => launcherRef.current?.focus(), 0);
  }, [setPanelOpen]);

  if (!enabled) return null;
  const onAssistantPage = pathname === "/assistant" || pathname.startsWith("/assistant/");
  const open = panelOpen && !onAssistantPage;

  return (
    <>
      {mounted || open ? <AssistantPanel hidden={!open} onClose={close} /> : null}
      {onAssistantPage ? null : (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => {
            setMounted(true);
            setPanelOpen(!panelOpen);
          }}
          onPointerEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          // Distinct from the panel's own "Close" so a screen reader never
          // announces two identical buttons.
          aria-label={open ? `Hide ${name}` : `Ask ${name}`}
          aria-expanded={open}
          title={open ? `Hide ${name}` : `Ask ${name}`}
          className={cn(
            "fixed bottom-9 right-3 z-40 grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-lg ring-1 ring-black/5",
            // Darken on hover rather than switch to accent-ink, which turns
            // pale in dark mode and would wash out the white icon.
            "transition-[transform,filter] duration-150 hover:scale-105 hover:brightness-90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            // On a phone the open panel fills the screen and has its own close.
            open && "max-sm:hidden",
          )}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
        </button>
      )}
    </>
  );
}
