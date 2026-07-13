import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isKnownPermissionKey } from "@/lib/permissions/constants";

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

  const { permissionKey, isGranted, remove } = await req.json();
  if (!isKnownPermissionKey(permissionKey)) {
    return NextResponse.json({ error: "Unknown permission key" }, { status: 422 });
  }
  const admin = createAdminClient();

  if (remove) {
    await admin
      .from("user_permission_overrides")
      .delete()
      .eq("user_id", id)
      .eq("permission_key", permissionKey);
  } else {
    await admin.from("user_permission_overrides").upsert(
      { user_id: id, permission_key: permissionKey, is_granted: isGranted, granted_by: user.id },
      { onConflict: "user_id,permission_key" }
    );
  }

  return NextResponse.json({ ok: true });
}
