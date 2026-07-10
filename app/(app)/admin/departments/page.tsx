import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import Link from "next/link";
import { NewDepartmentForm } from "@/components/admin/NewDepartmentForm";

export default async function DepartmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const canManage = perms.has("admin.departments.manage");

  const { data: depts } = await supabase
    .from("departments")
    .select("id, name, slug, color, description, department_members(count), department_permissions(count)")
    .order("name");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">Departments</h1>
        {canManage && <NewDepartmentForm />}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(depts ?? []).map((d: any) => (
          <Link
            key={d.id}
            href={`/admin/departments/${d.id}`}
            className="bg-surface border border-border rounded-lg p-4 hover:border-accent transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm" style={{ background: d.color }} />
              <span className="font-medium text-text">{d.name}</span>
            </div>
            {d.description && (
              <p className="text-xs text-text-muted mt-2 line-clamp-2">{d.description}</p>
            )}
            <div className="mt-3 text-xs text-text-faint font-mono">
              {d.department_members?.[0]?.count ?? 0} members ·{" "}
              {d.department_permissions?.[0]?.count ?? 0} perms
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
