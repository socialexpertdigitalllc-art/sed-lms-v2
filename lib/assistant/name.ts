/**
 * What the assistant is called, per user, and what it runs on.
 *
 * Every user names their own assistant the first time they open it ("Nova",
 * "Atlas"…). Until they do, it is the SED Assistant. The name lives in
 * `profiles.ui_preferences.assistantName` and is used everywhere that user
 * sees the assistant — header, floating chat, the full page, and how the
 * assistant introduces itself.
 *
 * The model underneath is never shown to end users: to them it is SED AI.
 *
 * PURE — imported by client components and server code alike.
 */

export const DEFAULT_ASSISTANT_NAME = "SED Assistant";

/** The only name end users ever see for the AI underneath. */
export const AI_BRAND = "SED AI";

export const MAX_ASSISTANT_NAME_LENGTH = 32;

export const NAME_SUGGESTIONS = ["Nova", "Atlas", "Aria", "Max", "Sage", "Orion"] as const;

/**
 * A name as typed → the name to keep, or null when there is nothing usable.
 * Whitespace collapses; control characters and markup/prompt punctuation
 * (< > { } [ ] ` " \) are dropped; letters of any script are kept, so an
 * Urdu or Arabic name works as well as an English one.
 */
export function cleanAssistantName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>{}[\]`"\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > MAX_ASSISTANT_NAME_LENGTH) return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned;
}

/** The user's chosen name from their stored preferences, if they chose one. */
export function assistantNameFrom(uiPreferences: unknown): string | null {
  if (!uiPreferences || typeof uiPreferences !== "object" || Array.isArray(uiPreferences)) return null;
  return cleanAssistantName((uiPreferences as Record<string, unknown>).assistantName);
}
