import type { Channel } from "./types";

/**
 * The phone channels' settings, from the environment. SERVER ONLY — the
 * tokens never leave this process: they are read here, used by ./send.ts and
 * the webhook checks, and never logged, echoed or sent to a browser. Only the
 * public parts (the bot's @username, the business number) are shown to people.
 */

type Env = Record<string, string | undefined>;

/** Everything a channel needs before people can link it. */
export const CHANNEL_ENV: Record<Channel, readonly string[]> = {
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_USERNAME"],
  whatsapp: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_DISPLAY_NUMBER"],
};

const val = (env: Env, key: string): string => (env[key] ?? "").trim();

/** The names (never the values) of the settings a channel is still missing. */
export function missingEnv(channel: Channel, env: Env = process.env): string[] {
  return CHANNEL_ENV[channel].filter((k) => !val(env, k));
}

export function isConfigured(channel: Channel, env: Env = process.env): boolean {
  return missingEnv(channel, env).length === 0;
}

/** "SedAiBot" — without the @. */
export function telegramBotUsername(env: Env = process.env): string {
  return val(env, "TELEGRAM_BOT_USERNAME").replace(/^@+/, "");
}

/** The business number as people should see it: "+92 300 1234567". */
export function whatsappDisplayNumber(env: Env = process.env): string {
  return val(env, "WHATSAPP_DISPLAY_NUMBER");
}

/**
 * The address people open the app at — for links in phone replies (and what
 * the actions build their own links on). APP_PUBLIC_URL, else WGE_SELF_ORIGIN.
 */
export function publicOrigin(env: Env = process.env): string {
  const raw = val(env, "APP_PUBLIC_URL") || val(env, "WGE_SELF_ORIGIN") || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export const telegramToken = (env: Env = process.env) => val(env, "TELEGRAM_BOT_TOKEN");
export const telegramWebhookSecret = (env: Env = process.env) => val(env, "TELEGRAM_WEBHOOK_SECRET");
export const whatsappToken = (env: Env = process.env) => val(env, "WHATSAPP_TOKEN");
export const whatsappPhoneNumberId = (env: Env = process.env) => val(env, "WHATSAPP_PHONE_NUMBER_ID");
export const whatsappVerifyToken = (env: Env = process.env) => val(env, "WHATSAPP_VERIFY_TOKEN");
export const whatsappAppSecret = (env: Env = process.env) => val(env, "WHATSAPP_APP_SECRET");
