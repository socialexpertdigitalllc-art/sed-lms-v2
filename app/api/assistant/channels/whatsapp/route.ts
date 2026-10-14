import { NextResponse, after } from "next/server";
import { whatsappAppSecret, whatsappPhoneNumberId, whatsappToken, whatsappVerifyToken } from "@/lib/assistant/channels/config";
import { handleInboundAll } from "@/lib/assistant/channels/handle";
import { parseWhatsAppPayload } from "@/lib/assistant/channels/parse";
import { verifyWhatsAppSignature, whatsAppChallenge } from "@/lib/assistant/channels/verify";

export const runtime = "nodejs";
// The answer is worked out after the response (an act-mode answer can take
// minutes; it is stopped at five).
export const maxDuration = 600;

/**
 * The WhatsApp Cloud API webhook (Meta app → WhatsApp → Configuration — see
 * docs/assistant-phone-channel.md). PUBLIC: no session.
 *
 * GET is Meta's one-time check of the callback URL (hub.verify_token must
 * match WHATSAPP_VERIFY_TOKEN). POST carries messages, signed with the app
 * secret in X-Hub-Signature-256; it answers 200 at once — Meta re-sends
 * anything it does not get a quick 2xx for — and does the work in after().
 */

export async function GET(req: Request) {
  const challenge = whatsAppChallenge(new URL(req.url).searchParams, whatsappVerifyToken());
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(req: Request) {
  const appSecret = whatsappAppSecret();
  if (!appSecret || !whatsappToken() || !whatsappPhoneNumberId()) {
    return NextResponse.json({ error: "WhatsApp is not set up on this server." }, { status: 503 });
  }
  // The signature covers the bytes exactly as sent.
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true });
  }
  const messages = parseWhatsAppPayload(payload, whatsappPhoneNumberId());
  if (messages.length) after(() => handleInboundAll(messages));
  return NextResponse.json({ ok: true });
}
