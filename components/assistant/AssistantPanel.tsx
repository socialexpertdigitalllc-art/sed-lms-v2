"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, Loader2, Maximize2, MessageSquare, Pencil, Sparkles, SquarePen, X } from "lucide-react";
import { useAssistant } from "@/providers/AssistantProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { suggestionsFor } from "@/lib/assistant/suggestions";
import type { ClientConversation } from "@/lib/assistant/view";
import { iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { NameAssistant } from "./NameAssistant";
import { TurnView } from "./TurnView";
import { useAssistantChat } from "./useAssistantChat";

/**
 * The floating chat: the assistant in front of whatever page the user is on.
 *
 * Loaded on demand (see AssistantWidget) and kept mounted once opened, so an
 * answer keeps streaming while the panel is closed and is there when it is
 * reopened. Remembers the open conversation per user in localStorage, so it
 * picks up where they left off after a reload.
 */

const storageKey = (userId: string) => `sed-assistant:open-chat:${userId}`;

function readStored(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeStored(userId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(storageKey(userId), id);
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage blocked — the panel simply starts fresh next time */
  }
}

function sortConversations(list: ClientConversation[]): ClientConversation[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last_message_at.localeCompare(a.last_message_at));
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function AssistantPanel({ hidden, onClose }: { hidden: boolean; onClose: () => void }) {
  const { name, named, userId, displayName } = useAssistant();
  const { all: perms } = usePermissions();
  const { toast } = useToast();
  const [view, setView] = useState<"chat" | "history" | "rename">("chat");
  const [history, setHistory] = useState<ClientConversation[] | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const chat = useAssistantChat({
    onActiveChange: (id) => writeStored(userId, id),
    onConversation: (c) => setHistory((prev) => (prev ? sortConversations([c, ...prev.filter((x) => x.id !== c.id)]) : prev)),
    onOpenError: (_id, e) => {
      if (e.status !== 404) toast({ kind: "error", title: "Could not open the chat", body: e.message });
    },
  });
  const { select, shown } = chat;

  // Pick up the chat that was open last time — once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !named) return;
    restored.current = true;
    const id = readStored(userId);
    if (id) select(id);
  }, [named, userId, select]);

  // Keep the newest words in view — unless the user scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [shown, hidden, view]);

  // Reopening puts the cursor back in the message box.
  useEffect(() => {
    if (!hidden && view === "chat") panelRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [hidden, view]);

  async function openHistory() {
    setView("history");
    try {
      const res = await fetch("/api/assistant/conversations", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { conversations?: ClientConversation[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setHistory(body.conversations ?? []);
    } catch (e) {
      toast({ kind: "error", title: "Could not load your chats", body: (e as Error).message });
      setHistory([]);
    }
  }

  const firstName = displayName.split(/\s+/)[0] || "there";
  const suggestions = suggestionsFor(perms).slice(0, 4);
  const expandHref = chat.activeId ? `/assistant?c=${chat.activeId}` : "/assistant";
  const lastIndex = shown.length - 1;

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`${name} chat`}
      // The attribute, not a class: Tailwind's preflight hides [hidden] with
      // !important, so it beats `flex`, and it takes the closed chat out of
      // the accessibility tree too.
      hidden={hidden}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className={cn(
        // Above the version badge in the same corner (z-40), below modals (z-50).
        "fixed z-[45] flex flex-col overflow-hidden border-border bg-surface shadow-2xl",
        "inset-0 sm:inset-auto sm:bottom-[5.75rem] sm:right-4 sm:h-[min(680px,calc(100dvh-7.5rem))] sm:w-[420px] sm:rounded-xl sm:border",
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border pl-2 pr-1.5">
        {view === "chat" ? (
          <div className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white" aria-hidden>
            <Sparkles className="h-3.5 w-3.5" />
          </div>
        ) : (
          <button type="button" className={iconBtn} onClick={() => setView("chat")} aria-label="Back to the chat" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 pl-1.5">
          {view === "chat" && named ? (
            <button
              type="button"
              onClick={() => setView("rename")}
              className="group flex max-w-full items-center gap-1 rounded text-left"
              title={`Rename ${name}`}
            >
              <span className="truncate text-sm font-semibold text-text">{name}</span>
              <Pencil className="h-3 w-3 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </button>
          ) : (
            <p className="truncate text-sm font-semibold text-text">{view === "history" ? "Your chats" : name}</p>
          )}
        </div>
        {named && view === "chat" ? (
          <>
            <button type="button" className={iconBtn} onClick={() => void openHistory()} aria-label="Your chats" title="Your chats">
              <History className="h-4 w-4" />
            </button>
            <button type="button" className={iconBtn} onClick={chat.newChat} aria-label="New chat" title="New chat">
              <SquarePen className="h-4 w-4" />
            </button>
            <Link href={expandHref} className={iconBtn} onClick={onClose} aria-label="Open full screen" title="Open full screen">
              <Maximize2 className="h-4 w-4" />
            </Link>
          </>
        ) : null}
        <button type="button" className={iconBtn} onClick={onClose} aria-label={`Close ${name}`} title="Close">
          <X className="h-4 w-4" />
        </button>
      </header>

      {!named || view === "rename" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NameAssistant mode={named ? "rename" : "first"} compact onDone={() => setView("chat")} />
        </div>
      ) : view === "history" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {history === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : history.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-faint">No chats yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {history.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      select(c.id);
                      setView("chat");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      c.id === chat.activeId ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="shrink-0 text-[11px] text-text-faint">{when(c.last_message_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
            onClickCapture={(e) => {
              // On a phone the panel covers the page: following a link (a lead
              // in an answer) should reveal the page it opened.
              const link = (e.target as HTMLElement).closest("a[href^='/']");
              if (link && window.matchMedia("(max-width: 639px)").matches) onClose();
            }}
          >
            {shown.length === 0 ? (
              <div className="flex min-h-full flex-col justify-center px-5 py-8">
                {chat.loading ? (
                  <p className="text-center text-sm text-text-faint">Opening the chat…</p>
                ) : (
                  <>
                    <div className="mb-5 text-center">
                      <div className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-full bg-accent text-white">
                        <Sparkles className="h-5 w-5" aria-hidden />
                      </div>
                      <h2 className="font-display text-base font-semibold text-text">
                        Hi {firstName}, I&apos;m {name}.
                      </h2>
                      <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-text-muted">
                        Ask me about your leads, calls, team or strategy — I look up the real numbers and tell you what to do.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void chat.send(s)}
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] text-text-muted transition-colors hover:border-accent/50 hover:bg-accent-soft/40 hover:text-text"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-6 px-3.5 py-4">
                {shown.map((t, i) => (
                  <TurnView
                    key={t.id}
                    turn={t}
                    assistantName={name}
                    onRetry={i === lastIndex && t.status === "error" && !chat.running ? (q) => void chat.send(q) : undefined}
                  />
                ))}
                {chat.remoteRunning && !chat.live ? (
                  <p className="text-center text-xs text-text-faint">Still answering — this updates on its own.</p>
                ) : null}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-border px-2.5 pb-2 pt-2.5">
            <Composer assistantName={name} onSend={(t) => void chat.send(t)} onStop={() => void chat.stop()} running={chat.running} autoFocus compact />
          </div>
        </>
      )}
    </section>
  );
}
