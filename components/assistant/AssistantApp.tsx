"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Eye, PanelLeft, Sparkles, SquarePen, X } from "lucide-react";
import type { AssistantConversation, AssistantMemory, AssistantStreamEvent } from "@/lib/assistant/types";
import type { UiMessage } from "@/lib/assistant/view";
import { applyEvent, liveTurn, turnsFromMessages, type TurnModel } from "@/lib/assistant/turns";
import { iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { Composer } from "./Composer";
import { ConversationList } from "./ConversationList";
import { MemoryPanel } from "./MemoryPanel";
import { TurnView } from "./TurnView";

/**
 * The AI Assistant page: the user's chats on the left, the open chat on the
 * right. An answer streams in as NDJSON events and is saved server-side as it
 * goes, so leaving a chat mid-answer is harmless — reopening it shows the
 * answer finishing (polled) or finished.
 */

export interface AssistantAppProps {
  displayName: string;
  modelLabel: string | null;
  scope: string[];
  suggestions: string[];
  initialConversations: AssistantConversation[];
  initialMemories: AssistantMemory[];
  initialConversationId: string | null;
  initialMessages: UiMessage[];
  initialRunning: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function upsert(list: AssistantConversation[], c: AssistantConversation): AssistantConversation[] {
  const rest = list.filter((x) => x.id !== c.id);
  const next = [c, ...rest];
  return next.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.last_message_at.localeCompare(a.last_message_at));
}

async function fetchConversation(id: string): Promise<{ conversation: AssistantConversation; turns: TurnModel[]; running: boolean }> {
  const res = await fetch(`/api/assistant/conversations/${id}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    conversation?: AssistantConversation;
    messages?: UiMessage[];
    running?: boolean;
    error?: string;
  };
  if (!res.ok || !body.conversation) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { conversation: body.conversation, turns: turnsFromMessages(body.messages ?? []), running: Boolean(body.running) };
}

export function AssistantApp(props: AssistantAppProps) {
  const { toast } = useToast();
  const [conversations, setConversations] = useState(props.initialConversations);
  const [activeId, setActiveId] = useState<string | null>(props.initialConversationId);
  const [turns, setTurns] = useState<TurnModel[]>(() => turnsFromMessages(props.initialMessages));
  const [live, setLive] = useState<TurnModel | null>(null);
  const [remoteRunning, setRemoteRunning] = useState(props.initialRunning);
  const [memories, setMemories] = useState(props.initialMemories);
  const [modelLabel, setModelLabel] = useState(props.modelLabel);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const activeRef = useRef(activeId);
  const streamRef = useRef<{ controller: AbortController; conversationId: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const setUrl = (id: string | null) => {
    window.history.replaceState(window.history.state, "", id ? `/assistant?c=${id}` : "/assistant");
  };

  // Keep the newest words in view — unless the user scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns, live]);

  // An answer still being written (another tab, or this one before a
  // reload): follow it until it lands.
  useEffect(() => {
    if (!remoteRunning || live || !activeId) return;
    const id = activeId;
    const timer = setInterval(() => {
      void fetchConversation(id)
        .then((r) => {
          if (activeRef.current !== id) return;
          setTurns(r.turns);
          setRemoteRunning(r.running);
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [remoteRunning, live, activeId]);

  /** Stop mirroring a live answer (it keeps going, and saving, on the server). */
  const detach = useCallback(() => {
    streamRef.current?.controller.abort();
    streamRef.current = null;
  }, []);

  const select = useCallback(
    (id: string) => {
      setListOpen(false);
      if (id === activeRef.current) return;
      detach();
      setActiveId(id);
      activeRef.current = id;
      setLive(null);
      setTurns([]);
      setRemoteRunning(false);
      setUrl(id);
      setLoading(true);
      fetchConversation(id)
        .then((r) => {
          if (activeRef.current !== id) return;
          setTurns(r.turns);
          setRemoteRunning(r.running);
          setConversations((prev) => upsert(prev, r.conversation));
        })
        .catch((e: Error) => toast({ kind: "error", title: "Could not open the chat", body: e.message }))
        .finally(() => setLoading(false));
    },
    [detach, toast],
  );

  const newChat = useCallback(() => {
    detach();
    setActiveId(null);
    activeRef.current = null;
    setTurns([]);
    setLive(null);
    setRemoteRunning(false);
    setListOpen(false);
    setUrl(null);
  }, [detach]);

  async function send(text: string) {
    if (live?.status === "running" || remoteRunning) return;
    const controller = new AbortController();
    const startedIn = activeRef.current;
    let conversationId = startedIn;
    streamRef.current = { controller, conversationId };
    stickRef.current = true;
    setLive(liveTurn(`pending-${Date.now()}`, text));

    let finished = false;
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ conversationId: startedIn, message: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLive((t) => t && { ...t, status: "error", error: body.error ?? `The request failed (HTTP ${res.status}).` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          let event: AssistantStreamEvent;
          try {
            event = JSON.parse(line) as AssistantStreamEvent;
          } catch {
            continue;
          }
          if (event.type === "ping") continue;
          if (event.type === "start") {
            const conv = event.conversation;
            conversationId = conv.id;
            streamRef.current = { controller, conversationId };
            if (activeRef.current === startedIn) {
              setActiveId(conv.id);
              activeRef.current = conv.id;
              setUrl(conv.id);
            }
            setConversations((prev) => upsert(prev, { ...conv, last_message_at: new Date().toISOString() }));
            setModelLabel(event.modelLabel);
          }
          if (event.type === "memory") {
            const m = event.memory;
            setMemories((prev) => (event.action === "saved" ? [m, ...prev.filter((x) => x.id !== m.id)] : prev.filter((x) => x.id !== m.id)));
            continue;
          }
          if (event.type === "done" || event.type === "error") finished = true;
          setLive((t) => t && applyEvent(t, event));
        }
      }
      if (!finished) {
        // The stream ended without a verdict — usually a dropped connection.
        // The server may still be finishing; the poll below picks it up.
        setRemoteRunning(true);
      }
    } catch {
      if (controller.signal.aborted) return; // switched chats, or stopped before it began
      setRemoteRunning(true);
    } finally {
      if (streamRef.current?.controller === controller) streamRef.current = null;
      // Swap the live turn for the saved one — in one update, so it never shows twice.
      if (conversationId && activeRef.current === conversationId && !controller.signal.aborted) {
        try {
          const r = await fetchConversation(conversationId);
          if (activeRef.current === conversationId) {
            setTurns(r.turns);
            setRemoteRunning(r.running);
            setLive(null);
          }
        } catch {
          setLive((t) => (t && t.status === "running" ? { ...t, status: "done" } : t));
        }
      }
    }
  }

  async function stop() {
    const id = streamRef.current?.conversationId ?? activeRef.current;
    if (!id) {
      // Nothing has started on the server yet.
      streamRef.current?.controller.abort();
      setLive((t) => t && { ...t, status: "stopped" });
      return;
    }
    await fetch("/api/assistant/chat/stop", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ conversationId: id }) }).catch(() => {});
  }

  async function patchConversation(c: AssistantConversation, patch: { title?: string; pinned?: boolean }) {
    setConversations((prev) => upsert(prev, { ...c, ...patch }));
    try {
      const res = await fetch(`/api/assistant/conversations/${c.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => ({}))) as { conversation?: AssistantConversation; error?: string };
      if (!res.ok || !body.conversation) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConversations((prev) => upsert(prev, body.conversation!));
    } catch (e) {
      setConversations((prev) => upsert(prev, c));
      toast({ kind: "error", title: "Could not update the chat", body: (e as Error).message });
    }
  }

  async function removeConversation(c: AssistantConversation) {
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/assistant/conversations/${c.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setConversations((prev) => prev.filter((x) => x.id !== c.id));
      if (activeRef.current === c.id) newChat();
    } catch (e) {
      toast({ kind: "error", title: "Could not delete the chat", body: (e as Error).message });
    }
  }

  const running = live?.status === "running" || remoteRunning;
  const runningIds = new Set<string>(running && activeId ? [activeId] : []);
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const shown = live ? [...turns, live] : turns;
  const lastIndex = shown.length - 1;
  const firstName = props.displayName.split(/\s+/)[0] || "there";

  return (
    <div className="relative flex h-[calc(100dvh-5.5rem)] overflow-hidden rounded-lg border border-border bg-surface sm:h-[calc(100dvh-6.5rem)]">
      {/* Chats */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-20 w-72 shrink-0 border-r border-border bg-surface-2 md:static md:z-auto md:flex md:flex-col",
          listOpen ? "flex flex-col shadow-xl" : "hidden",
        )}
      >
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          runningIds={runningIds}
          onSelect={select}
          onNew={newChat}
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
          {modelLabel ? (
            <span className="hidden items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted sm:inline-flex">
              <Sparkles className="h-3 w-3 text-accent" aria-hidden /> {modelLabel}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(iconBtn, scopeOpen && "border-border bg-surface-2 text-text")}
            onClick={() => setScopeOpen((v) => !v)}
            aria-label="What the assistant can see"
            aria-expanded={scopeOpen}
            title="What I can see"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className={cn(iconBtn, "w-auto gap-1 px-2 text-xs")} onClick={() => setMemoryOpen(true)} aria-label="Memory" title="Memory">
            <Brain className="h-4 w-4" />
            <span className="tabular-nums">{memories.length}</span>
          </button>
          <button type="button" className={iconBtn} onClick={newChat} aria-label="New chat" title="New chat">
            <SquarePen className="h-4 w-4" />
          </button>
        </header>

        {scopeOpen ? (
          <div className="border-b border-border bg-surface-2 px-4 py-3 text-xs text-text-muted">
            <div className="mx-auto flex max-w-3xl items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="mb-1 font-semibold text-text">What your assistant can see</p>
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
              {loading ? (
                <p className="text-center text-sm text-text-faint">Opening the chat…</p>
              ) : (
                <>
                  <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-accent text-white">
                      <Sparkles className="h-5 w-5" aria-hidden />
                    </div>
                    <h2 className="font-display text-xl font-semibold tracking-tight text-text">Hi {firstName}, what should we work out?</h2>
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
                        onClick={() => void send(s)}
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
                  onRetry={i === lastIndex && t.status === "error" && !running ? (q) => void send(q) : undefined}
                />
              ))}
              {remoteRunning && !live ? (
                <p className="text-center text-xs text-text-faint">Still answering — this updates on its own.</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-3 pb-2 pt-3">
          <Composer onSend={(t) => void send(t)} onStop={() => void stop()} running={running} autoFocus />
        </div>
      </section>

      {memoryOpen ? <MemoryPanel memories={memories} onChange={setMemories} onClose={() => setMemoryOpen(false)} /> : null}
    </div>
  );
}
