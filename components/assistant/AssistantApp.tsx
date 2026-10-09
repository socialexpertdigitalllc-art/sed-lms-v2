"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Eye, PanelLeft, Pencil, Sparkles, SquarePen, X } from "lucide-react";
import type { AssistantMemory } from "@/lib/assistant/types";
import type { ClientConversation, UiMessage } from "@/lib/assistant/view";
import { useAssistant } from "@/providers/AssistantProvider";
import { iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ConversationList } from "./ConversationList";
import { MemoryPanel } from "./MemoryPanel";
import { NameAssistant } from "./NameAssistant";
import { TurnView } from "./TurnView";
import { JSON_HEADERS, useAssistantChat } from "./useAssistantChat";

/**
 * The full Assistant page: the user's chats on the left, the open chat on the
 * right, opened from the header. The floating chat (AssistantPanel) is the
 * quick way in from any screen; both run on the same chat hook.
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

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
  const { shown, newChat, select } = chat;

  // Keep the newest words in view — unless the user scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

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
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/assistant/conversations/${c.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setConversations((prev) => prev.filter((x) => x.id !== c.id));
      if (chat.activeId === c.id) startNew();
    } catch (e) {
      toast({ kind: "error", title: "Could not delete the chat", body: (e as Error).message });
    }
  }

  const frame = "relative flex h-[calc(100dvh-5.5rem)] overflow-hidden rounded-lg border border-border bg-surface sm:h-[calc(100dvh-6.5rem)]";

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

  return (
    <div className={frame}>
      {/* Chats */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-20 w-72 shrink-0 border-r border-border bg-surface-2 md:static md:z-auto md:flex md:flex-col",
          listOpen ? "flex flex-col shadow-xl" : "hidden",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold text-text">{name}</p>
            <p className="text-[11px] text-text-faint">Your assistant</p>
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
          onDelete={(c) => void removeConversation(c)}
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

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {shown.length === 0 ? (
            <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-10">
              {chat.loading ? (
                <p className="text-center text-sm text-text-faint">Opening the chat…</p>
              ) : (
                <>
                  <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-accent text-white">
                      <Sparkles className="h-5 w-5" aria-hidden />
                    </div>
                    <h2 className="font-display text-xl font-semibold tracking-tight text-text">
                      Hi {firstName}, I&apos;m {name}. What should we work out?
                    </h2>
                    <p className="mx-auto mt-1.5 max-w-md text-sm text-text-muted">
                      I read your dashboard data, do the maths, and find the patterns — then tell you what to do about them. I remember what
                      you tell me between chats.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {props.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void chat.send(s)}
                        className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm text-text-muted transition-colors hover:border-accent/50 hover:bg-accent-soft/40 hover:text-text"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
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

        <div className="shrink-0 border-t border-border bg-surface px-3 pb-2 pt-3">
          <Composer assistantName={name} onSend={(t) => void chat.send(t)} onStop={() => void chat.stop()} running={chat.running} autoFocus />
        </div>
      </section>

      {memoryOpen ? <MemoryPanel assistantName={name} memories={memories} onChange={setMemories} onClose={() => setMemoryOpen(false)} /> : null}

      {renaming ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label={`Rename ${name}`}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
            <NameAssistant mode="rename" compact onDone={() => setRenaming(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
