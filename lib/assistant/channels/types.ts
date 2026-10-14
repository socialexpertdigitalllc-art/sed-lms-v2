/**
 * SED AI on the phone: Telegram and WhatsApp chats linked to a person's
 * assistant. Pure types and labels — safe to import from client components.
 */

export const CHANNELS = ["telegram", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
};

/** A link code works this long after it is created. */
export const LINK_CODE_TTL_MS = 10 * 60_000;

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

/** One message that arrived from a chat, already authenticated as coming from the platform. */
export interface InboundMessage {
  channel: Channel;
  /** Telegram chat id / WhatsApp number (wa_id, digits only). */
  externalId: string;
  /** The platform's id for this delivery — duplicates are dropped by it. */
  messageId: string;
  /** The text, or null for something that is not text (a photo, a voice note). */
  text: string | null;
  /** How the chat is shown in the app: "@sam" / "+923001234567". */
  label: string | null;
}

/** A linked phone as the in-app list shows it. */
export interface ChannelLinkView {
  id: string;
  channel: Channel;
  label: string | null;
  linkedAt: string;
  lastSeenAt: string | null;
}

/** GET /api/assistant/channels */
export interface ChannelsResponse {
  links: ChannelLinkView[];
  /** Which channels this server has the platform keys for. */
  configured: Record<Channel, boolean>;
}

/** POST /api/assistant/channels */
export interface LinkCodeResponse {
  channel: Channel;
  code: string;
  expiresAt: string;
  /** "Send  link 123456  to @SedAiBot" */
  instructions: string;
  /** What to send: "link 123456". */
  command: string;
  /** Where to send it: "@SedAiBot" / "+92 300 1234567". */
  to: string;
  /** Opens the chat with the code filled in (t.me / wa.me), when one can be built. */
  url: string | null;
}
