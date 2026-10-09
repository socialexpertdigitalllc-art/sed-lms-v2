"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { useAssistant } from "@/providers/AssistantProvider";
import { cn } from "@/lib/utils";
import { SedAiMark } from "./SedAiMark";

/**
 * The floating assistant: a button in the bottom-right corner of every
 * screen that opens a chat in front of whatever the user is looking at.
 * Ctrl+J (⌘J on a Mac) opens and closes it from anywhere — and on the full
 * Assistant page puts the cursor in the message box instead.
 *
 * The panel and everything it needs (markdown, charts) load on first open,
 * not with every page — and the button prefetches them on hover, so the
 * first open is still instant. It sits just above the version badge in the
 * same corner, and stays out of the way on the full Assistant page.
 */

const loadPanel = () => import("./AssistantPanel");

// The shortcut's label: ⌘J on Apple devices, Ctrl+J elsewhere. Read without
// a hydration mismatch — the server (and the first paint) say Ctrl+J.
const noSubscription = () => () => {};
const onApple = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const AssistantPanel = dynamic(loadPanel, {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[45] grid place-items-center bg-surface sm:inset-auto sm:bottom-[5.75rem] sm:right-4 sm:h-40 sm:w-[420px] sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl">
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
  const shortcut = useSyncExternalStore(noSubscription, onApple, () => false) ? "⌘J" : "Ctrl+J";
  const launcherRef = useRef<HTMLButtonElement>(null);
  const onAssistantPage = pathname === "/assistant" || pathname.startsWith("/assistant/");
  const open = panelOpen && !onAssistantPage;

  const close = useCallback(() => {
    setPanelOpen(false);
    // Hand keyboard focus back to the button that opened the chat — after
    // the re-render, since on a phone it is hidden while the chat is open.
    setTimeout(() => launcherRef.current?.focus(), 0);
  }, [setPanelOpen]);

  // Read by the shortcut without re-binding it on every change.
  const stateRef = useRef({ open, onAssistantPage });
  useEffect(() => {
    stateRef.current = { open, onAssistantPage };
  }, [open, onAssistantPage]);

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "j") return;
      e.preventDefault();
      const { open: isOpen, onAssistantPage: onPage } = stateRef.current;
      if (onPage) {
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the assistant"]')?.focus();
        return;
      }
      if (isOpen) close();
      else {
        setMounted(true);
        setPanelOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, close, setPanelOpen]);

  if (!enabled) return null;

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
          aria-keyshortcuts="Control+J Meta+J"
          title={open ? `Hide ${name} (${shortcut})` : `Ask ${name} (${shortcut})`}
          className={cn(
            "sed-ai-surface sed-ai-button fixed bottom-9 right-3 z-40 grid h-12 w-12 place-items-center rounded-full shadow-lg",
            "hover:scale-105 active:scale-95",
            // On a phone the open panel fills the screen and has its own close.
            open && "max-sm:hidden",
          )}
        >
          {open ? <ChevronDown className="h-5 w-5" aria-hidden /> : <SedAiMark className="h-5 w-5" />}
        </button>
      )}
    </>
  );
}
