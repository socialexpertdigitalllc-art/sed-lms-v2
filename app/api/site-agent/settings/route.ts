// app/api/site-agent/settings/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { parseDefaults } from "@/lib/site-agent/options";
import { agentPanelContext, canConfigureAgent, saveAgentDefaults } from "@/lib/site-agent/settings";
import { resolveModelChoice } from "@/lib/site-agent/workerStatus";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Everyone who can send work to the AI developer may READ its settings (the
 *  send dialog starts from them); changing them is for operators and admins. */
const READ_PERMS = ["studio.manage", "tickets.resolve", "admin.settings.manage"];

async function viewer(): Promise<{ userId: string; perms: Set<string> } | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!READ_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { userId: user.id, perms };
}

/** GET — the team defaults, the worker's models, and per-model timing. */
export async function GET() {
  const who = await viewer();
  if (who instanceof NextResponse) return who;
  return NextResponse.json(await agentPanelContext(createAdminClient(), who.perms));
}

/** PUT {model, speed, time_limit_min, retries, site_map, house_rules} — the
 *  team defaults every send starts from. The whole object is replaced: a
 *  field left out goes back to the built-in default. */
export async function PUT(req: Request) {
  const who = await viewer();
  if (who instanceof NextResponse) return who;
  if (!canConfigureAgent(who.perms)) {
    return NextResponse.json({ error: "Only operators and admins can change the AI developer's defaults." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = parseDefaults(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 422 });

  const admin = createAdminClient();
  const model = await resolveModelChoice(admin, (body as { model?: unknown }).model ?? null);
  if (!model.ok) return NextResponse.json({ error: model.message }, { status: 422 });

  const defaults = { ...parsed.value, model: model.model };
  const saved = await saveAgentDefaults(admin, defaults, who.userId);
  if (!saved.ok) return NextResponse.json({ error: saved.message }, { status: saved.status });

  await admin.from("activity_log").insert({
    user_id: who.userId, action: "site_agent.settings.updated", entity_type: "app_settings", entity_id: null,
    new_value: { ...defaults, house_rules: defaults.house_rules ? `${defaults.house_rules.length} chars` : null },
  });
  return NextResponse.json({ defaults });
}
