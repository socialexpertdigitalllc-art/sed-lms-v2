import { createClient } from "@/lib/supabase/server";
import { UserTable } from "@/components/admin/UserTable";
import { CreateUserDialog } from "@/components/admin/CreateUserDialog";

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select(
      "id, email, username, display_name, is_active, created_at, department_members!department_members_user_id_fkey(departments(name, color))"
    )
    .order("created_at", { ascending: false });
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-text">Users</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {users?.length ?? 0} users
          </p>
        </div>
        <CreateUserDialog departments={departments ?? []} />
      </div>
      <UserTable users={users ?? []} />
    </div>
  );
}
