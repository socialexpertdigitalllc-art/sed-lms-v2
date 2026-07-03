import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { DEFAULT_WGE_CONFIG } from "./wge-defaults";
import type { WgeConfig } from "./wge-types";

export const AI_TOOLS_PERMS = ["ai_tools.webcraft", "ai_tools.deepseek"];

// Read the singleton config; lazily materialise the default row if missing.
// Uses the service-role client so it works both in user requests AND in the
// headless WGE-2 processor (no session) — and always returns the real saved
// row rather than falling back to defaults under RLS.
export async function getWgeConfig(): Promise<WgeConfig> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wge_config")
    .select("system_prompt, prompt_template, variables, settings")
    .eq("singleton", true)
    .maybeSingle();

  if (data) {
    return {
      system_prompt: data.system_prompt,
      prompt_template: data.prompt_template,
      variables: data.variables,
      settings: data.settings,
    } as WgeConfig;
  }

  // seed default row (service role; RLS blocks client writes)
  await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: DEFAULT_WGE_CONFIG.system_prompt,
      prompt_template: DEFAULT_WGE_CONFIG.prompt_template,
      variables: DEFAULT_WGE_CONFIG.variables,
      settings: DEFAULT_WGE_CONFIG.settings,
    },
    { onConflict: "singleton" }
  );
  return DEFAULT_WGE_CONFIG;
}

// WGE management requires wge.manage AND an AI-tools permission.
export async function assertWgeManage(): Promise<{ userId: string } | { error: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const hasAiTools = AI_TOOLS_PERMS.some((p) => perms.has(p));
  if (!perms.has("wge.manage") || !hasAiTools) return { error: 403 };
  return { userId: user.id };
}
