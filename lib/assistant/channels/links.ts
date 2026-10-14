import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { telegramBotUsername, whatsappDisplayNumber } from "./config";
import { LINK_CODE_TTL_MS, type Channel, type ChannelLinkView, type LinkCodeResponse } from "./types";

/**
 * Linking a phone to a person's assistant, and the links themselves.
 * SERVER ONLY — service-role client, every query pinned to its owner here.
 *
 * A link is made with a one-time code the person creates in the app (signed
 * in, so the code proves who they are) and sends from the chat (so it proves
 * the chat is theirs). Codes are six random digits, single-use, ten minutes.
 */

type Admin = SupabaseClient;

const CODES = "assistant_link_codes";
const LINKS = "assistant_channel_links";

export interface ChannelLink {
  id: string;
  user_id: string;
  channel: Channel;
  external_id: string;
  label: string | null;
  conversation_id: string | null;
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
}

const LINK_COLUMNS = "id, user_id, channel, external_id, label, conversation_id, active, created_at, last_seen_at";

/* ------------------------------------------------------------------ codes */

export function randomLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * A fresh code for this person and channel. Any earlier code of theirs for
 * the channel stops working (only the newest one is shown to them), and
 * expired codes of anyone are cleared on the way.
 */
export async function createLinkCode(admin: Admin, userId: string, channel: Channel, now = new Date()): Promise<{ code: string; expiresAt: string }> {
  await admin.from(CODES).delete().lt("expires_at", now.toISOString());
  const { error: clearError } = await admin.from(CODES).delete().eq("user_id", userId).eq("channel", channel);
  if (clearError) throw new Error(clearError.message);
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomLinkCode();
    const { error } = await admin.from(CODES).insert({ code, user_id: userId, channel, expires_at: expiresAt, created_at: now.toISOString() });
    if (!error) return { code, expiresAt };
    // 23505: someone else holds this code right now — draw another.
    if ((error as { code?: string }).code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not create a link code. Try again.");
}

/**
 * Use a code: valid, unexpired and for this channel → whose it was, and the
 * code is gone. Anything else → null. Deleting is the claim, so a code can
 * only ever be used once, even by two chats at the same moment.
 */
export async function consumeLinkCode(admin: Admin, code: string, channel: Channel, now = new Date()): Promise<{ userId: string } | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const { data, error } = await admin
    .from(CODES)
    .delete()
    .eq("code", code)
    .eq("channel", channel)
    .gt("expires_at", now.toISOString())
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const userId = (data as { user_id?: string } | null)?.user_id;
  return userId ? { userId } : null;
}

/** What to tell the person: exactly what to send, and where. */
export function linkInstructions(channel: Channel, code: string): Pick<LinkCodeResponse, "instructions" | "command" | "to" | "url"> {
  const command = `link ${code}`;
  if (channel === "telegram") {
    const bot = telegramBotUsername();
    return {
      command,
      to: `@${bot}`,
      instructions: `Send  ${command}  to @${bot}`,
      // Opens the bot; its Start button sends "/start <code>", which links too.
      url: /^\w{3,64}$/.test(bot) ? `https://t.me/${bot}?start=${code}` : null,
    };
  }
  const number = whatsappDisplayNumber();
  const digits = number.replace(/\D/g, "");
  return {
    command,
    to: number,
    instructions: `Send  ${command}  to ${number}`,
    url: digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(command)}` : null,
  };
}

/* ------------------------------------------------------------------ links */

export async function findLink(admin: Admin, channel: Channel, externalId: string): Promise<ChannelLink | null> {
  const { data, error } = await admin.from(LINKS).select(LINK_COLUMNS).eq("channel", channel).eq("external_id", externalId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ChannelLink | null) ?? null;
}

/**
 * Link (or re-link) a chat to a person. A chat belongs to one person at a
 * time: linking it again replaces the earlier link. Their phone conversation
 * carries over only when it stays with the same person.
 */
export async function saveLink(
  admin: Admin,
  input: { userId: string; channel: Channel; externalId: string; label: string | null; conversationId: string | null; now?: Date },
): Promise<ChannelLink> {
  const at = (input.now ?? new Date()).toISOString();
  const { data, error } = await admin
    .from(LINKS)
    .upsert(
      {
        user_id: input.userId,
        channel: input.channel,
        external_id: input.externalId,
        label: input.label,
        conversation_id: input.conversationId,
        active: true,
        created_at: at,
        last_seen_at: at,
      },
      { onConflict: "channel,external_id" },
    )
    .select(LINK_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the link");
  return data as ChannelLink;
}

export async function updateLink(admin: Admin, id: string, patch: Partial<Pick<ChannelLink, "active" | "conversation_id" | "last_seen_at" | "label">>): Promise<void> {
  const { error } = await admin.from(LINKS).update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** The person's linked phones, newest first. */
export async function listLinks(admin: Admin, userId: string): Promise<ChannelLinkView[]> {
  const { data, error } = await admin
    .from(LINKS)
    .select(LINK_COLUMNS)
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChannelLink[]).map((l) => ({ id: l.id, channel: l.channel, label: l.label, linkedAt: l.created_at, lastSeenAt: l.last_seen_at }));
}

/** Unlink one of the person's own phones. Returns the removed link, or null when it is not theirs. */
export async function deleteLink(admin: Admin, userId: string, id: string): Promise<ChannelLink | null> {
  const { data, error } = await admin.from(LINKS).delete().eq("id", id).eq("user_id", userId).select(LINK_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ChannelLink | null) ?? null;
}

/* ------------------------------------------------------- abuse brakes
 * Process-local, like the per-user answer caps in ../runs.ts: production is
 * one Node instance. */

const FAIL_WINDOW_MS = 15 * 60_000;
/** Wrong codes one chat may send per window… */
const MAX_FAILS_PER_CHAT = 5;
/** …and everyone together: guessing one of a million codes stays hopeless. */
const MAX_FAILS_TOTAL = 100;

const failsByChat = new Map<string, number[]>();
let failsTotal: number[] = [];

const recent = (stamps: number[], now: number) => stamps.filter((t) => now - t < FAIL_WINDOW_MS);

/** Too many wrong codes lately — from this chat, or from everyone? */
export function linkAttemptsBlocked(chatKey: string, now = Date.now()): boolean {
  failsTotal = recent(failsTotal, now);
  const mine = recent(failsByChat.get(chatKey) ?? [], now);
  if (mine.length) failsByChat.set(chatKey, mine);
  else failsByChat.delete(chatKey);
  return mine.length >= MAX_FAILS_PER_CHAT || failsTotal.length >= MAX_FAILS_TOTAL;
}

export function noteFailedLinkAttempt(chatKey: string, now = Date.now()): void {
  failsByChat.set(chatKey, [...recent(failsByChat.get(chatKey) ?? [], now), now]);
  failsTotal = [...recent(failsTotal, now), now];
  if (failsByChat.size > 5000) failsByChat.delete(failsByChat.keys().next().value!);
}

const DEDUP_TTL_MS = 60 * 60_000;
const seen = new Map<string, number>();

/**
 * Has this delivery been handled already? Both platforms re-deliver a webhook
 * now and then; one message must not get two answers (or confirm twice).
 */
export function alreadySeen(key: string, now = Date.now()): boolean {
  for (const [k, t] of seen) {
    if (now - t < DEDUP_TTL_MS && seen.size <= 5000) break;
    seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

/** TESTS ONLY. */
export function resetChannelBrakes(): void {
  failsByChat.clear();
  failsTotal = [];
  seen.clear();
}
