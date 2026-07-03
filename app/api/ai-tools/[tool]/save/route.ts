import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { TOOLS, isToolId } from "@/lib/ai-tools/config";
import { saveGenerationSchema } from "@/lib/ai-tools/schema";
import { persistGeneration } from "@/lib/ai-tools/run";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isToolId(tool)) return NextResponse.json({ error: "Unknown tool" }, { status: 404 });
  const cfg = TOOLS[tool];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has(cfg.perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = saveGenerationSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const b = parsed.data;

  let result;
  try {
    result = await persistGeneration({
      tool,
      agentId: user.id,
      leadId: b.leadId,
      businessName: b.businessName,
      model: b.model,
      files: b.files,
      tokensUsed: b.tokensUsed,
      totalTimeMs: b.totalTimeMs,
      inputTimeMs: b.inputTimeMs,
      aiTimeMs: b.aiTimeMs,
      pageTypes: b.pageTypes,
      numPages: b.numPages,
      status: b.status,
      errors: b.errors,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin.from("activity_log").insert({
    user_id: user.id,
    action: `ai.${tool}.generated`,
    entity_type: "ai_generation",
    entity_id: result.id,
    new_value: { business_name: b.businessName, files: result.uploaded.length, model: b.model },
  });

  return NextResponse.json({ id: result.id, files: result.uploaded }, { status: 201 });
}
