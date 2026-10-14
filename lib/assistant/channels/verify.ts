import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proving a webhook call really came from Telegram or Meta. SERVER ONLY.
 * Every comparison is constant-time, so the secret cannot be guessed from how
 * long a wrong one takes to refuse.
 */

/** Constant-time string equality — also for strings of different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Telegram sends the secret_token given to setWebhook in
 * X-Telegram-Bot-Api-Secret-Token. No secret configured = nothing passes.
 */
export function verifyTelegramSecret(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  return safeEqual(header, secret);
}

/**
 * Meta signs the exact request body: X-Hub-Signature-256 = "sha256=" +
 * HMAC-SHA256(body, app secret), hex. The body must be the raw bytes as they
 * arrived — re-serialised JSON would not match.
 */
export function verifyWhatsAppSignature(rawBody: string | Uint8Array, header: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!appSecret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(m[1].toLowerCase(), expected);
}

/**
 * Meta's webhook check (GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…):
 * the challenge to echo back, or null when the token does not match.
 */
export function whatsAppChallenge(params: URLSearchParams, verifyToken: string | null | undefined): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || !verifyToken || !token || !challenge) return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}
