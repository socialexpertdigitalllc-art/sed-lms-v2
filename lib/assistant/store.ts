import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEMORY_KINDS,
  NEW_CHAT_TITLE,
  type AssistantConversation,
  type AssistantMemory,
  type AssistantMessageRow,
  type MemoryKind,
} from "./types";

/**
 * Persistence for the assistant: conversations, their messages, and each
 * user's memories. SERVER ONLY — every function takes the service-role client
 * AND the acting user's id, and every query is pinned to that user. The owner
 * check lives here, once, rather than in each route: a conversation id from
 * the URL is only ever looked up together with the caller's own user id.
 */

type Admin = SupabaseClient;

const CONVERSATION_COLUMNS = "id, title, pinned, last_provider, last_model, created_at, updated_at, last_message_at";
const MEMORY_COLUMNS = "id, content, kind, source, conversation_id, created_at, updated_at";

/** Memories one user may keep. The prompt carries them all, so this bounds
 *  the prompt as much as the table. */
export const MAX_MEMORIES = 150;
export const MAX_MEMORY_CHARS = 500;

/* ---------------------------------------------------------- conversations */

export async function listConversations(admin: Admin, userId: string, limit = 200): Promise<AssistantConversation[]> {
  const { data, error } = await admin
    .from("assistant_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("user_id", userId)
    .order("pinned", { ascending: false })
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssistantConversation[];
}

export async function getConversation(admin: Admin, userId: string, id: string): Promise<AssistantConversation | null> {
  const { data, error } = await admin
    .from("assistant_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssistantConversation | null) ?? null;
}

export async function createConversation(admin: Admin, userId: string, title = NEW_CHAT_TITLE): Promise<AssistantConversation> {
  const { data, error } = await admin
    .from("assistant_conversations")
    .insert({ user_id: userId, title: cleanTitle(title) })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the conversation");
  return data as AssistantConversation;
}

export function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").replace(/^["'“”‘’#*\s]+|["'“”‘’*\s.]+$/g, "").trim();
  return (t || NEW_CHAT_TITLE).slice(0, 120);
}

export async function updateConversation(
  admin: Admin,
  userId: string,
  id: string,
  patch: Partial<Pick<AssistantConversation, "title" | "pinned" | "last_provider" | "last_model" | "last_message_at">>,
): Promise<AssistantConversation | null> {
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (typeof patch.title === "string") next.title = cleanTitle(patch.title);
  const { data, error } = await admin
    .from("assistant_conversations")
    .update(next)
    .eq("id", id)
    .eq("user_id", userId)
    .select(CONVERSATION_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssistantConversation | null) ?? null;
}

export async function deleteConversation(admin: Admin, userId: string, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from("assistant_conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/* --------------------------------------------------------------- messages */

const MESSAGE_COLUMNS =
  "id, seq, conversation_id, turn_id, role, content, reasoning, tool_calls, tool_call_id, tool_name, meta, provider, model, usage, status, error, created_at";

/** A conversation's messages in order. Callers have already proven ownership. */
export async function listMessages(admin: Admin, userId: string, conversationId: string): Promise<AssistantMessageRow[]> {
  const out: AssistantMessageRow[] = [];
  // Paged like every other unbounded read: a long chat can pass PostgREST's cap.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await admin
      .from("assistant_messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("seq", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as AssistantMessageRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export type NewMessage = Partial<Omit<AssistantMessageRow, "seq" | "created_at" | "conversation_id">> & {
  role: AssistantMessageRow["role"];
};

export async function insertMessage(
  admin: Admin,
  userId: string,
  conversationId: string,
  message: NewMessage,
): Promise<AssistantMessageRow> {
  const { data, error } = await admin
    .from("assistant_messages")
    .insert({ ...message, conversation_id: conversationId, user_id: userId })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the message");
  return data as AssistantMessageRow;
}

/* --------------------------------------------------------------- memories */

export async function listMemories(admin: Admin, userId: string): Promise<AssistantMemory[]> {
  const { data, error } = await admin
    .from("assistant_memories")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_MEMORIES);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssistantMemory[];
}

export class MemoryError extends Error {}

export function cleanMemory(content: unknown): string {
  if (typeof content !== "string") throw new MemoryError("A memory needs some text.");
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) throw new MemoryError("A memory needs some text.");
  if (text.length > MAX_MEMORY_CHARS) throw new MemoryError(`Keep a memory under ${MAX_MEMORY_CHARS} characters — one fact per memory.`);
  return text;
}

export function memoryKind(kind: unknown): MemoryKind {
  return typeof kind === "string" && (MEMORY_KINDS as readonly string[]).includes(kind) ? (kind as MemoryKind) : "note";
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Save a memory; an identical one already stored is returned instead of
 * duplicated (models like to re-save what they were just told).
 */
export async function addMemory(
  admin: Admin,
  userId: string,
  input: { content: unknown; kind?: unknown; source: "assistant" | "user"; conversationId?: string | null },
): Promise<{ memory: AssistantMemory; duplicate: boolean }> {
  const content = cleanMemory(input.content);
  const existing = await listMemories(admin, userId);
  const twin = existing.find((m) => normalize(m.content) === normalize(content));
  if (twin) return { memory: twin, duplicate: true };
  if (existing.length >= MAX_MEMORIES) {
    throw new MemoryError(`Memory is full (${MAX_MEMORIES}). Forget something outdated first.`);
  }
  const { data, error } = await admin
    .from("assistant_memories")
    .insert({
      user_id: userId,
      content,
      kind: memoryKind(input.kind),
      source: input.source,
      conversation_id: input.conversationId ?? null,
    })
    .select(MEMORY_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the memory");
  return { memory: data as AssistantMemory, duplicate: false };
}

export async function updateMemory(
  admin: Admin,
  userId: string,
  id: string,
  patch: { content?: unknown; kind?: unknown },
): Promise<AssistantMemory | null> {
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.content !== undefined) next.content = cleanMemory(patch.content);
  if (patch.kind !== undefined) next.kind = memoryKind(patch.kind);
  const { data, error } = await admin
    .from("assistant_memories")
    .update(next)
    .eq("id", id)
    .eq("user_id", userId)
    .select(MEMORY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssistantMemory | null) ?? null;
}

export async function deleteMemory(admin: Admin, userId: string, id: string): Promise<AssistantMemory | null> {
  const { data, error } = await admin
    .from("assistant_memories")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select(MEMORY_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssistantMemory | null) ?? null;
}

/** The short handle a memory is shown to the model under ("m3f9a2c1"). */
export function memoryHandle(id: string): string {
  return `m${id.replace(/-/g, "").slice(0, 7)}`;
}
