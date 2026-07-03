import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getImportConfig } from "@/lib/import/config";
import { z } from "zod";

export const runtime = "nodejs";

async function requireImport() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 as const };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.import")) return { error: 403 as const };
  return { userId: user.id };
}

export async function GET() {
  const auth = await requireImport();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  return NextResponse.json({ config: await getImportConfig() });
}

const schema = z.object({
  sheet_id: z.string().trim().min(1),
  sheet_tab: z.string().trim().min(1),
  mapping: z.record(z.string(), z.string()),
});

export async function PUT(req: Request) {
  const auth = await requireImport();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid config" }, { status: 422 });
  const admin = createAdminClient();
  const { error } = await admin.from("import_config").upsert(
    { singleton: true, ...parsed.data, updated_at: new Date().toISOString(), updated_by: auth.userId },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
