import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getTemplateEngineSettings } from "@/lib/template-engine/settings";

async function assertManage(): Promise<{ userId: string } | { error: 401 } | { error: 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await assertManage();
  if ("error" in auth) return guardError(auth.error);
  return NextResponse.json(await getTemplateEngineSettings());
}

const putSchema = z.object({
  system_prompt: z.string().optional(),
  edit_prompt: z.string().optional(),
  image_query_prompt: z.string().optional(),
  max_tokens: z.number().int().min(500).max(32000).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

export async function PUT(req: Request) {
  const auth = await assertManage();
  if ("error" in auth) return guardError(auth.error);

  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const current = await getTemplateEngineSettings();
  const next = { ...current, ...parsed.data };

  const admin = createAdminClient();
  const { error } = await admin
    .from("template_engine_settings")
    .upsert({ singleton: true, ...next, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "template_settings.updated",
    entity_type: "template_engine_settings",
    new_value: {
      max_tokens: next.max_tokens,
      temperature: next.temperature,
      prompts_changed: ["system_prompt", "edit_prompt", "image_query_prompt"].filter(
        (k) => k in parsed.data
      ),
    },
  });

  return NextResponse.json(next);
}
