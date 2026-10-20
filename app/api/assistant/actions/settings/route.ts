import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { ACTION_DEFS, getActionDef } from "@/lib/assistant/actions/registry";
import { getActionSettings, saveActionSetting } from "@/lib/assistant/actions/store";
import { PERMISSION_MODES } from "@/lib/assistant/actions/permissions";
import { getPermissionCap, setPermissionCap } from "@/lib/assistant/actions/permissionStore";

export const runtime = "nodejs";

/**
 * The rollout switches: every action SED AI can take, whether it is on,
 * whether it always needs an approver, and whether it may ever run without a
 * click — plus the most autonomy (permission mode) anyone may pick. Who may use action mode at all is the
 * assistant.act permission (granted per department or person, optionally until
 * a date, on the usual permission screens).
 */

export async function GET() {
  const guard = await actionGuard({ manage: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  try {
    const settings = await getActionSettings(ctx.admin);
    const [{ data: grants }, { data: overrides }] = await Promise.all([
      ctx.admin.from("department_permissions").select("departments(id, name)").eq("permission_key", "assistant.act"),
      ctx.admin.from("user_permission_overrides").select("user_id, is_granted, expires_at, profiles!user_permission_overrides_user_id_fkey(display_name)").eq("permission_key", "assistant.act"),
    ]);
    const departments = ((grants ?? []) as { departments: { id: string; name: string } | { id: string; name: string }[] | null }[])
      .map((g) => (Array.isArray(g.departments) ? g.departments[0] : g.departments))
      .filter((d): d is { id: string; name: string } => Boolean(d));
    const people = ((overrides ?? []) as { user_id: string; is_granted: boolean; expires_at: string | null; profiles: { display_name: string | null } | { display_name: string | null }[] | null }[]).map((o) => {
      const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
      return { id: o.user_id, name: p?.display_name ?? "Someone", granted: o.is_granted, until: o.expires_at };
    });
    return NextResponse.json({
      actions: ACTION_DEFS.map((d) => ({
        key: d.key,
        title: d.title,
        group: d.group,
        risk: typeof d.risk === "function" ? "varies" : d.risk,
        enabled: settings.get(d.key)?.enabled ?? true,
        require_approval: settings.get(d.key)?.require_approval ?? false,
        auto_run: settings.get(d.key)?.auto_run ?? true,
      })),
      access: { departments, people },
      // The most autonomy anyone may pick for Act (see lib/assistant/actions/permissions.ts).
      policy: { max_mode: await getPermissionCap(ctx.admin), modes: PERMISSION_MODES },
    });
  } catch (e) {
    return actionError(e, "Could not load the settings.");
  }
}

const putSchema = z.union([
  z
    .object({
      key: z.string().min(3).max(80),
      enabled: z.boolean().optional(),
      require_approval: z.boolean().optional(),
      /** false: never runs on its own, whatever a person's permission mode. */
      auto_run: z.boolean().optional(),
    })
    .refine((b) => b.enabled !== undefined || b.require_approval !== undefined || b.auto_run !== undefined, { message: "Nothing to change." }),
  z.object({ max_mode: z.enum(["ask", "auto_safe", "auto"]) }),
]);

export async function PUT(req: Request) {
  const guard = await actionGuard({ manage: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  if ("max_mode" in parsed.data) {
    try {
      await setPermissionCap(ctx.admin, parsed.data.max_mode);
      await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "assistant.action_setting_changed", entity_type: "assistant_action", new_value: { max_permission_mode: parsed.data.max_mode } });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return actionError(e, "Could not save the limit.");
    }
  }
  const def = getActionDef(parsed.data.key);
  if (!def) return NextResponse.json({ error: "Unknown action." }, { status: 404 });
  try {
    const d = parsed.data;
    const patch = {
      ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      ...(d.require_approval !== undefined ? { require_approval: d.require_approval } : {}),
      ...(d.auto_run !== undefined ? { auto_run: d.auto_run } : {}),
    };
    await saveActionSetting(ctx.admin, def.key, patch, ctx.userId);
    await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "assistant.action_setting_changed", entity_type: "assistant_action", new_value: { key: def.key, ...patch } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return actionError(e, "Could not save the setting.");
  }
}
