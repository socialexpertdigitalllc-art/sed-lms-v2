import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getWgeConfig, assertWgeManage, AI_TOOLS_PERMS } from "@/lib/ai-tools/wge";
import { wgeConfigSchema } from "@/lib/ai-tools/wge-schema";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!AI_TOOLS_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ config: await getWgeConfig() });
}

export async function PUT(req: Request) {
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const parsed = wgeConfigSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid config", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: parsed.data.system_prompt,
      prompt_template: parsed.data.prompt_template,
      variables: parsed.data.variables,
      settings: parsed.data.settings,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "wge.config.updated",
    entity_type: "wge_config",
  });
  return NextResponse.json({ ok: true });
}
