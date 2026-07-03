import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.permissions.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { permissionKey, enabled } = await req.json();
  const admin = createAdminClient();

  if (enabled) {
    await admin
      .from("department_permissions")
      .upsert(
        { department_id: id, permission_key: permissionKey, granted_by: user.id },
        { onConflict: "department_id,permission_key" }
      );
  } else {
    await admin
      .from("department_permissions")
      .delete()
      .eq("department_id", id)
      .eq("permission_key", permissionKey);
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: enabled ? "dept.permission.granted" : "dept.permission.revoked",
    entity_type: "department",
    entity_id: id,
    new_value: { permissionKey, enabled },
  });

  return NextResponse.json({ ok: true });
}
