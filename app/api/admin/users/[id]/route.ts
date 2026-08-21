import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { invalidateUserDirectory } from "@/lib/users/directory";

export async function PATCH(
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
  const body = await req.json();
  const admin = createAdminClient();

  if ("isActive" in body) {
    if (!perms.has("admin.users.deactivate")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await admin.from("profiles").update({ is_active: body.isActive }).eq("id", id);
    invalidateUserDirectory();
    await admin.auth.admin.updateUserById(id, {
      ban_duration: body.isActive ? "none" : "876000h",
    });
    await admin.from("activity_log").insert({
      user_id: user.id,
      action: body.isActive ? "user.activated" : "user.deactivated",
      entity_type: "user",
      entity_id: id,
    });
  }

  if ("departmentIds" in body) {
    if (!perms.has("admin.users.edit")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await admin.from("department_members").delete().eq("user_id", id);
    if (Array.isArray(body.departmentIds) && body.departmentIds.length > 0) {
      await admin.from("department_members").insert(
        body.departmentIds.map((d: string) => ({
          user_id: id,
          department_id: d,
          added_by: user.id,
        }))
      );
    }
  }

  if ("password" in body) {
    if (!perms.has("admin.users.edit")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (typeof body.password !== "string" || body.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 422 });
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await admin.from("activity_log").insert({
      user_id: user.id,
      action: "user.password_reset",
      entity_type: "user",
      entity_id: id,
    });
  }

  if ("username" in body) {
    if (!perms.has("admin.users.edit")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const uname = String(body.username ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(uname)) {
      return NextResponse.json({ error: "Username must be 3–30 chars: letters, numbers, . _ -" }, { status: 422 });
    }
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("username", uname)
      .neq("id", id)
      .maybeSingle();
    if (taken) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 422 });
    }
    const { error } = await admin.from("profiles").update({ username: uname }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    invalidateUserDirectory();
    await admin.from("activity_log").insert({
      user_id: user.id,
      action: "user.username_changed",
      entity_type: "user",
      entity_id: id,
      new_value: { username: uname },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.users.delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (id === user.id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const admin = createAdminClient();
  // capture for the audit log before the cascade removes the profile
  const { data: target } = await admin.from("profiles").select("email").eq("id", id).single();

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "user.deleted",
    entity_type: "user",
    entity_id: id,
    old_value: { email: target?.email ?? null },
  });

  return NextResponse.json({ ok: true });
}
