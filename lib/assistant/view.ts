import type { AssistantMessageRow } from "./types";

/**
 * The client-safe shape of stored messages. Pure — imported by the chat UI as
 * well as the API, so it must never pull in server modules.
 */

/** What the chat UI renders. Tool calls are reduced to name + arguments: the
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
  model: string | null;
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
    model: row.model,
    created_at: row.created_at,
  };
}
