import { NextResponse, after } from "next/server";
import { telegramToken, telegramWebhookSecret } from "@/lib/assistant/channels/config";
import { handleInbound } from "@/lib/assistant/channels/handle";
import { parseTelegramUpdate } from "@/lib/assistant/channels/parse";
import { verifyTelegramSecret } from "@/lib/assistant/channels/verify";

export const runtime = "nodejs";
// The answer is worked out after the response (an act-mode answer can take
// minutes; it is stopped at five).
export const maxDuration = 600;

/**
 * Telegram's webhook (set with setWebhook + secret_token — see
 * docs/assistant-phone-channel.md). PUBLIC: no session, authenticated by the
 * secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token.
 *
 * Answers 200 at once — Telegram re-sends anything it does not get a quick
 * 2xx for — and does the work in after().
 */
export async function POST(req: Request) {
  const secret = telegramWebhookSecret();
  if (!secret || !telegramToken()) return NextResponse.json({ error: "Telegram is not set up on this server." }, { status: 503 });
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const message = parseTelegramUpdate(update);
  if (message) after(() => handleInbound(message));
  return NextResponse.json({ ok: true });
}
