import { telegramToken, whatsappPhoneNumberId, whatsappToken } from "./config";
import { splitMessage } from "./format";
import type { Channel } from "./types";

/**
 * Sending replies to Telegram and WhatsApp. SERVER ONLY.
 *
 * Plain text only, long replies split into several messages. Never logs a
 * token: Telegram's token is part of its URL, so failures are logged by
 * channel, status and the platform's own error words — never the URL, the
 * request, or the raw error object.
 */

const TIMEOUT_MS = 15_000;
export const WHATSAPP_API_VERSION = "v21.0";

export class ChannelSendError extends Error {}

async function post(channel: Channel, url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "could not connect";
    throw new ChannelSendError(`${channel} send ${reason}`);
  }
  if (res.ok) return;
  const json = (await res.json().catch(() => null)) as { description?: unknown; error?: { message?: unknown } } | null;
  const said = typeof json?.description === "string" ? json.description : typeof json?.error?.message === "string" ? json.error.message : "";
  throw new ChannelSendError(`${channel} send failed (HTTP ${res.status})${said ? `: ${said.slice(0, 200)}` : ""}`);
}

/** Telegram Bot API sendMessage — one call per chunk. */
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = telegramToken();
  if (!token) throw new ChannelSendError("Telegram is not configured.");
  for (const chunk of splitMessage(text)) {
    await post("telegram", `https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
      // The current name of the same switch (Bot API 7+); the old one is still honoured.
      link_preview_options: { is_disabled: true },
    });
  }
}

/** WhatsApp Cloud API text message — one call per chunk. */
export async function sendWhatsApp(to: string, text: string): Promise<void> {
  const token = whatsappToken();
  const phoneNumberId = whatsappPhoneNumberId();
  if (!token || !phoneNumberId) throw new ChannelSendError("WhatsApp is not configured.");
  for (const chunk of splitMessage(text)) {
    await post(
      "whatsapp",
      `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: chunk } },
      { Authorization: `Bearer ${token}` },
    );
  }
}

/** Send a reply on whichever channel the chat is on. Throws ChannelSendError. */
export async function sendText(channel: Channel, to: string, text: string): Promise<void> {
  if (!text.trim()) return;
  if (channel === "telegram") await sendTelegram(to, text);
  else await sendWhatsApp(to, text);
}

/**
 * "typing…" while an answer is worked out (Telegram shows it for ~5 seconds
 * per call). Best effort: never throws.
 */
export async function sendTyping(channel: Channel, to: string): Promise<void> {
  if (channel !== "telegram") return;
  const token = telegramToken();
  if (!token) return;
  await post("telegram", `https://api.telegram.org/bot${token}/sendChatAction`, { chat_id: to, action: "typing" }).catch(() => {});
}

/** Blue ticks on WhatsApp: the message reached SED AI. Best effort: never throws. */
export async function markRead(channel: Channel, messageId: string): Promise<void> {
  if (channel !== "whatsapp") return;
  const token = whatsappToken();
  const phoneNumberId = whatsappPhoneNumberId();
  if (!token || !phoneNumberId) return;
  await post(
    "whatsapp",
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    { messaging_product: "whatsapp", status: "read", message_id: messageId },
    { Authorization: `Bearer ${token}` },
  ).catch(() => {});
}
