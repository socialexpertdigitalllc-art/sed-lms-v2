import type { ActionCard } from "./actions/card";

/**
 * Shapes shared by the assistant's server code, its API, and its UI.
 * Pure types and constants — safe to import from client components.
 */

export const MEMORY_KINDS = ["preference", "goal", "fact", "strategy", "note"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface AssistantMemory {
  id: string;
  content: string;
  kind: MemoryKind;
  source: "assistant" | "user";
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssistantConversation {
  id: string;
  title: string;
  pinned: boolean;
  last_provider: string | null;
  last_model: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

/** Display facts about one tool call, stored on the tool message row. */
export interface ToolCallMeta {
  label: string;
  ok: boolean;
  summary: string;
  duration_ms: number;
  /** The arguments, for "what exactly did it look up?". */
  args?: Record<string, unknown>;
}

/** The user's rating of an answer (thumbs up / down). */
export type AnswerFeedback = "up" | "down";

/** A file attached to a question (kept in the assistant's private bucket). */
export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
}

/** Where the person was in the app when they asked (the floating chat). */
export interface PageContext {
  path: string;
  title?: string;
}

export type AssistantMode = "ask" | "act";

/** `meta` on a message row: a tool call's display facts (tool rows), the
 *  user's rating of the answer (the final assistant row of a turn), or — on a
 *  question — its attachments, mode and page. */
export interface MessageMeta extends Partial<ToolCallMeta> {
  feedback?: AnswerFeedback;
  attachments?: MessageAttachment[];
  mode?: AssistantMode;
  page?: PageContext;
}

export interface AssistantMessageRow {
  id: string;
  seq: number;
  conversation_id: string;
  turn_id: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning: string | null;
  tool_calls: unknown[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  meta: MessageMeta | null;
  provider: string | null;
  model: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  status: "complete" | "error" | "stopped";
  error: string | null;
  created_at: string;
}

/**
 * The chat stream, one JSON object per line (NDJSON). The server persists
 * everything it streams, so a client that drops off mid-answer loses nothing:
 * reopening the conversation shows the finished reply.
 *
 * Deliberately says nothing about which vendor or model is answering — see
 * lib/assistant/view.ts.
 */
export type AssistantStreamEvent =
  | {
      type: "start";
      /** Client-safe: no provider/model fields (see toClientConversation). */
      conversation: Omit<AssistantConversation, "last_provider" | "last_model">;
      userMessageId: string;
    }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  /** The current model round failed mid-stream and is being retried: drop its partial text. */
  | { type: "reset" }
  | { type: "tool_start"; callId: string; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool_end"; callId: string; name: string; ok: boolean; summary: string; durationMs: number }
  | { type: "memory"; action: "saved" | "forgotten"; memory: AssistantMemory }
  /** A change was prepared for the person to confirm (or one changed state). */
  | { type: "action"; card: ActionCard }
  /** The assistant switched itself into Act mode for this request. */
  | { type: "mode"; mode: AssistantMode; reason: string }
  | { type: "title"; title: string }
  | { type: "done"; messageId: string | null; stopped: boolean }
  | { type: "error"; message: string }
  | { type: "ping" };

export const NEW_CHAT_TITLE = "New chat";
