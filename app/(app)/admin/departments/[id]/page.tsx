import { createClient } from "@/lib/supabase/server";
import { PermissionToggleGrid } from "@/components/admin/PermissionToggleGrid";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export default async function DeptDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from("departments")
    .select("id, name, color, description")
    .eq("id", id)
    .single();
  if (!dept) notFound();

  const { data: perms } = await supabase
    .from("permissions")
    .select("key, name, category, is_sensitive")
    .order("category");
  const { data: granted } = await supabase
    .from("department_permissions")
    .select("permission_key")
    .eq("department_id", id);
  const { data: members } = await supabase
    .from("department_members")
    .select("dept_role, profiles!department_members_user_id_fkey(display_name, email)")
    .eq("department_id", id);

  return (
    <div>
      <Link href="/admin/departments" className="text-xs text-text-muted hover:text-text inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Departments
      </Link>
      <div className="flex items-center gap-2 mt-2 mb-1">
        <span className="w-3.5 h-3.5 rounded-sm" style={{ background: dept.color ?? "#0D9488" }} />
        <h1 className="text-xl font-semibold text-text">{dept.name}</h1>
      </div>
      {dept.description && <p className="text-sm text-text-muted mb-5">{dept.description}</p>}

      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-wider text-text-faint mb-2 font-semibold">
          Members ({members?.length ?? 0})
        </div>
        <div className="flex flex-wrap gap-2">
          {(members ?? []).map((m: any, i: number) => (
            <span key={i} className="text-xs bg-surface border border-border rounded-full px-3 py-1 text-text-muted">
              {m.profiles?.display_name ?? m.profiles?.email}
              <span className="text-text-faint"> · {m.dept_role}</span>
            </span>
          ))}
          {(members?.length ?? 0) === 0 && (
            <span className="text-xs text-text-faint">No members yet.</span>
          )}
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-text-faint mb-2 font-semibold">
        Permissions
      </div>
      <PermissionToggleGrid
        deptId={id}
        permissions={perms ?? []}
        granted={(granted ?? []).map((g) => g.permission_key)}
      />
    </div>
  );
}
