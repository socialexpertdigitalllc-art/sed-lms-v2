import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminMember } from "@/lib/permissions/isAdminMember";
import { getAppSettings } from "@/lib/settings/appSettings";
import { assistantGuard, type AssistantCaller } from "../http";
import { RouteError } from "./invoke";
import { ActionFailure } from "./run";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables } from "./store";
import type { ActionContext } from "./types";

/** Shared plumbing for /api/assistant/actions/*. SERVER ONLY. */

export interface ActionCaller {
  caller: AssistantCaller;
  ctx: ActionContext;
}

/**
 * Signed in, allowed to use the assistant AND its action mode (or, with
 * `manage`, allowed to manage actions) — or the response to return.
 */
export async function actionGuard(opts: { manage?: boolean } = {}): Promise<{ ok: true; value: ActionCaller } | { ok: false; response: NextResponse }> {
  const guard = await assistantGuard();
  if (!guard.ok) return guard;
  const { caller } = guard;
  const key = opts.manage ? "assistant.actions.manage" : "assistant.act";
  if (!caller.perms.has(key)) {
    const msg = opts.manage ? "Your account cannot manage SED AI actions." : "SED AI's action mode is not enabled for your account.";
    return { ok: false, response: NextResponse.json({ error: msg }, { status: 403 }) };
  }
  const admin = createAdminClient();
  const [settings, isAdmin] = await Promise.all([getAppSettings().catch(() => null), isAdminMember(admin, caller.user.id).catch(() => false)]);
  return {
    ok: true,
    value: {
      caller,
      ctx: {
        userId: caller.user.id,
        displayName: caller.displayName,
        perms: caller.perms,
        db: caller.supabase,
        admin,
        timezone: settings?.work_timezone || "Asia/Karachi",
        now: new Date(),
        isAdmin,
      },
    },
  };
}

/** The address people reach the app at (behind the proxy), for links in results. */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto}://${host.split(",")[0].trim()}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  }
}

/** Any failure as a response the card can show. */
export function actionError(e: unknown, fallback = "That could not be done."): NextResponse {
  if (e instanceof ActionFailure) return NextResponse.json({ error: e.message, problems: e.problems ?? [] }, { status: e.status });
  if (e instanceof RouteError) return NextResponse.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
  if (isMissingActionTables(e)) return NextResponse.json({ error: ACTIONS_MIGRATION_MESSAGE }, { status: 503 });
  console.error("[assistant] action route failed:", e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
