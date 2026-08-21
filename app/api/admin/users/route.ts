import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createUserSchema } from "@/lib/admin/createUserSchema";
import { invalidateUserDirectory } from "@/lib/users/directory";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.users.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { email, username, fullName, displayName, tempPassword, departmentIds } = parsed.data;

  const admin = createAdminClient();

  // username uniqueness check (before creating the auth user, to avoid orphans)
  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 422 });
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (error || !created.user) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  const uid = created.user.id;
  const { error: profileErr } = await admin.from("profiles").insert({
    id: uid,
    email,
    username,
    full_name: fullName,
    display_name: displayName,
    created_by: user.id,
  });
  if (profileErr) {
    // roll back the auth user if the profile insert fails
    await admin.auth.admin.deleteUser(uid);
    return NextResponse.json({ error: profileErr.message }, { status: 400 });
  }

  await admin.from("department_members").insert(
    departmentIds.map((d) => ({ user_id: uid, department_id: d, added_by: user.id }))
  );
  invalidateUserDirectory(); // a new colleague must appear in name lookups now
  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "user.created",
    entity_type: "user",
    entity_id: uid,
    new_value: { email, departmentIds },
  });

  return NextResponse.json({ id: uid }, { status: 201 });
}
