import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import type { AssistantMessageRow } from "./types";

/** Shared plumbing for /api/assistant/*. SERVER ONLY. */

export interface AssistantCaller {
  user: User;
  perms: Set<string>;
  /** The caller's own (RLS) client. */
  supabase: SupabaseClient;
  displayName: string;
}

/** Signed in AND allowed to use the assistant, or the response to return. */
export async function assistantGuard(): Promise<{ ok: true; caller: AssistantCaller } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("assistant.use")) {
    return { ok: false, response: NextResponse.json({ error: "Your account does not have access to the AI Assistant." }, { status: 403 }) };
  }
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const displayName = (profile?.display_name as string | null)?.trim() || user.email?.split("@")[0] || "there";
  return { ok: true, caller: { user, perms, supabase, displayName } };
}

/** The tables do not exist yet: migration 0083 has not been applied. */
export function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /assistant_(conversations|messages|memories)/.test(msg) && /(does not exist|schema cache|could not find)/i.test(msg);
}

export const MIGRATION_MESSAGE =
  "The AI Assistant's database tables are not set up yet. An admin needs to apply migration 0083_ai_assistant.sql.";

/** A store failure as a response; never echoes internals beyond the reason. */
export function storeError(e: unknown, fallback = "Could not complete that request."): NextResponse {
  if (isMissingTableError(e)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 503 });
  console.error("[assistant]", e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
