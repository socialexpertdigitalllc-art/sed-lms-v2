import type { InboundMessage } from "./types";

/**
 * Reading what arrives from a phone. PURE.
 *
 * The person's text is only ever classified here — a link code, a YES/NO to a
 * proposal, or a message for the assistant — and never interpreted any
 * further: a message goes to the assistant word for word, as theirs.
 */

export type InboundCommand =
  /** "link 123456", "/link 123456", "/start 123456" (Telegram's deep link). */
  | { kind: "link"; code: string }
  /** A bare six-digit number — a link code when the chat is not linked yet. */
  | { kind: "code"; code: string }
  /** Telegram's "/start" with nothing after it. */
  | { kind: "start" }
  /** "yes", "ok", "haan", "confirm 2"… — `n` is the proposal's number in the last reply. */
  | { kind: "confirm"; n: number | null }
  /** "no", "cancel 2"… */
  | { kind: "cancel"; n: number | null }
  | { kind: "message" };

const CONFIRM_WORDS = ["yes", "confirm", "ok", "okay", "haan", "haa", "han"];
const CANCEL_WORDS = ["no", "cancel", "nope", "nahi", "nahin"];

const decisionRe = (words: string[]) => new RegExp(`^(?:${words.join("|")})\\s*[,#:]?\\s*#?(\\d{1,2})?$`);
const CONFIRM_RE = decisionRe(CONFIRM_WORDS);
const CANCEL_RE = decisionRe(CANCEL_WORDS);
const LINK_RE = /^\/?(?:start|link)(?:@\w+)?[\s:]+(\d[\d\s-]*\d)$/;
const START_RE = /^\/start(?:@\w+)?$/;

/** Lower-cased, single-spaced, without the punctuation people end a short reply with. */
function normalise(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
}

export function parseCommand(raw: string): InboundCommand {
  const text = normalise(raw);
  if (!text) return { kind: "message" };

  const link = LINK_RE.exec(text);
  if (link) return { kind: "link", code: link[1].replace(/\D/g, "") };
  if (START_RE.test(text)) return { kind: "start" };
  if (/^\d{3}[\s-]?\d{3}$/.test(text)) return { kind: "code", code: text.replace(/\D/g, "") };

  const yes = CONFIRM_RE.exec(text);
  if (yes) return { kind: "confirm", n: yes[1] ? Number(yes[1]) : null };
  const no = CANCEL_RE.exec(text);
  if (no) return { kind: "cancel", n: no[1] ? Number(no[1]) : null };
  return { kind: "message" };
}

export const isLinkCode = (code: string) => /^\d{6}$/.test(code);

/**
 * Did they type a critical action's confirmation words? Compared the way
 * confirmAction compares them (trimmed, case-insensitive), forgiving the
 * quotes our instruction shows the phrase in and a trailing full stop.
 */
export function matchesPhrase(raw: string, phrase: string | null | undefined): boolean {
  const want = (phrase ?? "").trim().toLowerCase();
  if (!want) return false;
  const typed = raw.replace(/\s+/g, " ").trim();
  // “Jumbo's Pizza”. → Jumbo's Pizza — peel quotes and the full stop in any order.
  let bare = typed;
  for (let prev = ""; prev !== bare; ) {
    prev = bare;
    bare = bare.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.!]+$/, "").trim();
  }
  return [typed, bare].some((v) => v.toLowerCase() === want);
}

/* ------------------------------------------------------------- Telegram */

interface TelegramUser {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: TelegramUser;
    chat?: { id?: number | string; type?: string };
    text?: string;
  };
}

/**
 * One Telegram update → the message in it, or null for anything SED AI does
 * not answer: edits, channel posts, membership changes, other bots — and any
 * chat that is not a private one-to-one chat (a linked group would let
 * everyone in it act as the person who linked it).
 */
export function parseTelegramUpdate(update: unknown): InboundMessage | null {
  if (!update || typeof update !== "object") return null;
  const u = update as TelegramUpdate;
  const m = u.message;
  if (!m || typeof m !== "object" || !m.chat || m.chat.type !== "private") return null;
  if (m.from?.is_bot) return null;
  const chatId = m.chat.id;
  if (typeof chatId !== "number" && typeof chatId !== "string") return null;
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ").trim();
  const label = m.from?.username ? `@${m.from.username}` : name || null;
  return {
    channel: "telegram",
    externalId: String(chatId),
    messageId: String(u.update_id ?? `${chatId}:${m.message_id ?? ""}`),
    text: typeof m.text === "string" ? m.text : null,
    label: label ? label.slice(0, 120) : null,
  };
}

/* ------------------------------------------------------------- WhatsApp */

interface WhatsAppMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

interface WhatsAppPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WhatsAppMessage[];
      };
    }[];
  }[];
}

/** Things people send that are not text but deserve a "text only" reply. */
const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker", "location", "contacts", "interactive", "button", "order"]);

/**
 * A Cloud API webhook body → the messages in it. Delivery receipts
 * (`statuses`), reactions and system notices are skipped. With
 * `phoneNumberId`, only messages to that business number count — a Meta app
 * subscribed for several numbers sends them all here.
 */
export function parseWhatsAppPayload(payload: unknown, phoneNumberId?: string | null): InboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as WhatsAppPayload;
  if (p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of p.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages" || !change.value) continue;
      const to = change.value.metadata?.phone_number_id;
      if (phoneNumberId && to && to !== phoneNumberId) continue;
      for (const m of Array.isArray(change.value.messages) ? change.value.messages : []) {
        const from = typeof m?.from === "string" ? m.from.replace(/\D/g, "") : "";
        if (!from || typeof m.id !== "string") continue;
        const isText = m.type === "text" && typeof m.text?.body === "string";
        if (!isText && !MEDIA_TYPES.has(m.type ?? "")) continue;
        out.push({
          channel: "whatsapp",
          externalId: from,
          messageId: m.id,
          text: isText ? m.text!.body! : null,
          label: `+${from}`,
        });
      }
    }
  }
  return out;
}
