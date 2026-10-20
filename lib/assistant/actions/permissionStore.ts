import type { SupabaseClient } from "@supabase/supabase-js";
import { isPermissionMode, parseActPermissions, MAX_ALWAYS_ALLOWED, type ActPermissions, type PermissionMode } from "./permissions";

/**
 * Where permission modes live. SERVER ONLY — service-role client.
 *
 *  - A person's mode and "don't ask again" list: profiles.ui_preferences
 *    .assistantPermissions (written only through the validated
 *    /api/assistant/actions/permissions route).
 *  - The company's limit: app_settings.assistant_max_permission_mode
 *    (migration 0090). Until that exists every mode is available — and each
 *    person still starts in Ask.
 */

type Admin = SupabaseClient;

const PREF_KEY = "assistantPermissions";

let capCache: { at: number; cap: PermissionMode } | null = null;
const CAP_TTL_MS = 15_000;

/** The most autonomy anyone in the company may choose. Cached briefly; never throws. */
export async function getPermissionCap(admin: Admin): Promise<PermissionMode> {
  if (capCache && Date.now() - capCache.at < CAP_TTL_MS) return capCache.cap;
  let cap: PermissionMode = "auto";
  try {
    const { data, error } = await admin.from("app_settings").select("assistant_max_permission_mode").eq("singleton", true).maybeSingle();
    const v = (data as { assistant_max_permission_mode?: unknown } | null)?.assistant_max_permission_mode;
    if (!error && isPermissionMode(v)) cap = v;
  } catch {
    /* keep the default */
  }
  capCache = { at: Date.now(), cap };
  return cap;
}

export async function setPermissionCap(admin: Admin, cap: PermissionMode): Promise<void> {
  const { error } = await admin.from("app_settings").update({ assistant_max_permission_mode: cap }).eq("singleton", true);
  if (error) throw new Error(error.message);
  capCache = null;
}

export function clearPermissionCapCache() {
  capCache = null;
}

async function preferences(admin: Admin, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("profiles").select("ui_preferences").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const p = (data as { ui_preferences?: unknown } | null)?.ui_preferences;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** What this person chose (Ask, nothing always allowed, when they never chose). */
export async function getActPermissions(admin: Admin, userId: string): Promise<ActPermissions> {
  try {
    return parseActPermissions((await preferences(admin, userId))[PREF_KEY]);
  } catch {
    return parseActPermissions(null);
  }
}

/** Change this person's mode and/or "don't ask again" list. Returns the new value. */
export async function updateActPermissions(
  admin: Admin,
  userId: string,
  change: { mode?: PermissionMode; allowAdd?: string; allowRemove?: string; allowClear?: boolean },
): Promise<ActPermissions> {
  const prefs = await preferences(admin, userId);
  const current = parseActPermissions(prefs[PREF_KEY]);
  let allow = change.allowClear ? [] : current.allow.filter((k) => k !== change.allowRemove);
  if (change.allowAdd && !allow.includes(change.allowAdd)) allow = [...allow, change.allowAdd].slice(-MAX_ALWAYS_ALLOWED);
  const next: ActPermissions = { mode: change.mode ?? current.mode, allow };
  const { error } = await admin.from("profiles").update({ ui_preferences: { ...prefs, [PREF_KEY]: next } }).eq("id", userId);
  if (error) throw new Error(error.message);
  return next;
}
