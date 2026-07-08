import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { z } from "zod";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.settings.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

const patchSchema = z.object({
  label: z.string().trim().min(1).optional(),
  price: z.number().nullable().optional(),
  is_active: z.boolean().optional(),
  sort: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_addons")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "addon.updated",
    entity_type: "website_addon",
    entity_id: id,
    new_value: data,
  });

  return NextResponse.json({ addon: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const admin = createAdminClient();
  const { error } = await admin.from("website_addons").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "addon.deleted",
    entity_type: "website_addon",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
