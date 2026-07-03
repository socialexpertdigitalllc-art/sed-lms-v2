import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";
import { DEFAULT_WGE_CONFIG } from "@/lib/ai-tools/wge-defaults";

export const runtime = "nodejs";

export async function POST() {
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  const { error } = await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: DEFAULT_WGE_CONFIG.system_prompt,
      prompt_template: DEFAULT_WGE_CONFIG.prompt_template,
      variables: DEFAULT_WGE_CONFIG.variables,
      settings: DEFAULT_WGE_CONFIG.settings,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "wge.config.reset",
    entity_type: "wge_config",
  });
  return NextResponse.json({ ok: true });
}
