import type { AssistantConversation, AssistantMessageRow } from "./types";

/**
 * The client-safe shapes of stored conversations and messages. Pure —
 * imported by the chat UI as well as the API, so it must never pull in server
 * modules.
 *
 * NO VENDOR DETAILS cross this boundary: which provider and model answered is
 * kept server-side for admins and debugging, and never sent to a browser. To
 * end users the assistant runs on SED AI.
 */

/** A conversation as the browser sees it. */
export type ClientConversation = Omit<AssistantConversation, "last_provider" | "last_model">;

export function toClientConversation(c: AssistantConversation): ClientConversation {
  return {
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    created_at: c.created_at,
    updated_at: c.updated_at,
    last_message_at: c.last_message_at,
  };
}

/** What the chat UI renders. Tool calls are reduced to their id and name: the
 *  vendor's raw extras (signatures) mean nothing to a browser. */
export interface UiMessage {
  id: string;
  turn_id: string | null;
  role: AssistantMessageRow["role"];
  content: string;
  reasoning: string | null;
  tool_calls: { id: string; name: string }[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  meta: AssistantMessageRow["meta"];
  status: AssistantMessageRow["status"];
  error: string | null;
  created_at: string;
}

export function toUiMessage(row: AssistantMessageRow): UiMessage {
  const calls = Array.isArray(row.tool_calls)
    ? row.tool_calls
        .map((c) => {
          const call = c as { id?: unknown; function?: { name?: unknown } };
          return typeof call.id === "string" && typeof call.function?.name === "string" ? { id: call.id, name: call.function.name } : null;
        })
        .filter((c): c is { id: string; name: string } => c !== null)
    : null;
  return {
    id: row.id,
    turn_id: row.turn_id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning,
    tool_calls: calls && calls.length ? calls : null,
    tool_call_id: row.tool_call_id,
    tool_name: row.tool_name,
    meta: row.meta,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
  };
}
