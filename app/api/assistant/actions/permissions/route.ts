import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { clampMode, MODE_RANK, modeInfo, PERMISSION_MODES } from "@/lib/assistant/actions/permissions";
import { getActPermissions, getPermissionCap, updateActPermissions } from "@/lib/assistant/actions/permissionStore";
import { getActionDef } from "@/lib/assistant/actions/registry";

export const runtime = "nodejs";

/**
 * A person's permission mode for Act — how much SED AI does without a click —
 * and the actions they said "don't ask again" for. Each person sets their
 * own, never above the company limit an admin sets (actions/settings).
 */

async function view(ctx: { admin: SupabaseClient; userId: string }) {
  const [saved, cap] = await Promise.all([getActPermissions(ctx.admin, ctx.userId), getPermissionCap(ctx.admin)]);
  return {
    mode: saved.mode,
    /** What actually applies (the saved mode, lowered to the company limit). */
    effective: clampMode(saved.mode, cap),
    cap,
    modes: PERMISSION_MODES.map((m) => ({ ...m, allowed: MODE_RANK[m.mode] <= MODE_RANK[cap] })),
    allow: saved.allow.map((key) => {
      const def = getActionDef(key);
      return { key, title: def?.title ?? key, group: def?.group ?? "" };
    }),
  };
}

export async function GET() {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await view(guard.value.ctx));
  } catch (e) {
    return actionError(e, "Could not load your permission mode.");
  }
}

const key = z.string().min(3).max(80);
const putSchema = z
  .object({
    mode: z.enum(["ask", "auto_safe", "auto"]).optional(),
    allow_add: key.optional(),
    allow_remove: key.optional(),
    allow_clear: z.literal(true).optional(),
  })
  .refine((b) => b.mode || b.allow_add || b.allow_remove || b.allow_clear, { message: "Nothing to change." });

export async function PUT(req: Request) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  const b = parsed.data;
  try {
    if (b.mode) {
      const cap = await getPermissionCap(ctx.admin);
      if (MODE_RANK[b.mode] > MODE_RANK[cap]) {
        return NextResponse.json({ error: `Your company allows at most “${modeInfo(cap).label}”.` }, { status: 403 });
      }
    }
    if (b.allow_add) {
      const def = getActionDef(b.allow_add);
      if (!def) return NextResponse.json({ error: "Unknown action." }, { status: 404 });
      if (def.risk === "critical") {
        return NextResponse.json({ error: "High-impact changes always ask — they can't be set to run on their own." }, { status: 422 });
      }
    }
    await updateActPermissions(ctx.admin, ctx.userId, {
      mode: b.mode,
      allowAdd: b.allow_add,
      allowRemove: b.allow_remove,
      allowClear: b.allow_clear,
    });
    await ctx.admin.from("activity_log").insert({
      user_id: ctx.userId,
      action: "assistant.permission_mode_changed",
      entity_type: "assistant_action",
      new_value: {
        ...(b.mode ? { mode: b.mode } : {}),
        ...(b.allow_add ? { always_allow: b.allow_add } : {}),
        ...(b.allow_remove ? { stop_allowing: b.allow_remove } : {}),
        ...(b.allow_clear ? { cleared: true } : {}),
      },
    });
    return NextResponse.json(await view(ctx));
  } catch (e) {
    return actionError(e, "Could not save your permission mode.");
  }
}
