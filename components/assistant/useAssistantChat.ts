"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantMemory, AssistantStreamEvent } from "@/lib/assistant/types";
import type { ClientConversation, UiMessage } from "@/lib/assistant/view";
import { applyEvent, liveTurn, turnsFromMessages, type TurnModel } from "@/lib/assistant/turns";

/**
 * One open chat with the assistant: which conversation is open, its turns,
 * the answer streaming in right now, and the actions (send, stop, switch,
 * start over). Shared by the full Assistant page and the floating chat so
 * both behave identically.
 *
 * An answer streams in as NDJSON events and is saved server-side as it goes,
 * so switching chats or closing the panel mid-answer is harmless: the answer
 * keeps being written, and reopening the chat shows it finishing (polled) or
 * finished.
 */

export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchConversation(
  id: string,
): Promise<{ conversation: ClientConversation; turns: TurnModel[]; running: boolean }> {
  const res = await fetch(`/api/assistant/conversations/${id}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    conversation?: ClientConversation;
    messages?: UiMessage[];
    running?: boolean;
    error?: string;
  };
  if (!res.ok || !body.conversation) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  return { conversation: body.conversation, turns: turnsFromMessages(body.messages ?? []), running: Boolean(body.running) };
}

export interface AssistantChatOptions {
  initialConversationId?: string | null;
  initialMessages?: UiMessage[];
  initialRunning?: boolean;
  /** The open conversation changed: created, switched to, or cleared. */
  onActiveChange?: (id: string | null) => void;
  /** A conversation was created, opened, or touched by an answer. */
  onConversation?: (c: ClientConversation) => void;
  /** The assistant saved or forgot a memory mid-answer. */
  onMemory?: (action: "saved" | "forgotten", memory: AssistantMemory) => void;
  /** Opening a conversation failed (deleted, or the network). */
  onOpenError?: (id: string, error: Error & { status?: number }) => void;
}

export function useAssistantChat(opts: AssistantChatOptions = {}) {
  // Callbacks are read through a ref so the actions below stay stable.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const [activeId, setActiveIdState] = useState<string | null>(opts.initialConversationId ?? null);
  const [turns, setTurns] = useState<TurnModel[]>(() => turnsFromMessages(opts.initialMessages ?? []));
  const [live, setLive] = useState<TurnModel | null>(null);
  const [remoteRunning, setRemoteRunning] = useState(Boolean(opts.initialRunning));
  const [loading, setLoading] = useState(false);

  const activeRef = useRef<string | null>(opts.initialConversationId ?? null);
  const streamRef = useRef<{ controller: AbortController; conversationId: string | null } | null>(null);

  const setActive = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
    optsRef.current.onActiveChange?.(id);
  }, []);

  // An answer still being written (another tab, or this one before a reload,
  // or a dropped stream): follow it until it lands.
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

  /** Open a conversation. `force` reloads it even when it is already open. */
  const select = useCallback(
    (id: string, force = false) => {
      if (id === activeRef.current && !force) return;
      detach();
      setActive(id);
      setLive(null);
      setTurns([]);
      setRemoteRunning(false);
      setLoading(true);
      fetchConversation(id)
        .then((r) => {
          if (activeRef.current !== id) return;
          setTurns(r.turns);
          setRemoteRunning(r.running);
          optsRef.current.onConversation?.(r.conversation);
        })
        .catch((e: Error & { status?: number }) => {
          if (activeRef.current !== id) return;
          // Gone (deleted in another tab): fall back to a fresh chat rather
          // than keep sending into a conversation that no longer exists.
          if (e.status === 404) setActive(null);
          optsRef.current.onOpenError?.(id, e);
        })
        .finally(() => setLoading(false));
    },
    [detach, setActive],
  );

  const newChat = useCallback(() => {
    detach();
    setActive(null);
    setTurns([]);
    setLive(null);
    setRemoteRunning(false);
  }, [detach, setActive]);

  const running = live?.status === "running" || remoteRunning;

  const send = useCallback(
    async (text: string) => {
      if (streamRef.current || remoteRunning) return;
      const controller = new AbortController();
      const startedIn = activeRef.current;
      let conversationId = startedIn;
      streamRef.current = { controller, conversationId };
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
              if (activeRef.current === startedIn) setActive(conv.id);
              optsRef.current.onConversation?.({ ...conv, last_message_at: new Date().toISOString() });
            }
            if (event.type === "memory") {
              optsRef.current.onMemory?.(event.action, event.memory);
              continue;
            }
            if (event.type === "done" || event.type === "error") finished = true;
            setLive((t) => t && applyEvent(t, event));
          }
        }
        if (!finished) {
          // The stream ended without a verdict — usually a dropped connection.
          // The server may still be finishing; the poll picks it up.
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
    },
    [remoteRunning, setActive],
  );

  const stop = useCallback(async () => {
    const id = streamRef.current?.conversationId ?? activeRef.current;
    if (!id) {
      // Nothing has started on the server yet.
      streamRef.current?.controller.abort();
      streamRef.current = null;
      setLive((t) => t && { ...t, status: "stopped" });
      return;
    }
    await fetch("/api/assistant/chat/stop", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ conversationId: id }) }).catch(
      () => {},
    );
  }, []);

  return {
    activeId,
    turns,
    live,
    /** Saved turns plus the one streaming in now. */
    shown: live ? [...turns, live] : turns,
    running,
    remoteRunning,
    loading,
    select,
    newChat,
    send,
    stop,
  };
}
