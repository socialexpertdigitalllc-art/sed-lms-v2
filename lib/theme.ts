/**
 * Light / dark theme, shared by the server (which stamps `<html data-theme>`
 * before the first byte is sent) and the toggle in the header.
 *
 * WHY A COOKIE, not `ui_preferences` like density and the sidebar pin: the
 * theme has to be known while the HTML is being generated, on EVERY page
 * including /login and the marketing site, where there is no profile to read.
 * A cookie is the only store the server sees that early, which is what makes
 * the switch flash-free. It also makes the theme per-device, which is the
 * honest model for one: the same person wants dark on a laptop at night and
 * light on an office monitor at noon.
 *
 * "system" is represented by the ABSENCE of the attribute, never by a value:
 * `app/globals.css` resolves it with `prefers-color-scheme`, so the server
 * never has to guess what the OS is set to.
 */

export const THEME_COOKIE = "sed-theme";

/** A user's stored choice. "system" is the default and stores nothing. */
export type ThemeChoice = "light" | "dark" | "system";

/** What is actually painted — what "system" resolves to at render time. */
export type ResolvedTheme = "light" | "dark";

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * The value for `<html data-theme>`: null for "system" so the stylesheet's
 * `prefers-color-scheme` branch takes over. Returning "" or "system" instead
 * would pin the page to light on a dark-mode OS.
 */
export function themeAttr(choice: ThemeChoice): ResolvedTheme | null {
  return choice === "system" ? null : choice;
}

/** A year — the theme is a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** The `document.cookie` string for a choice. `SameSite=Lax` so it rides
 *  ordinary navigations; no `Secure` flag, so it works on localhost too. */
export function themeCookieValue(choice: ThemeChoice): string {
  return `${THEME_COOKIE}=${choice}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}
