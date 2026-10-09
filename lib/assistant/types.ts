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
  meta: ToolCallMeta | null;
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
 */
export type AssistantStreamEvent =
  | {
      type: "start";
      conversation: AssistantConversation;
      userMessageId: string;
      provider: string;
      model: string;
      modelLabel: string;
    }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  /** The current model round failed mid-stream and is being retried: drop its partial text. */
  | { type: "reset" }
  | { type: "tool_start"; callId: string; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool_end"; callId: string; name: string; ok: boolean; summary: string; durationMs: number }
  | { type: "memory"; action: "saved" | "forgotten"; memory: AssistantMemory }
  | { type: "title"; title: string }
  | { type: "done"; messageId: string | null; stopped: boolean }
  | { type: "error"; message: string }
  | { type: "ping" };

export const NEW_CHAT_TITLE = "New chat";
