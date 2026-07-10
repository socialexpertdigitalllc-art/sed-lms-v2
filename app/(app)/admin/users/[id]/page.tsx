import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { UserManager } from "@/components/admin/UserManager";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/common/BackLink";

export default async function UserDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, username, display_name, full_name, is_active")
    .eq("id", id)
    .single();
  if (!profile) notFound();

  const { data: allDepts } = await supabase.from("departments").select("id, name").order("name");
  const { data: memberships } = await supabase
    .from("department_members")
    .select("department_id")
    .eq("user_id", id);
  const { data: allPerms } = await supabase
    .from("permissions")
    .select("key, name, category")
    .order("category");
  const { data: overrides } = await supabase
    .from("user_permission_overrides")
    .select("permission_key, is_granted")
    .eq("user_id", id);

  // department-granted keys for this user (the inherited baseline)
  const deptIds = (memberships ?? []).map((m) => m.department_id);
  let deptGranted: string[] = [];
  if (deptIds.length > 0) {
    const { data: dp } = await supabase
      .from("department_permissions")
      .select("permission_key")
      .in("department_id", deptIds);
    deptGranted = [...new Set((dp ?? []).map((r) => r.permission_key))];
  }

  const effective = [...(await getUserPermissions(id))];

  return (
    <div className="max-w-3xl">
      <BackLink href="/admin/users" label="Users" />
      <h1 className="text-xl font-semibold text-text mt-2">
        {profile.display_name ?? profile.email}
      </h1>
      <p className="text-sm text-text-muted mb-6">{profile.email}</p>

      <UserManager
        userId={id}
        email={profile.email}
        username={profile.username}
        isSelf={currentUser?.id === id}
        isActive={profile.is_active}
        allDepartments={allDepts ?? []}
        currentDeptIds={deptIds}
        allPermissions={allPerms ?? []}
        deptGranted={deptGranted}
        overrides={(overrides ?? []).map((o) => ({
          permission_key: o.permission_key,
          is_granted: o.is_granted,
        }))}
        effective={effective}
      />
    </div>
  );
}
