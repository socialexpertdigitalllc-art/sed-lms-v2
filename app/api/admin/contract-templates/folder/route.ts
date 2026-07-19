import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { normalizeFolderId } from "@/lib/google/drive";

export const runtime = "nodejs";

const schema = z.object({
  folder_id: z.string().trim().max(500),
  /** Optional — where generated contract copies are created. Omitted = unchanged. */
  generated_folder_id: z.string().trim().max(500).optional(),
});

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  // Accept a pasted Drive URL as well as a bare id.
  const folderId = normalizeFolderId(parsed.data.folder_id) || null;
  const generatedFolderId =
    parsed.data.generated_folder_id === undefined ? undefined : normalizeFolderId(parsed.data.generated_folder_id) || null;

  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").upsert(
    {
      singleton: true,
      contract_templates_folder_id: folderId,
      ...(generatedFolderId === undefined ? {} : { generated_contracts_folder_id: generatedFolderId }),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    contract_templates_folder_id: folderId,
    ...(generatedFolderId === undefined ? {} : { generated_contracts_folder_id: generatedFolderId }),
  });
}
