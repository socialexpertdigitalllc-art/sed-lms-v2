"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, History, Loader2, Maximize2, MessageSquare, Pencil, SquarePen, X } from "lucide-react";
import { useAssistant } from "@/providers/AssistantProvider";
import { usePermissions } from "@/hooks/usePermissions";
import { suggestionsFor } from "@/lib/assistant/suggestions";
import type { ClientConversation } from "@/lib/assistant/view";
import { iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { NameAssistant } from "./NameAssistant";
import { SedAiAvatar } from "./SedAiMark";
import { Suggestions } from "./Suggestions";
import { TurnView } from "./TurnView";
import { useAssistantChat } from "./useAssistantChat";
import { useStickToBottom } from "./useStickToBottom";

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
  const { scrollRef, contentRef, onScroll, onClickCapture: pauseOnDisclosure, atBottom, scrollToBottom } = useStickToBottom();

  const chat = useAssistantChat({
    onActiveChange: (id) => writeStored(userId, id),
    onConversation: (c) => setHistory((prev) => (prev ? sortConversations([c, ...prev.filter((x) => x.id !== c.id)]) : prev)),
    onOpenError: (_id, e) => {
      if (e.status !== 404) toast({ kind: "error", title: "Could not open the chat", body: e.message });
    },
  });
  const { select, shown, send } = chat;

  // Pick up the chat that was open last time — once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !named) return;
    restored.current = true;
    const id = readStored(userId);
    if (id) select(id);
  }, [named, userId, select]);

  // Opening a chat — or reopening the panel — starts at the newest message.
  // (A new chat's greeting starts at the top.)
  const hasTurns = shown.length > 0;
  useEffect(() => {
    if (!hidden && view === "chat" && hasTurns) scrollToBottom(false);
  }, [chat.activeId, hidden, view, hasTurns, scrollToBottom]);

  // Reopening puts the cursor back in the message box.
  useEffect(() => {
    if (!hidden && view === "chat") panelRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the assistant"]')?.focus();
  }, [hidden, view]);

  const ask = useCallback(
    (text: string) => {
      scrollToBottom(false);
      void send(text);
    },
    [send, scrollToBottom],
  );

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
  const idle = !chat.running;

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
        "sed-ai-pop fixed z-[45] flex flex-col overflow-hidden border-border bg-surface shadow-2xl",
        "inset-0 sm:inset-auto sm:bottom-[5.75rem] sm:right-4 sm:h-[min(700px,calc(100dvh-9.75rem))] sm:w-[440px] sm:rounded-2xl sm:border",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border pl-3 pr-2">
        {view === "chat" ? (
          <SedAiAvatar size="sm" spinning={chat.running} />
        ) : (
          <button type="button" className={iconBtn} onClick={() => setView("chat")} aria-label="Back to the chat" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 pl-2">
          {view === "chat" && named ? (
            <button
              type="button"
              onClick={() => setView("rename")}
              className="group flex max-w-full flex-col items-start rounded text-left"
              title={`Rename ${name}`}
            >
              <span className="flex max-w-full items-center gap-1">
                <span className="truncate text-sm font-semibold leading-tight text-text">{name}</span>
                <Pencil className="h-3 w-3 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </span>
              <span className="text-[11px] leading-tight text-text-faint">{chat.running ? "Working on it…" : "SED AI"}</span>
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
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
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
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="h-full overflow-y-auto"
              aria-busy={chat.running}
              onClickCapture={(e) => {
                pauseOnDisclosure(e);
                // On a phone the panel covers the page: following a link (a lead
                // in an answer) should reveal the page it opened.
                const link = (e.target as HTMLElement).closest("a[href^='/']");
                if (link && window.matchMedia("(max-width: 639px)").matches) onClose();
              }}
            >
              <div className="min-h-full">
                {shown.length === 0 ? (
                  // my-auto, not justify-center: centred when it fits, and still
                  // scrollable from the top on a short screen when it does not.
                  <div className="flex min-h-full flex-col px-5 py-8">
                    <div className="my-auto">
                      {chat.loading ? (
                        <div className="space-y-3" aria-label="Opening the chat">
                          <div className="ml-auto h-9 w-1/2 animate-pulse rounded-3xl bg-surface-2" />
                          <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-2" />
                          <div className="h-3.5 w-3/5 animate-pulse rounded bg-surface-2" />
                        </div>
                      ) : (
                        <>
                          <div className="mb-5 text-center">
                            <SedAiAvatar size="md" className="mx-auto mb-3" />
                            <h2 className="font-display text-lg font-semibold tracking-tight text-text">
                              Hi {firstName}, I&apos;m <span className="sed-ai-gradient-text">{name}</span>
                            </h2>
                            <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-text-muted">
                              Ask me about your leads, calls, team or strategy — I look up the real numbers and tell you what to do.
                            </p>
                          </div>
                          <Suggestions items={suggestions} onPick={ask} layout="list" />
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div ref={contentRef} className="space-y-6 px-4 pb-6 pt-4">
                    {shown.map((t, i) => {
                      const latest = i === lastIndex;
                      return (
                        <TurnView
                          key={t.id}
                          turn={t}
                          assistantName={name}
                          compact
                          latest={latest}
                          onRetry={latest && t.status === "error" && idle ? () => chat.retry(t) : undefined}
                          onRegenerate={latest && idle && t.status !== "error" ? () => chat.regenerate(t) : undefined}
                          onEdit={latest && idle ? (text) => chat.edit(t, text) : undefined}
                          onRate={(id, value) => void chat.rate(id, value)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {!atBottom && shown.length ? (
              <button
                type="button"
                onClick={() => scrollToBottom()}
                className="absolute bottom-2 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-text-muted shadow-md transition-colors hover:text-text"
                aria-label="Scroll to the latest message"
                title="Latest message"
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="shrink-0 px-3 pb-2.5 pt-1">
            {chat.notice ? (
              <div className="mb-2 flex items-start gap-2 rounded-xl border border-dropped-bg bg-dropped-bg/40 px-3 py-2 text-xs text-dropped-fg" role="alert">
                <span className="min-w-0 flex-1">{chat.notice}</span>
                <button type="button" onClick={chat.clearNotice} className="shrink-0 rounded p-0.5 hover:bg-dropped-bg" aria-label="Dismiss">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
            <Composer
              assistantName={name}
              onSend={ask}
              onStop={() => void chat.stop()}
              running={chat.running}
              placeholder={shown.length ? `Reply to ${name}…` : undefined}
              autoFocus
              compact
            />
          </div>
        </>
      )}
    </section>
  );
}
