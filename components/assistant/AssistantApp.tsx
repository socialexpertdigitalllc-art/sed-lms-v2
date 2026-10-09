"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, Brain, Eye, PanelLeft, Pencil, SquarePen, X } from "lucide-react";
import type { AssistantMemory } from "@/lib/assistant/types";
import type { ClientConversation, UiMessage } from "@/lib/assistant/view";
import { useAssistant } from "@/providers/AssistantProvider";
import { iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConversationList } from "./ConversationList";
import { MemoryPanel } from "./MemoryPanel";
import { NameAssistant } from "./NameAssistant";
import { SedAiAvatar } from "./SedAiMark";
import { Suggestions } from "./Suggestions";
import { TurnView } from "./TurnView";
import { JSON_HEADERS, useAssistantChat } from "./useAssistantChat";
import { useStickToBottom } from "./useStickToBottom";

/**
 * The full Assistant page: the user's chats on the left, the open chat on the
 * right, opened from the header. A new chat opens the way ChatGPT and Claude
 * do — a greeting with the message box in the middle of the screen — and
 * moves the box to the bottom once the conversation starts. The floating
 * chat (AssistantPanel) is the quick way in from any screen; both run on the
 * same chat hook.
 */

export interface AssistantAppProps {
  scope: string[];
  suggestions: string[];
  initialConversations: ClientConversation[];
  initialMemories: AssistantMemory[];
  initialConversationId: string | null;
  initialMessages: UiMessage[];
  initialRunning: boolean;
}

function upsert(list: ClientConversation[], c: ClientConversation): ClientConversation[] {
  const next = [c, ...list.filter((x) => x.id !== c.id)];
  return next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last_message_at.localeCompare(a.last_message_at));
}

const setUrl = (id: string | null) => {
  window.history.replaceState(window.history.state, "", id ? `/assistant?c=${id}` : "/assistant");
};

export function AssistantApp(props: AssistantAppProps) {
  const { toast } = useToast();
  const { name, named, displayName } = useAssistant();
  const [conversations, setConversations] = useState(props.initialConversations);
  const [memories, setMemories] = useState(props.initialMemories);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [deleting, setDeleting] = useState<ClientConversation | null>(null);
  const { scrollRef, contentRef, onScroll, onClickCapture, atBottom, scrollToBottom } = useStickToBottom();

  const chat = useAssistantChat({
    initialConversationId: props.initialConversationId,
    initialMessages: props.initialMessages,
    initialRunning: props.initialRunning,
    onActiveChange: setUrl,
    onConversation: (c) => setConversations((prev) => upsert(prev, c)),
    onMemory: (action, m) =>
      setMemories((prev) => (action === "saved" ? [m, ...prev.filter((x) => x.id !== m.id)] : prev.filter((x) => x.id !== m.id))),
    onOpenError: (_id, e) => {
      if (e.status !== 404) toast({ kind: "error", title: "Could not open the chat", body: e.message });
    },
  });
  const { shown, newChat, select, send } = chat;

  // A chat that is opened (or started) starts at its newest message.
  useEffect(() => {
    scrollToBottom(false);
  }, [chat.activeId, scrollToBottom]);

  const open = useCallback(
    (id: string) => {
      setListOpen(false);
      select(id);
    },
    [select],
  );

  const startNew = useCallback(() => {
    setListOpen(false);
    newChat();
  }, [newChat]);

  const ask = useCallback(
    (text: string) => {
      scrollToBottom(false);
      void send(text);
    },
    [send, scrollToBottom],
  );

  async function patchConversation(c: ClientConversation, patch: { title?: string; pinned?: boolean }) {
    setConversations((prev) => upsert(prev, { ...c, ...patch }));
    try {
      const res = await fetch(`/api/assistant/conversations/${c.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => ({}))) as { conversation?: ClientConversation; error?: string };
      if (!res.ok || !body.conversation) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConversations((prev) => upsert(prev, body.conversation!));
    } catch (e) {
      setConversations((prev) => upsert(prev, c));
      toast({ kind: "error", title: "Could not update the chat", body: (e as Error).message });
    }
  }

  async function removeConversation(c: ClientConversation) {
    setDeleting(null);
    try {
      const res = await fetch(`/api/assistant/conversations/${c.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setConversations((prev) => prev.filter((x) => x.id !== c.id));
      if (chat.activeId === c.id) startNew();
    } catch (e) {
      toast({ kind: "error", title: "Could not delete the chat", body: (e as Error).message });
    }
  }

  const frame = "relative flex h-[calc(100dvh-5.5rem)] overflow-hidden rounded-xl border border-border bg-surface sm:h-[calc(100dvh-6.5rem)]";

  // First visit: the user names their assistant before anything else.
  if (!named) {
    return (
      <div className={cn(frame, "items-center justify-center overflow-y-auto")}>
        <NameAssistant mode="first" />
      </div>
    );
  }

  const runningIds = new Set<string>(chat.running && chat.activeId ? [chat.activeId] : []);
  const active = conversations.find((c) => c.id === chat.activeId) ?? null;
  const lastIndex = shown.length - 1;
  const firstName = displayName.split(/\s+/)[0] || "there";
  const empty = shown.length === 0 && !chat.loading;
  const idle = !chat.running;

  const notice = chat.notice ? (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-dropped-bg bg-dropped-bg/40 px-3 py-2 text-[13px] text-dropped-fg" role="alert">
      <span className="min-w-0 flex-1">{chat.notice}</span>
      <button type="button" onClick={chat.clearNotice} className="shrink-0 rounded p-0.5 hover:bg-dropped-bg" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  ) : null;

  return (
    <div className={frame}>
      {/* Chats */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-20 w-72 shrink-0 border-r border-border bg-surface-2 md:static md:z-auto md:flex md:flex-col",
          listOpen ? "flex flex-col shadow-xl" : "hidden",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pb-1 pt-4">
          <SedAiAvatar size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold text-text">{name}</p>
            <p className="text-[11px] text-text-faint">Your assistant · SED AI</p>
          </div>
          <button type="button" className={iconBtn} onClick={() => setRenaming(true)} aria-label={`Rename ${name}`} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={chat.activeId}
          runningIds={runningIds}
          onSelect={open}
          onNew={startNew}
          onRename={(id, title) => {
            const c = conversations.find((x) => x.id === id);
            if (c) void patchConversation(c, { title });
          }}
          onTogglePin={(c) => void patchConversation(c, { pinned: !c.pinned })}
          onDelete={(c) => setDeleting(c)}
        />
      </aside>
      {listOpen ? <button type="button" className="absolute inset-0 z-10 bg-black/20 md:hidden" aria-label="Close chats" onClick={() => setListOpen(false)} /> : null}

      {/* Open chat */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <button type="button" className={cn(iconBtn, "md:hidden")} onClick={() => setListOpen(true)} aria-label="Show chats" title="Chats">
            <PanelLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-text">{active?.title ?? "New chat"}</h1>
          <button
            type="button"
            className={cn(iconBtn, scopeOpen && "border-border bg-surface-2 text-text")}
            onClick={() => setScopeOpen((v) => !v)}
            aria-label={`What ${name} can see`}
            aria-expanded={scopeOpen}
            title={`What ${name} can see`}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")} onClick={() => setMemoryOpen(true)} aria-label="Memory" title="Memory">
            <Brain className="h-4 w-4" />
            <span className="tabular-nums">{memories.length}</span>
          </button>
          <button type="button" className={iconBtn} onClick={startNew} aria-label="New chat" title="New chat">
            <SquarePen className="h-4 w-4" />
          </button>
        </header>

        {scopeOpen ? (
          <div className="border-b border-border bg-surface-2 px-4 py-3 text-xs text-text-muted">
            <div className="mx-auto flex max-w-3xl items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1 font-semibold text-text">What {name} can see</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {props.scope.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-text-faint">This follows your account&apos;s permissions. Your chats and memories are private to you.</p>
              </div>
              <button type="button" className={iconBtn} onClick={() => setScopeOpen(false)} aria-label="Close" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        {empty ? (
          // New chat: greeting and message box in the middle, like ChatGPT and Claude.
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* my-auto, not justify-center: centred when it fits, and still
                scrollable from the top on a short screen when it does not. */}
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-10">
              <div className="my-auto">
                <div className="mb-7 text-center">
                  <SedAiAvatar size="lg" className="mx-auto mb-4" />
                  <h2 className="font-display text-2xl font-semibold tracking-tight text-text sm:text-[1.75rem]">
                    Hi {firstName}, I&apos;m <span className="sed-ai-gradient-text">{name}</span>
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
                    Ask me about your leads, calls, team or strategy. I look up the real numbers, do the maths and tell you what to do — and I
                    remember what you tell me.
                  </p>
                </div>
                {notice}
                <Composer assistantName={name} onSend={ask} onStop={() => void chat.stop()} running={chat.running} autoFocus />
                {props.suggestions.length ? (
                  <div className="mt-6">
                    <Suggestions items={props.suggestions} onPick={ask} layout="grid" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              <div ref={scrollRef} onScroll={onScroll} onClickCapture={onClickCapture} className="h-full overflow-y-auto" aria-busy={chat.running}>
                <div ref={contentRef} className="mx-auto max-w-3xl space-y-8 px-4 pb-8 pt-6">
                  {chat.loading ? (
                    <div className="space-y-4 pt-2" aria-label="Opening the chat">
                      <div className="ml-auto h-10 w-2/5 animate-pulse rounded-3xl bg-surface-2" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
                      <div className="h-4 w-1/2 animate-pulse rounded bg-surface-2" />
                    </div>
                  ) : (
                    shown.map((t, i) => {
                      const latest = i === lastIndex;
                      return (
                        <TurnView
                          key={t.id}
                          turn={t}
                          assistantName={name}
                          latest={latest}
                          onRetry={latest && t.status === "error" && idle ? () => chat.retry(t) : undefined}
                          onRegenerate={latest && idle && t.status !== "error" ? () => chat.regenerate(t) : undefined}
                          onEdit={latest && idle ? (text) => chat.edit(t, text) : undefined}
                          onRate={(id, value) => void chat.rate(id, value)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
              {!atBottom ? (
                <button
                  type="button"
                  onClick={() => scrollToBottom()}
                  className="absolute bottom-3 left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-text-muted shadow-md transition-colors hover:text-text"
                  aria-label="Scroll to the latest message"
                  title="Latest message"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>

            <div className="shrink-0 bg-surface px-3 pb-3 pt-1">
              {notice}
              <Composer
                assistantName={name}
                onSend={ask}
                onStop={() => void chat.stop()}
                running={chat.running}
                placeholder={`Reply to ${name}…`}
                autoFocus
              />
            </div>
          </>
        )}
      </section>

      {memoryOpen ? <MemoryPanel assistantName={name} memories={memories} onChange={setMemories} onClose={() => setMemoryOpen(false)} /> : null}

      {renaming ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Rename ${name}`}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-xl">
            <NameAssistant mode="rename" compact onDone={() => setRenaming(false)} />
          </div>
        </div>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this chat?"
          body={`"${deleting.title}" and everything in it will be deleted. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void removeConversation(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
